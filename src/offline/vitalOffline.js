// Offline layer for Birth, Death and Marriage. One implementation, selected by
// `entity`. Record lists live in localStorage (archiveLocalStore.js); PDFs and
// the outbox live in IndexedDB.
//
// Cache keys are "<entity>:records" / "<entity>:archived" in localStorage, so
// cache.js can clear them on logout.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDB } from "./db";
import { isDbAvailable, subscribeDb, checkNow } from "./connectivityService";
import {
  assertSecureOfflineQueue, enqueue, listByStatus, subscribeOutbox, removeOp,
} from "./outboxQueue";
import { saveFile, getFile } from "./fileStore";
import { subscribeSyncState } from "./syncEngine";
import useOnlineStatus from "../hooks/useOnlineStatus";
import { refreshAllOfflineCredentials } from "./archivePassword";
import { saveRecordList, loadRecordList } from "./archiveLocalStore";
import { apiFetch } from "../services/apiFetch";
import { createPdfBlobFromData } from "../utils/pdfUtils";
import { fetchJsonWithRetry } from "../utils/fetchJsonWithRetry";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pdfKey = (entity, id) => `vr-${entity}-pdf:${id}`;
const NUMERIC_ID = /^\d+$/;

/* ── list cache (localStorage) ── */

export const saveList = async (entity, name, data) =>
  saveRecordList(`${entity}:${name}`, data);

/** @returns {{data: any[], savedAt: number} | null} */
export const loadList = async (entity, name) =>
  loadRecordList(`${entity}:${name}`);

/* ── PDF cache (IndexedDB) ── */

export async function getCachedPdf(entity, id) {
  try {
    const db = await getDB();
    return (await db.get("cache", pdfKey(entity, id)))?.blob || null;
  } catch {
    return null;
  }
}

export async function cachePdf(entity, id, blob) {
  try {
    const db = await getDB();
    await db.put("cache", {
      key: pdfKey(entity, id),
      entity: `vr-${entity}-pdf`,
      blob,
      savedAt: Date.now(),
    });
  } catch (e) {
    console.warn("[vitalOffline] cachePdf failed (storage full?):", e);
  }
}

async function hasCachedPdf(entity, id) {
  try {
    const db = await getDB();
    return (await db.getKey("cache", pdfKey(entity, id))) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Downloads every PDF not yet on this device, one at a time, with a pause
 * between each. Returns a cancel function.
 */
export function startPdfPrefetch(entity, ids, api, gapMs = 600) {
  let cancelled = false;
  (async () => {
    try { await navigator.storage?.persist?.(); } catch { /* optional */ }
    let failures = 0;
    for (const id of new Set(ids)) {
      if (cancelled || !isDbAvailable()) return;
      if (!NUMERIC_ID.test(String(id))) continue;   // skip queued "offline-…" rows
      if (await hasCachedPdf(entity, id)) continue;
      try {
        // ?prefetch=1 tells the server not to write a VIEW audit entry.
        const res = await apiFetch(`${api}/records/${id}?prefetch=1`);
        if (res.status >= 500) throw new Error(String(res.status));
        if (res.ok) {
          const data = await res.json();
          const blob = createPdfBlobFromData(data?.pdf_data);
          if (blob) await cachePdf(entity, id, blob);
        }
        failures = 0;
      } catch {
        if (++failures >= 3) return;   // server unreachable: stop, retry later
      }
      await sleep(gapMs);
    }
  })();
  return () => { cancelled = true; };
}

/* ── outbox helpers ── */

export async function queueUpload(entity, url, file) {
  assertSecureOfflineQueue(entity, { hasFile: true });
  const fileId = await saveFile(file);
  return enqueue({
    entity, label: `Upload ${file.name}`, method: "POST", url, fileId, fileField: "file",
  });
}

export const queueDelete = (entity, url, who = "") =>
  enqueue({ entity, label: `Delete ${who}`, method: "DELETE", url });

export const queueTransaction = (entity, url, json, who = "", opId) =>
  enqueue({ opId, entity, label: `Transaction: ${who}`, method: "POST", url, json });

/* ── queued changes, shown immediately in the UI ── */

export function useVitalPending(entity, api) {
  const [state, setState] = useState({ uploads: [], deleteIds: new Set(), count: 0 });

  useEffect(() => {
    let alive = true;
    const recordsUrl = `${api}/records`;
    const deletePrefix = `${api}/records/`;

    const load = async () => {
      try {
        const ops = (await listByStatus()).filter((o) => o.entity === entity);

        const uploads = [];
        for (const o of ops) {
          if (o.method !== "POST" || !o.fileId || o.url !== recordsUrl) continue;
          if (o.status === "conflict") continue;
          const f = await getFile(o.fileId);
          if (!f) continue;
          const when = new Date(o.createdAt).toISOString();
          uploads.push({
            id: `offline-${o.opId}`,
            file_name: f.name,
            uploaded_at: when,
            archived_at: when,
            _pending: true,
            _pendingOpId: o.opId,
            _pendingFileId: o.fileId,
            _syncStatus: o.status,
          });
        }
        uploads.reverse();

        const deleteIds = new Set(
          ops
            .filter((o) => o.method === "DELETE"
              && (o.status === "pending" || o.status === "syncing")
              && o.url.startsWith(deletePrefix))
            .map((o) => decodeURIComponent(o.url.slice(deletePrefix.length))),
        );

        const count = ops.filter((o) => o.status === "pending" || o.status === "syncing").length;
        if (alive) setState({ uploads, deleteIds, count });
      } catch {
        /* IndexedDB unavailable: show server data only */
      }
    };

    load();
    const unsub = subscribeOutbox(load);
    return () => { alive = false; unsub(); };
  }, [entity, api]);

  return state;
}

/* ── list loading with offline fallback ── */

export async function loadListWithFallback(entity, path, cacheName, signal) {
  if (isDbAvailable()) {
    try {
      const data = await fetchJsonWithRetry(path, { signal });
      const arr = Array.isArray(data) ? data : [];
      await saveList(entity, cacheName, arr);
      return { data: arr, fromCache: false };
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      const cached = await loadList(entity, cacheName);
      if (cached) return { data: cached.data, fromCache: true, savedAt: cached.savedAt };
      throw err;
    }
  }
  const cached = await loadList(entity, cacheName);
  if (cached) return { data: cached.data, fromCache: true, savedAt: cached.savedAt };
  return { data: [], fromCache: true, empty: true };
}

/* ── PDF loading: queued file → server (refreshes the copy) → saved copy ── */

export async function loadPdfForRecord(entity, api, id, record) {
  if (record?._pendingFileId) {
    const f = await getFile(record._pendingFileId);
    if (!f?.blob) throw new Error("This queued file is no longer on the device.");
    return f.blob;
  }

  if (isDbAvailable()) {
    let res = null;
    try { res = await apiFetch(`${api}/records/${id}`); } catch { /* fall through */ }
    if (res?.ok) {
      const data = await res.json();
      if (!data?.pdf_data) {
        throw new Error(data?.pdf_error || "No PDF data returned by the server.");
      }
      const blob = createPdfBlobFromData(data.pdf_data);
      if (blob) {
        cachePdf(entity, id, blob);
        return blob;
      }
      return data.pdf_data;   // the viewer shows its own "corrupted" message
    }
    if (res && res.status < 500) throw new Error("Failed to load PDF.");
  }

  const cached = await getCachedPdf(entity, id);
  if (cached) return cached;
  throw new Error(
    isDbAvailable()
      ? "Server unreachable and this PDF isn't saved on this device."
      : "This PDF isn't saved on this device yet. Connect once so it can be downloaded for offline use.",
  );
}

/* ── delete now, or queue it. Returns "deleted" | "queued" | "removed" ── */

export async function deleteRecordSmart(entity, api, id, record, who = "") {
  if (record?._pendingOpId) {
    await removeOp(record._pendingOpId);
    return "removed";
  }
  const url = `${api}/records/${id}`;
  const queueIt = async () => {
    await queueDelete(entity, url, who);
    return "queued";
  };
  if (!isDbAvailable()) return queueIt();

  let res;
  try {
    res = await apiFetch(url, { method: "DELETE" });
  } catch {
    return queueIt();
  }
  if (res.status >= 500 && !(await checkNow())) return queueIt();
  if (!res.ok) {
    let msg = "";
    try { msg = (await res.json()).error; } catch { /* non-JSON */ }
    throw new Error(msg || "Delete failed");
  }
  return "deleted";
}

/* ── the hook the registry uses ── */

export function useVitalData({ entity, api, showNotif }) {
  const online = useOnlineStatus();
  const pending = useVitalPending(entity, api);
  const [rawActive, setRawActive] = useState([]);
  const [rawArchived, setRawArchived] = useState([]);
  const [loadingRecords, setLoading] = useState(false);

  const notifyRef = useRef(showNotif);
  useEffect(() => { notifyRef.current = showNotif; }, [showNotif]);
  const abortActive = useRef(null);
  const abortArchived = useRef(null);
  const lastWarn = useRef(0);

  const warn = useCallback(async (res, label) => {
    if (!res.fromCache) return;
    try {
      const now = Date.now();
      if (now - lastWarn.current < 5000) return;
      if (res.empty) {
        lastWarn.current = now;
        notifyRef.current(`No saved ${label} on this device yet. Connect once so they can be downloaded.`, "error");
        return;
      }
      if (isDbAvailable() && (await checkNow())) {
        lastWarn.current = now;
        notifyRef.current(`Server error. Showing ${label} saved on this device.`, "error");
      }
    } catch {
      /* the connectivity check failed: stay quiet */
    }
  }, []);

  // Returns true when the list is current, false when it could not be loaded.
  const load = useCallback(async (path, cacheName, abortRef, setData, label) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await loadListWithFallback(entity, `${api}/${path}`, cacheName, controller.signal);
      setData(res.data);
      warn(res, label);
      return true;
    } catch (err) {
      if (err?.name === "AbortError") return true;   // a newer request decides
      notifyRef.current(`Failed to load ${label}. ${err?.message || ""}`.trim(), "error");
      return false;
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [entity, api, warn]);

  const fetchRecords = useCallback(
    () => load("records", "records", abortActive, setRawActive, "records"),
    [load],
  );
  const fetchArchived = useCallback(
    () => load("archived", "archived", abortArchived, setRawArchived, "archived records"),
    [load],
  );

  useEffect(() => { fetchRecords(); fetchArchived(); }, [fetchRecords, fetchArchived]);

  // Server came back online.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) { fetchRecords(); fetchArchived(); }
    wasOnline.current = online;
  }, [online, fetchRecords, fetchArchived]);

  // Database came back.
  useEffect(() => subscribeDb((ok) => {
    if (ok) { fetchRecords(); fetchArchived(); }
  }), [fetchRecords, fetchArchived]);

  // While the outbox drains, refresh as items sync (debounced).
  useEffect(() => {
    let timer;
    let last = { done: 0, syncing: false };
    const unsub = subscribeSyncState((s) => {
      const progressed = s.done > last.done || (last.syncing && !s.syncing);
      last = { done: s.done, syncing: s.syncing };
      if (!progressed) return;
      clearTimeout(timer);
      timer = setTimeout(() => { fetchRecords(); fetchArchived(); }, 800);
    });
    return () => { unsub(); clearTimeout(timer); };
  }, [fetchRecords, fetchArchived]);

  // Background-download PDFs so they open offline.
  useEffect(() => {
    if (!online) return undefined;
    const ids = [...rawActive, ...rawArchived].map((r) => r.id);
    return ids.length ? startPdfPrefetch(entity, ids, api) : undefined;
  }, [online, rawActive, rawArchived, entity, api]);

  const allRecords = useMemo(
    () => rawActive.filter((r) => !pending.deleteIds.has(String(r.id))),
    [rawActive, pending.deleteIds],
  );
  const allArchivedRecords = useMemo(
    () => [
      ...pending.uploads,
      ...rawArchived.filter((r) => !pending.deleteIds.has(String(r.id))),
    ],
    [rawArchived, pending.uploads, pending.deleteIds],
  );

  return { allRecords, allArchivedRecords, loadingRecords, fetchRecords, fetchArchived, online };
}

/* ── background warm-up ── */

/** Downloads both lists and their PDFs for offline use. Returns a cancel function or null. */
export async function warmVitalCache(entity, api) {
  if (!isDbAvailable()) return null;
  await refreshAllOfflineCredentials();
  try {
    const get = async (path) => {
      const r = await apiFetch(`${api}/${path}`);
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    };
    const [active, archived] = await Promise.all([get("records"), get("archived")]);
    await saveList(entity, "records", active);
    await saveList(entity, "archived", archived);
    return startPdfPrefetch(entity, [...active, ...archived].map((r) => r.id), api);
  } catch {
    return null;
  }
}

/** Mount in a component that always renders after login. Replaces useBirthWarmup. */
export function useVitalWarmup(entity, api, online) {
  useEffect(() => {
    if (!online) return undefined;
    let cancel = null;
    let alive = true;
    warmVitalCache(entity, api).then((c) => {
      if (alive) cancel = c;
      else c?.();
    });
    return () => { alive = false; cancel?.(); };
  }, [entity, api, online]);
}