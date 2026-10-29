// Offline layer for Document Tracking.
//
//  - One device-level store (STORE_KEY) holds:
//      lists    : { [username]: rows }  the server's ACTIVE answer for each user
//      archived : { [username]: rows }  the server's ARCHIVE answer (admins only)
//      details  : full documents, fetched online (shared, keyed by id)
//      pending  : documents created offline on this device, not yet confirmed
//  - Visibility follows the same rule as the server's list_documents():
//    admins see everything; anyone else sees documents whose active step is
//    held by them, plus documents they have completed a step on.
//    Archived documents are never in the active list.
//  - Writes: sent now when online; queued in the outbox when offline.
//  - Archive / restore update the local copy immediately (markArchivedLocally)
//    so the UI never shows a document in the wrong view while waiting.
import { isDbAvailable } from '../connectivityService';
import { enqueue, listAll, newOpId } from '../outboxQueue';
import { applySnapshotMutation, readSnapshot, updateSnapshot } from '../snapshotStore';

const API = import.meta.env.VITE_API_BASE_URL || '';
const ENTITY = 'tracking';
const CREATE_PATH = '/api/documents';
const PERSONNEL_PATH = '/api/documents/handlers';
const HOLDERS_PATH = '/api/documents/stage-holders';

// localStorage keys
const PERSONNEL_LS_KEY = 'dt_personnel_cache_v1';
const STORE_KEY = 'dt_store_v4';
const SESSION_CACHE_KEY = 'cr_session_cache_v1'; // written by PermissionContext

const OFFLINE_PREFIX = 'offline-';
const OFFLINE_ID_RE = /^offline-/;
// Only the first few details are saved in the background. The rest are
// fetched when a document is opened.
const MAX_PREFETCH_DETAILS = 10;
const PREFETCH_CONCURRENCY = 4;

const STAGE_RE = /^\/api\/documents\/((?:\d+)|offline-[\w-]+)\/stages\/(\d+)\/(complete|flag|comments|registry-number|release-destination|posting-period)$/;
const REJECT_RE = /^\/api\/documents\/((?:\d+)|offline-[\w-]+)\/reject$/;
const DETAIL_PATH_RE = /^\/api\/documents\/(\d+|offline-[\w-]+)$/;

// Same as STARTER_STAGES in routes/document.py.
const STARTER_STAGES = [
  { stage_order: 1, label: 'Registration', detail: 'Assigned personnel processes the submitted registration documents.' },
  { stage_order: 2, label: 'Civil Registrar', detail: 'Document is forwarded to the Civil Registrar.' },
  { stage_order: 3, label: 'Posting Period', detail: 'Document is posted for 10 days, as required for late registration, before proceeding.' },
  { stage_order: 4, label: 'Records Division', detail: 'Document is registered into the Civil Registry Book.' },
  { stage_order: 5, label: 'Assign Registry Number', detail: 'Authorized personnel enters and saves the Registry Number.' },
  { stage_order: 6, label: 'Releasing', detail: 'Document is released to its destination.' },
];

// Same mapping as _stage_permission_for_label() in routes/document.py.
function stagePermissionForLabel(label) {
  const l = (label || '').trim().toLowerCase();
  if (l.includes('registration')) return 'document_stage_registration';
  if (l.includes('civil registrar')) return 'document_stage_civil_registrar';
  if (l === 'posting period') return 'document_stage_posting_period';
  if (l.includes('records division')) return 'document_stage_records_division';
  if (l.includes('registry number')) return 'document_stage_registry_number';
  if (l === 'releasing') return 'document_stage_releasing';
  return null;
}

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Splits a request path into its pathname and query params.
function parsePath(path) {
  const [pathname, query = ''] = String(path).split('?');
  return { pathname, params: new URLSearchParams(query) };
}

export async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* no JSON body */ }
  if (!res.ok) throw new HttpError(body?.error || `Request failed (${res.status})`, res.status);
  return body;
}

/* ── localStorage helpers ── */

function lsRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = JSON.parse(raw);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function lsWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('[documentTrackingOffline] could not save to localStorage:', e);
    return false;
  }
}

function sessionCache() {
  return lsRead(SESSION_CACHE_KEY, null) || {};
}

// The logged-in username. Falls back to the saved session when this tab's
// sessionStorage has not been filled yet.
function currentUsername() {
  let u = '';
  try { u = (sessionStorage.getItem('username') || '').trim(); } catch { /* ignore */ }
  return u || (sessionCache().username || '').trim();
}

function userKey() {
  return (currentUsername() || 'anonymous').toLowerCase();
}

function isAdminOnDevice() {
  const s = sessionCache();
  const user = currentUsername().toLowerCase();
  return Boolean(s.isAdmin) && (s.username || '').trim().toLowerCase() === user && user !== '';
}

/* ── personnel + stage holders (saved per device) ── */

function readLocalPersonnel() {
  const raw = lsRead(PERSONNEL_LS_KEY, null);
  if (!raw || typeof raw !== 'object') return { savedAt: 0, personnel: [], holders: {} };
  return {
    savedAt: raw.savedAt || 0,
    personnel: Array.isArray(raw.personnel) ? raw.personnel : [],
    holders: raw.holders && typeof raw.holders === 'object' ? raw.holders : {},
  };
}

function saveLocalPersonnel(personnel, holders) {
  return lsWrite(PERSONNEL_LS_KEY, { savedAt: Date.now(), personnel, holders });
}

// Fills each stage's handler name. Role holder first, then the assigned person.
function fillStageNames(doc) {
  if (!doc || !Array.isArray(doc.stages)) return doc;
  const saved = readLocalPersonnel();
  const nameById = new Map(saved.personnel.map((p) => [Number(p.id), p.name]));

  return {
    ...doc,
    stages: doc.stages.map((s) => {
      const roleUser = holderFor(s.label, saved.holders, s.holder_username);
      const personName =
        s.assigned_handler_id != null ? nameById.get(Number(s.assigned_handler_id)) : null;
      return { ...s, assigned_handler_name: roleUser || personName || s.assigned_handler_name || null };
    }),
  };
}

/* ── visibility (same rule as list_documents() on the server) ── */

function holderFor(stageLabel, holders, snapshotHolder = null) {
  const perm = stagePermissionForLabel(stageLabel);
  if (!perm) return null;
  return (holders && holders[perm]) || snapshotHolder || null;
}

function isStageOwnedBy(stageLabel, holders, user, snapshotHolder = null) {
  const holder = holderFor(stageLabel, holders, snapshotHolder);
  return Boolean(holder) && Boolean(user) && holder.toLowerCase() === user.toLowerCase();
}

function activeStageOf(stages) {
  return (stages || []).find((s) => !s.done || s.flag) || null;
}

// True when this user completed at least one stage of the document.
function handledByUser(stages, user) {
  if (!user) return false;
  const target = user.toLowerCase();
  return (stages || []).some(
    (s) => (s.completed_by || '').toLowerCase() === target
  );
}

// A saved ACTIVE list row is visible when the user is an admin, or holds its
// active step, or has completed a step on it. Archived rows are never shown
// in the active list.
function rowVisible(row, holders, user, admin) {
  if (row.archived || row.archived_at) return false;
  if (admin) return true;
  if (row.handled_by_me) return true;
  return Boolean(row.active_stage) && isStageOwnedBy(row.active_stage, holders, user);
}

// Builds a list row the same way the server does.
function rowFromDetail(d) {
  const active = activeStageOf(d.stages);
  return {
    id: d.id,
    doc_number: d.doc_number,
    title: d.title,
    doc_type: d.doc_type,
    type: d.doc_type,
    status: d.status,
    rejected: Boolean(d.rejected),
    owner: active?.assigned_handler_name || 'Unassigned',
    active_stage: active?.label ?? null,
    assigned_handler_id: null,
    deleted_handler_id: null,
    archived: Boolean(d.archived_at),
    archived_at: d.archived_at ?? null,
    handled_by_me: handledByUser(d.stages, currentUsername()),
    updated_at: d.updated_at,
  };
}

/* ── device store ── */

function emptyStore() {
  return { savedAt: 0, lists: {}, archived: {}, details: {}, pending: {} };
}

function readStore() {
  const s = lsRead(STORE_KEY, null);
  if (!s || typeof s !== 'object') return emptyStore();
  return {
    savedAt: s.savedAt || 0,
    lists: s.lists && typeof s.lists === 'object' ? s.lists : {},
    archived: s.archived && typeof s.archived === 'object' ? s.archived : {},
    details: s.details && typeof s.details === 'object' ? s.details : {},
    pending: s.pending && typeof s.pending === 'object' ? s.pending : {},
  };
}

function writeStore(store) {
  lsWrite(STORE_KEY, store);
}

// Removes a document id from every saved list (active and archive, all users).
// Returns the first row found, so it can be placed in the right list again.
function removeRowEverywhere(store, id) {
  let found = null;
  for (const bucket of [store.lists, store.archived]) {
    for (const k of Object.keys(bucket)) {
      const hit = bucket[k].find((r) => String(r.id) === id);
      if (hit && !found) found = hit;
      bucket[k] = bucket[k].filter((r) => String(r.id) !== id);
    }
  }
  return found;
}

// Called right after a successful archive or restore, so the saved lists match
// the server without waiting for a full refresh.
export function markArchivedLocally(docId, archived) {
  const store = readStore();
  const id = String(docId);
  const now = archived ? new Date().toISOString() : null;

  const detail = store.details[id];
  if (detail) {
    detail.archived_at = now;
    detail.archived = archived;
  }

  const existing = removeRowEverywhere(store, id);
  const base = existing || (detail ? rowFromDetail(fillStageNames(detail)) : null);
  if (base) {
    const row = { ...base, archived: archived, archived_at: now };
    const bucket = archived ? store.archived : store.lists;
    const key = userKey();
    bucket[key] = [row, ...(bucket[key] || [])];
  }
  writeStore(store);
}

// Drops pending copies that are no longer needed.
async function pruneDiscardedPending(store) {
  const ids = Object.keys(store.pending);
  if (!ids.length) return false;
  try {
    const ops = await listAll();
    const byId = new Map(ops.map((o) => [o.opId, o]));
    let changed = false;

    for (const id of ids) {
      const opId = id.slice(OFFLINE_PREFIX.length);
      const op = byId.get(opId);

      if (!op) {
        delete store.pending[id];
        changed = true;
        continue;
      }

      if (op.status === 'synced') {
        const stillQueued = ops.some(
          (o) => o.status !== 'synced' && String(o.url || '').includes(`/${OFFLINE_PREFIX}${opId}`)
        );
        if (!stillQueued) {
          delete store.pending[id];
          changed = true;
        }
      }
    }
    return changed;
  } catch (e) {
    console.warn('[documentTrackingOffline] could not check outbox:', e);
    return false;
  }
}

function pendingRowsFor(store, holders, user, admin, serverDocNumbers = new Set()) {
  return Object.values(store.pending)
    .map((d) => fillStageNames(d))
    .filter((d) => !serverDocNumbers.has(String(d.doc_number)))
    .filter((d) => {
      if (admin) return true;
      const active = activeStageOf(d.stages);
      if (active && isStageOwnedBy(active.label, holders, user, active.holder_username)) return true;
      return handledByUser(d.stages, user);
    })
    .map((d) => rowFromDetail(d));
}

/* ── refresh while online ── */

export async function refreshTrackingPersonnel() {
  if (!isDbAvailable()) return false;
  let ok = false;
  try {
    const [people, holders] = await Promise.all([
      apiFetch(PERSONNEL_PATH),
      apiFetch(HOLDERS_PATH),
    ]);
    ok = saveLocalPersonnel(
      Array.isArray(people) ? people : [],
      holders && typeof holders === 'object' ? holders : {},
    );
  } catch (e) {
    console.warn('[documentTrackingOffline] personnel refresh failed:', e);
  }
  await refreshTrackingDocuments();
  return ok;
}

async function refreshTrackingDocuments() {
  if (!currentUsername()) return false;
  let rows;
  try {
    rows = await apiFetch(CREATE_PATH);
  } catch (e) {
    console.warn('[documentTrackingOffline] document refresh failed:', e);
    return false;
  }
  await storeOnlineList(rows);
  return true;
}

// Downloads full details in the background, a few at a time. Never awaited by
// the list, so the list appears as soon as the row data arrives.
async function prefetchDetails(rows) {
  const queue = rows.slice(0, MAX_PREFETCH_DETAILS);
  const worker = async () => {
    while (queue.length && isDbAvailable()) {
      const row = queue.shift();
      try {
        const doc = await apiFetch(`${CREATE_PATH}/${row.id}`);
        const store = readStore();
        store.details[String(row.id)] = doc;
        writeStore(store);
        await updateSnapshot((snapshot) => ({
          ...snapshot,
          _snapshot: {
            ...snapshot._snapshot,
            documentDetails: {
              ...(snapshot._snapshot?.documentDetails || {}),
              [String(row.id)]: doc,
            },
          },
        }));
      } catch (e) {
        console.warn('[documentTrackingOffline] could not save document', row.id, e);
      }
    }
  };
  await Promise.all(Array.from({ length: PREFETCH_CONCURRENCY }, worker));
}

// Saves the server's ACTIVE answer for this user, then starts the detail
// prefetch in the background.
async function storeOnlineList(rows) {
  const incoming = (Array.isArray(rows) ? rows : []).filter((r) => !r.archived && !r.archived_at);
  const store = readStore();
  store.lists[userKey()] = incoming;

  // The server now has these documents, so the matching pending copies can go.
  const serverDocNumbers = new Set(incoming.map((r) => String(r.doc_number)));
  for (const id of Object.keys(store.pending)) {
    if (serverDocNumbers.has(String(store.pending[id].doc_number))) {
      delete store.pending[id];
    }
  }

  store.savedAt = Date.now();
  writeStore(store);
  const username = currentUsername().toLowerCase();
  await updateSnapshot((snapshot) => ({
    ...snapshot,
    data: {
      ...snapshot.data,
      documents: {
        ...(snapshot.data.documents || {}),
        [`${username}:active`]: incoming,
      },
    },
  }));

  // Not awaited: the caller gets the list immediately.
  prefetchDetails(incoming);
}

/* ── READS ── */

function snapshotDocumentRows(snapshot, archived) {
  const username = currentUsername().toLowerCase();
  const documents = snapshot.data.documents || {};
  const key = `${username}:${archived ? 'archived' : 'active'}`;
  if (Array.isArray(documents[key])) return documents[key];
  if (isAdminOnDevice()) {
    const adminKey = `admin:${archived ? 'archived' : 'active'}`;
    if (Array.isArray(documents[adminKey])) return documents[adminKey];
  }
  return null;
}

async function listOffline(snapshot, store, fallbackErr) {
  const changed = await pruneDiscardedPending(store);
  if (changed) writeStore(store);

  const myList = snapshotDocumentRows(snapshot, false);
  const hasAnything = Array.isArray(myList) || Object.keys(store.pending).length > 0;
  if (!hasAnything) {
    throw fallbackErr || new Error('Document Tracking is not included in the offline snapshot. Connect once to download offline data.');
  }

  const { holders } = readLocalPersonnel();
  const user = currentUsername();
  const admin = isAdminOnDevice();
  const saved = Array.isArray(myList) ? myList : [];
  const serverDocNumbers = new Set(saved.map((r) => String(r.doc_number)));

  const pendingRows = pendingRowsFor(store, holders, user, admin, serverDocNumbers);
  const savedRows = saved.filter((r) => rowVisible(r, holders, user, admin));

  return [...pendingRows, ...savedRows];
}

function archiveOffline(snapshot, fallbackErr) {
  const saved = snapshotDocumentRows(snapshot, true);
  if (Array.isArray(saved)) return saved;
  throw fallbackErr || new Error(
    'The Document Tracking archive is not included in the offline snapshot. Connect once to download offline data.'
  );
}

export async function trackingRead(path) {
  const { pathname, params } = parsePath(path);
  const isListPath = pathname === CREATE_PATH;
  const archivedView = params.get('archived') === 'true';
  const isActiveList = isListPath && !archivedView;
  const isArchiveList = isListPath && archivedView;
  const detailMatch = pathname.match(DETAIL_PATH_RE);

  if (detailMatch && OFFLINE_ID_RE.test(detailMatch[1])) {
    const store = readStore();
    const d = store.pending[detailMatch[1]];
    if (!d) throw new Error('This document is not saved on this device.');
    return fillStageNames(d);
  }

  let netErr = null;
  if (isDbAvailable()) {
    try {
      const body = await apiFetch(path);

      if (isActiveList) {
        const rows = (Array.isArray(body) ? body : []).filter((r) => !r.archived && !r.archived_at);
        await storeOnlineList(rows);
        const store = readStore();
        await pruneDiscardedPending(store);
        writeStore(store);
        const { holders } = readLocalPersonnel();
        const serverDocNumbers = new Set(rows.map((r) => String(r.doc_number)));
        const pendingRows = pendingRowsFor(
          store, holders, currentUsername(), isAdminOnDevice(), serverDocNumbers,
        );
        return [...pendingRows, ...rows];
      }

      if (isArchiveList) {
        const rows = (Array.isArray(body) ? body : []).filter((r) => r.archived || r.archived_at);
        const store = readStore();
        store.archived[userKey()] = rows;
        writeStore(store);
        const username = currentUsername().toLowerCase();
        await updateSnapshot((snapshot) => ({
          ...snapshot,
          data: {
            ...snapshot.data,
            documents: {
              ...(snapshot.data.documents || {}),
              [`${username}:archived`]: rows,
            },
          },
        }));
        return rows;
      }

      if (detailMatch) {
        await updateSnapshot((snapshot) => ({
          ...snapshot,
          _snapshot: {
            ...snapshot._snapshot,
            documentDetails: {
              ...(snapshot._snapshot?.documentDetails || {}),
              [detailMatch[1]]: body,
            },
          },
        }));
      }
      return body;
    } catch (err) {
      if (err.status && err.status < 500) throw err;
      netErr = err;
    }
  }

  const snapshot = await readSnapshot();
  if (!snapshot) {
    const error = new Error('Connect once to download offline data.');
    error.status = 'no-snapshot';
    throw error;
  }
  const store = readStore();
  if (isActiveList) return listOffline(snapshot, store, netErr);
  if (isArchiveList) return archiveOffline(snapshot, netErr);

  if (detailMatch) {
    const d = snapshot._snapshot?.documentDetails?.[detailMatch[1]];
    if (d) return fillStageNames(d);
    throw netErr || new Error('This document detail is not included in the offline snapshot. Connect once to download it.');
  }

  throw new Error('Unsupported Document Tracking request.');
}

/* ── WRITES ── */

export async function trackingWrite({ path, method = 'POST', json = null, label }) {
  const opId = newOpId();
  const mustQueue = !isDbAvailable() || path.includes('/offline-');

  if (!mustQueue) {
    let res;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Offline-Op-Id': opId },
        body: json ? JSON.stringify(json) : undefined,
      });
    } catch {
      return queueWrite({ opId, path, method, json, label });
    }
    if (res.status >= 500) {
      return queueWrite({ opId, path, method, json, label });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(data?.error || `Request failed (${res.status})`, res.status);
    return data;
  }

  return queueWrite({ opId, path, method, json, label });
}

async function queueWrite({ opId, path, method, json, label }) {
  await enqueue({ opId, entity: ENTITY, label, method, url: `${API}${path}`, json });
  const optimistic = await applyOptimistic({ opId, path, method, json });
  await applySnapshotMutation({
    entity: ENTITY,
    method,
    url: path,
    json: json ? { ...json, updated_at: json.updated_at || new Date().toISOString() } : json,
    opId,
  });
  return { queued: true, ...optimistic };
}

/* ── local copy updates ── */

function patchDoc(docId, fn, listPatch = null) {
  const store = readStore();
  const id = String(docId);
  const isPending = OFFLINE_ID_RE.test(id);
  const bucket = isPending ? store.pending : store.details;

  if (bucket[id]) {
    const updated = fn(bucket[id]);
    bucket[id] = updated;
    const row = rowFromDetail(fillStageNames(updated));
    for (const key of Object.keys(store.lists)) {
      store.lists[key] = store.lists[key].map((r) =>
        String(r.id) === id ? { ...r, ...row } : r
      );
    }
  } else if (listPatch && !isPending) {
    for (const key of Object.keys(store.lists)) {
      store.lists[key] = store.lists[key].map((r) =>
        String(r.id) === id ? { ...r, ...listPatch } : r
      );
    }
  }

  writeStore(store);
}

async function applyOptimistic({ opId, path, method, json }) {
  const now = new Date().toISOString();
  const actor = currentUsername();
  const author = actor || 'You';

  if (method === 'POST' && path === CREATE_PATH) {
    const id = `${OFFLINE_PREFIX}${opId}`;
    const holders = readLocalPersonnel().holders;

    const stages = STARTER_STAGES.map((s) => {
      const holder = holderFor(s.label, holders) ?? null;
      return {
        ...s,
        done: false,
        flag: false,
        completed_at: null,
        completed_by: null,
        assigned_handler_id: null,
        holder_username: holder,
        assigned_handler_name: holder,
        registry_number: null,
        release_destination: null,
        posting_start_at: null,
        posting_end_at: null,
        comments: [],
      };
    });

    const doc = {
      id,
      doc_number: json?.doc_number,
      title: json?.title,
      doc_type: json?.doc_type,
      status: 'In review',
      rejected: false,
      archived_at: null,
      updated_at: now,
      registry_number: null,
      release_destination: null,
      stages,
    };

    const store = readStore();
    store.pending[id] = doc;
    writeStore(store);
    return { id, doc: rowFromDetail(fillStageNames(doc)) };
  }

  const rej = path.match(REJECT_RE);
  if (rej) {
    patchDoc(
      rej[1],
      (d) => ({ ...d, rejected: true, status: 'Rejected', updated_at: now }),
      { rejected: true, status: 'Rejected' },
    );
    return { ok: true };
  }

  const m = path.match(STAGE_RE);
  if (m) {
    const [, docId, order, action] = m;
    const comment = (body) => ({ author, body, created_at: now });

    patchDoc(
      docId,
      (doc) => {
        if (!Array.isArray(doc.stages)) return doc;
        const stages = doc.stages.map((s) => {
          if (Number(s.stage_order) !== Number(order)) return s;
          const n = { ...s, comments: [...(s.comments || [])] };
          if (action === 'complete') {
            n.done = true;
            n.flag = false;
            n.completed_at = now;
            n.completed_by = actor || null;
          }
          else if (action === 'flag') { n.flag = true; n.done = false; n.completed_at = now; n.comments.push(comment(json?.note || '')); }
          else if (action === 'comments') n.comments.push(comment(json?.body || ''));
          else if (action === 'registry-number') n.registry_number = json?.registry_number;
          else if (action === 'release-destination') n.release_destination = json?.destination;
          else if (action === 'posting-period') {
            n.posting_start_at = now;
            n.posting_end_at = new Date(Date.now() + 10 * 86400000).toISOString();
          }
          return n;
        });
        const next = { ...doc, stages, updated_at: now };
        if (action === 'flag') next.status = 'Changes requested';
        if (action === 'registry-number') next.registry_number = json?.registry_number;
        if (action === 'release-destination') next.release_destination = json?.destination;
        return next;
      },
      action === 'flag' ? { status: 'Changes requested' } : null,
    );
    return { ok: true };
  }

  return { ok: true };
}

/* ── instant paint ── */
