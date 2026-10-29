import { getDB } from './db';
import { deleteFile } from './fileStore';
import { encryptJSON } from './secureStore';
import { pushToast } from '../services/toastService';

// status: pending | syncing | failed | conflict | synced
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
export const subscribeOutbox = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export const newOpId = () =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const SYNCED_KEEP = 500;
const cryptoAvailable = () => !!globalThis.crypto?.subtle; // false on plain-http LAN addresses
const SENSITIVE_ENTITIES = new Set(['birth', 'death', 'marriage', 'tracking']);
const SENSITIVE_FIELD_TOKENS = [
  'name', 'person', 'birth', 'death', 'dob', 'parent', 'mother', 'father',
  'child', 'spouse', 'husband', 'wife', 'address', 'email', 'phone', 'mobile',
  'contact', 'payment', 'amount', 'fee', 'ornumber', 'reference', 'tin',
  'passport', 'identity', 'nationalid', 'registry', 'controlno', 'requester',
  'signature', 'record',
];
const currentUser = () => {
  try { return sessionStorage.getItem('username')?.trim().toLowerCase() || null; } catch { return null; }
};

function containsSensitiveFields(value) {
  if (Array.isArray(value)) return value.some(containsSensitiveFields);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return SENSITIVE_FIELD_TOKENS.some((token) => normalizedKey.includes(token))
      || containsSensitiveFields(nested);
  });
}

export function assertSecureOfflineQueue(entity, { json = null, fileId = null, hasFile = false } = {}) {
  if (cryptoAvailable()) return;

  const isSensitive = SENSITIVE_ENTITIES.has(String(entity || '').toLowerCase())
    || Boolean(fileId || hasFile)
    || containsSensitiveFields(json);
  if (!isSensitive) return;

  const message = 'This sensitive change cannot be queued offline because secure encryption is unavailable. Use a secure connection and try again.';
  pushToast({
    title: 'Secure offline storage required',
    message,
    success: false,
    duration: 7000,
  });
  throw new Error(message);
}

export async function enqueue({ opId, entity, label, method, url, json = null, fileId = null, fileField = 'file' }) {
  assertSecureOfflineQueue(entity, { json, fileId });
  const username = currentUser();
  if (!username) throw new Error('Sign in before queuing offline changes.');
  const db = await getDB();
  // Sensitive JSON (names, parents, payments) is encrypted at rest when the
  // browser allows it. Non-sensitive values may remain plain on insecure origins.
  let storedJson = null;
  if (json) {
    const updatedJson = {
      ...json,
      updated_at: json.updated_at || new Date().toISOString(),
    };
    storedJson = cryptoAvailable() ? { __enc: await encryptJSON(updatedJson) } : updatedJson;
  }
  const op = {
    opId: opId || newOpId(),
    entity, label, method, url,
    json: storedJson,
    fileId, fileField,
    username,
    status: 'pending', attempts: 0, lastError: null,
    createdAt: Date.now(),
  };
  await db.put('outbox', op);
  notify();
  return op;
}

// Without arguments: everything that still needs syncing (synced rows are excluded).
export async function listByStatus(...statuses) {
  const db = await getDB();
  const all = await db.getAllFromIndex('outbox', 'createdAt'); // oldest first = order kept
  if (statuses.length) return all.filter((o) => statuses.includes(o.status));
  return all.filter((o) => o.status !== 'synced');
}

export async function listAll() {
  const db = await getDB();
  return db.getAllFromIndex('outbox', 'createdAt');
}

export async function updateOp(opId, patch) {
  const db = await getDB();
  const op = await db.get('outbox', opId);
  if (!op) return;
  await db.put('outbox', { ...op, ...patch });
  notify();
}

// Called ONLY after the server confirmed the change (2xx, or 404 on a delete).
// The file and the encrypted payload are purged here; the row stays as history.
export async function markSynced(opId) {
  const db = await getDB();
  const op = await db.get('outbox', opId);
  if (!op) return;
  if (op.fileId) await deleteFile(op.fileId);
  await db.put('outbox', {
    ...op,
    status: 'synced',
    syncedAt: Date.now(),
    json: null,
    fileId: null,
    lastError: null,
  });
  notify();
}

// Cancels an operation that never reached the server (also removes its file).
export async function removeOp(opId) {
  const db = await getDB();
  const op = await db.get('outbox', opId);
  await db.delete('outbox', opId);
  if (op?.fileId) await deleteFile(op.fileId);
  notify();
}

export async function requeueOne(opId) {
  await updateOp(opId, { status: 'pending', attempts: 0, lastError: null });
}

export async function requeueByStatus(statuses) {
  const db = await getDB();
  const all = await db.getAll('outbox');
  for (const op of all) {
    if (statuses.includes(op.status)) {
      await db.put('outbox', { ...op, status: 'pending', attempts: 0, lastError: null });
    }
  }
  notify();
}

// Keeps the newest SYNCED_KEEP history rows so the outbox does not grow forever.
export async function trimSynced() {
  const db = await getDB();
  const synced = (await db.getAll('outbox'))
    .filter((o) => o.status === 'synced')
    .sort((a, b) => (b.syncedAt || 0) - (a.syncedAt || 0));
  const extra = synced.slice(SYNCED_KEEP);
  for (const o of extra) await db.delete('outbox', o.opId);
  if (extra.length) notify();
}

export async function getCounts() {
  const all = await listAll();
  const me = currentUser();
  const c = { pending: 0, syncing: 0, failed: 0, conflict: 0, synced: 0, waiting: 0, total: 0 };
  for (const o of all) {
    if (c[o.status] !== undefined) c[o.status] += 1;
    // Queued by another login on this device: it waits until that user signs in.
    if (o.status === 'pending' && o.username && me && o.username !== me) c.waiting += 1;
  }
  c.total = c.pending + c.syncing + c.failed + c.conflict; // everything not yet on the server
  return c;
}

export async function recoverInterrupted() {
  const stuck = await listByStatus('syncing');
  await Promise.all(stuck.map((o) => updateOp(o.opId, { status: 'pending' })));
}