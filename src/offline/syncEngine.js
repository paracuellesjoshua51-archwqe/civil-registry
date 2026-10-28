import { isDbAvailable, subscribeConnectivity } from './connectivityService';
import {
  listByStatus, updateOp, markSynced, trimSynced, recoverInterrupted, requeueOne,
} from './outboxQueue';
import { markConflict } from './conflictResolver';
import { getDB, getMeta, setMeta } from './db';
import { decryptJSON } from './secureStore';
import { isEntityAllowed } from './syncScope';

// ---------- Backend base URL ----------

const DEFAULT_API_BASE = '';

function resolveApiBase() {
  const base = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, '');
  if (import.meta.env.PROD && !base) {
    throw new Error('VITE_API_BASE_URL is required in production builds.');
  }
  return base;
}

export const API_BASE = resolveApiBase();

// Queued items can carry a host from the build that created them (a placeholder,
// an old Render URL, or 127.0.0.1). Keep only the path and query, and always send
// to the API_BASE of the build that is running now.
function normalizeUrl(url) {
  if (!API_BASE) {
    try {
      const absoluteUrl = new URL(url);
      return `${absoluteUrl.pathname}${absoluteUrl.search}`;
    } catch {
      return url;
    }
  }
  try {
    const u = new URL(url, API_BASE);
    return `${API_BASE}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

// ---------- Sync settings ----------

const PAUSE_EVERY = 10;
const PAUSE_MS = 500;
const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 3000;
const POLL_MS = 60000;

let running = false;
let retryTimer = null;
let pollTimer = null;
let unsub = null;
let failStreak = 0;
const stateListeners = new Set();

let state = {
  syncing: false, done: 0, total: 0,
  succeeded: 0, failedRun: 0,
  lastError: null, authRequired: false, lastSyncAt: null,
};

const setState = (p) => { state = { ...state, ...p }; stateListeners.forEach((fn) => fn(state)); };
export const getSyncState = () => state;
export const subscribeSyncState = (fn) => (stateListeners.add(fn), () => stateListeners.delete(fn));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The logged-in username for this tab. Null when nobody is logged in.
const currentUser = () => {
  try { return sessionStorage.getItem('username') || null; } catch { return null; }
};

// A queued change may point at a temporary document id ("offline-<opId>").
// Swap in the real id saved when that document was created on the server.
async function resolveUrl(url) {
  const m = url.match(/\/api\/documents\/(offline-[\w-]+)/);
  if (!m) return url;
  const createOpId = m[1].slice('offline-'.length);
  const realId = await getMeta(`docmap:${createOpId}`);
  if (realId == null) {
    throw Object.assign(new Error('The document for this change was not created on the server.'), { fatal: true });
  }
  return url.replace(m[1], String(realId));
}

async function replay(op) {
  const url = normalizeUrl(await resolveUrl(op.url));
  const headers = { 'X-Offline-Op-Id': op.opId, 'X-Offline-Created-At': String(op.createdAt) };
  let body;
  if (op.fileId) {
    const db = await getDB();
    const rec = await db.get('files', op.fileId);
    if (!rec) throw Object.assign(new Error('Attached file is missing on this device.'), { fatal: true });
    const fd = new FormData();
    fd.append(op.fileField, rec.blob, rec.name);
    body = fd;
  } else if (op.json) {
    let payload = op.json;
    if (op.json.__enc) {
      try {
        payload = await decryptJSON(op.json.__enc);
      } catch {
        throw Object.assign(new Error('Cannot decrypt this queued change on this device.'), { fatal: true });
      }
    }
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }
  return fetch(url, { method: op.method, headers, body, credentials: 'include' });
}

// Returns a summary for the run, or null if it could not run.
//   succeeded / failed      : items that finished this run
//   pausedEntities           : modules that hit a server error and wait for retry
//   skippedOtherLogin        : items queued by a different login (left untouched)
// A network loss stops the whole run and returns { error }.
// Never sends anything when no user is logged in.
export async function runSync() {
  if (running || !isDbAvailable()) return null;
  running = true;
  clearTimeout(retryTimer);
  const summary = {
    succeeded: 0, failed: 0,
    pausedEntities: [],
    skippedOtherLogin: 0,
  };
  const paused = new Set(); // modules paused by a server error in this run
  let serverError = null;

  try {
    const me = currentUser();
    if (!me) return null; // nobody logged in: queued items stay untouched

    await recoverInterrupted();

    // Work this login may send (its own items, within its permissions).
    // Everything else stays queued, untouched.
    const scoped = (await listByStatus('pending')).filter((o) => isEntityAllowed(o.entity));
    const queue = scoped.filter((o) => !o.username || o.username === me);
    summary.skippedOtherLogin = scoped.length - queue.length;
    if (!queue.length) return summary;

    setState({
      syncing: true, done: 0, total: queue.length,
      succeeded: 0, failedRun: 0, lastError: null, authRequired: false,
    });

    let done = 0;
    for (const op of queue) {
      if (paused.has(op.entity)) continue; // this module waits; others continue
      if (!isDbAvailable()) throw new Error('Connection lost');
      await updateOp(op.opId, { status: 'syncing' });

      let res;
      try {
        res = await replay(op);
      } catch (err) {
        if (err.fatal) {
          await updateOp(op.opId, { status: 'failed', lastError: err.message });
          summary.failed += 1;
          done += 1;
          setState({ done, failedRun: summary.failed });
          continue;
        }
        await updateOp(op.opId, { status: 'pending' });
        throw err; // network is gone: stop everything
      }

      const s = res.status;
      const body = await res.json().catch(() => ({}));
      const msg = body?.error || '';

      if ((s >= 200 && s < 300) || (op.method === 'DELETE' && s === 404)) {
        // A document created offline: remember its real id so later queued
        // changes for the temporary id reach the right document.
        if (op.method === 'POST' && /\/api\/documents$/.test(op.url) && body?.id != null) {
          await setMeta(`docmap:${op.opId}`, body.id);
        }
        await markSynced(op.opId);
        summary.succeeded += 1;
      } else if (s === 401) {
        await updateOp(op.opId, { status: 'pending' });
        setState({ authRequired: true, lastError: 'Session expired. Log in again to continue syncing.' });
        return summary;
      } else if (s === 403) {
        // Server says this login may not send this entity. Stop retrying it.
        await updateOp(op.opId, { status: 'failed', lastError: msg || 'Access denied for this module' });
        summary.failed += 1;
      } else if (s >= 500 || s === 408 || s === 429) {
        const attempts = op.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        await updateOp(op.opId, {
          status: failed ? 'failed' : 'pending',
          attempts,
          lastError: msg || `Server error (${s})`,
        });
        if (failed) summary.failed += 1;
        paused.add(op.entity);
        serverError = serverError || `${op.entity}: server error (${s})`;
      } else if (s === 409) {
        await markConflict(op, msg);
        summary.failed += 1;
      } else {
        await updateOp(op.opId, { status: 'failed', lastError: msg || `Rejected (${s})` });
        summary.failed += 1;
      }

      done += 1;
      setState({ done, succeeded: summary.succeeded, failedRun: summary.failed });
      if (done % PAUSE_EVERY === 0) await sleep(PAUSE_MS);
    }

    summary.pausedEntities = [...paused];

    if (paused.size) {
      failStreak += 1;
      setState({ lastError: serverError });
      retryTimer = setTimeout(runSync, Math.min(BASE_BACKOFF_MS * 2 ** failStreak, 5 * 60 * 1000));
    } else {
      failStreak = 0;
    }

    const now = Date.now();
    await setMeta('lastSyncAt', now);
    await trimSynced();
    setState({ lastSyncAt: now });
    return summary;
  } catch (err) {
    failStreak += 1;
    setState({ lastError: err.message });
    retryTimer = setTimeout(runSync, Math.min(BASE_BACKOFF_MS * 2 ** failStreak, 5 * 60 * 1000));
    return { ...summary, error: err.message || 'Could not reach the server.' };
  } finally {
    setState({ syncing: false });
    running = false;
  }
}

// Re-queue only the failed and conflicting items this login may send, then sync.
export async function retryAllFailed() {
  if (!currentUser()) return null;
  const rows = [
    ...(await listByStatus('failed')),
    ...(await listByStatus('conflict')),
  ].filter((o) => isEntityAllowed(o.entity));
  for (const o of rows) await requeueOne(o.opId);
  return runSync();
}

export function startSyncEngine() {
  if (unsub) return;
  getMeta('lastSyncAt')
    .then((v) => { if (v) setState({ lastSyncAt: v }); })
    .catch(() => {});
  unsub = subscribeConnectivity((online) => { if (online) runSync(); });
  pollTimer = setInterval(runSync, POLL_MS);
  if (isDbAvailable()) runSync();
}

export function stopSyncEngine() {
  unsub?.();
  unsub = null;
  clearInterval(pollTimer);
  clearTimeout(retryTimer);
}