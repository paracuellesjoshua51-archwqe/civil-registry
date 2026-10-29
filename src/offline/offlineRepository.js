import { isDbAvailable, markOnline } from './connectivityService';
import { assertSecureOfflineQueue, enqueue, newOpId } from './outboxQueue';
import { saveFile } from './fileStore';
import { applySnapshotMutation, readSnapshot, updateSnapshot } from './snapshotStore';

export const isNetworkError = (e) =>
  e?.network === true || e instanceof TypeError || /failed to fetch|network|load failed/i.test(e?.message || '');

/**
 * GET analytics JSON from the active snapshot. Live results refresh that copy;
 * offline reads never consult IndexedDB.
 */
export async function cachedGetJson(url, { entity = 'http', signal, maxEntries = 0, forceNetwork = false } = {}) {
  void entity;
  void maxEntries;
  let lastErr = null;

  // forceNetwork: try the server even if the app currently thinks it is offline
  // (used by Retry and by the auto-recovery check).
  if (isDbAvailable() || forceNetwork) {
    try {
      const res = await fetch(url, { signal, credentials: 'include' });
      const body = await res.json();
      if (!res.ok) throw Object.assign(new Error(body?.error || `Server responded with ${res.status}`), { http: res.status });
      markOnline(true); // a real request just worked, so we are online
      const path = new URL(url, window.location.origin).pathname;
      await updateSnapshot((snapshot) => ({
        ...snapshot,
        _snapshot: {
          ...snapshot._snapshot,
          dashboard: { ...(snapshot._snapshot?.dashboard || {}), [path]: body },
        },
      }));
      return { data: body, fromCache: false, cachedAt: Date.now() };
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      // 4xx (not logged in, forbidden, bad request) are real answers: do not hide them.
      if (err.http && err.http < 500) throw err;
      // Network failure or 5xx (e.g. Flask is up but Supabase is not): use the saved copy.
      lastErr = err;
    }
  }

  const snapshot = await readSnapshot();
  const path = new URL(url, window.location.origin).pathname;
  const saved = snapshot?._snapshot?.dashboard?.[path];
  if (saved !== undefined) {
    return {
      data: saved,
      fromCache: true,
      cachedAt: Date.parse(snapshot._snapshot?.savedAt || '') || null,
    };
  }

  // Nothing saved. If the server answered with an error, show that; otherwise we are simply offline.
  if (lastErr?.http) throw lastErr;
  const error = new Error('No snapshot is available. Connect once to download offline data.');
  error.status = 'no-snapshot';
  throw error;
}

/** Edit a saved GET copy (e.g. hide a record you deleted offline). */
export async function patchCachedJson(url, updater) {
  const path = new URL(url, window.location.origin).pathname;
  await updateSnapshot((snapshot) => ({
    ...snapshot,
    _snapshot: {
      ...snapshot._snapshot,
      dashboard: {
        ...(snapshot._snapshot?.dashboard || {}),
        ...(snapshot._snapshot?.dashboard?.[path] !== undefined
          ? { [path]: updater(snapshot._snapshot.dashboard[path]) }
          : {}),
      },
    },
  }));
}

/** JSON write. Sent now if online, otherwise queued. */
export async function mutate({ entity, label, method = 'POST', url, json = null }) {
  const opId = newOpId(); // same id on the direct try and the queued retry = never applied twice
  if (isDbAvailable()) {
    try {
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'X-Offline-Op-Id': opId, ...(json ? { 'Content-Type': 'application/json' } : {}) },
        body: json ? JSON.stringify(json) : undefined,
      });
      let data = {};
      try { data = await res.json(); } catch { /* non-JSON */ }
      return { queued: false, res, data };
    } catch (err) {
      if (!isNetworkError(err)) throw err;
    }
  }
  const op = await enqueue({ opId, entity, label, method, url, json });
  await applySnapshotMutation({ entity, method, url, json: op.json?.__enc ? json : op.json, opId });
  return { queued: true, op };
}

/** Save a PDF upload to send later. */
export async function queueUpload({ entity, label, url, file, fileField = 'file' }) {
  assertSecureOfflineQueue(entity, { hasFile: true });
  const fileId = await saveFile(file);
  const op = await enqueue({ entity, label, method: 'POST', url, fileId, fileField });
  await applySnapshotMutation({
    entity,
    method: 'POST',
    url,
    opId: op.opId,
    json: {
      id: `offline-${op.opId}`,
      file_name: file.name,
      uploaded_at: new Date(op.createdAt).toISOString(),
      archived_at: new Date(op.createdAt).toISOString(),
      updated_at: new Date(op.createdAt).toISOString(),
    },
  });
  return op;
}