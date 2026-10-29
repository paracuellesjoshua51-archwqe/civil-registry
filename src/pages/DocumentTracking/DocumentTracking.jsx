import { useState, useMemo, memo, useEffect, useRef, useCallback, useDeferredValue } from "react";
import { usePermissions } from "../../context/PermissionContext";
import { useRegisterRefresh } from "../../context/RefreshContext";
import { pushToast } from "../../services/toastService";
import { supabase } from "../../services/supabaseClient";
import { isDbAvailable, subscribeDb } from "../../offline/connectivityService";
import { subscribeSyncState } from "../../offline/syncEngine";
import {
  trackingRead,
  trackingWrite,
  apiFetch,
  markArchivedLocally,
} from "../../offline/adapters/documentTrackingOffline";
import useOnlineStatus from "../../hooks/useOnlineStatus";
import { Skeleton, SkeletonText } from "../../components/Skeleton";
import "./DocumentTracking.css";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

// The server must answer within this time, or the list shows a retry message.
const LIST_TIMEOUT_MS = 20000;

// One debounced refresh path for writes, realtime signals, and reconnects.
// Coalesces bursts so one user action causes one list/detail reload.
const REFRESH_DEBOUNCE_MS = 300;

// How often the posting-period countdown re-evaluates.
const CLOCK_TICK_MS = 30000;

const DOCUMENT_PAGE_SIZE = 50;

// How long a locally removed document is protected from a stale server or
// cache copy.
const LOCAL_GUARD_MS = 10000;

// Length of the delete/archive animation before the row is taken out of the list.
const LEAVE_ANIM_MS = 220;

// How long the highlight on a newly created row lasts.
const NEW_ROW_ANIM_MS = 1400;

// Matches POSTING_PERIOD_DAYS in routes/document.py.
const POSTING_PERIOD_DAYS = 10;
const POSTING_PERIOD_MS = POSTING_PERIOD_DAYS * 24 * 60 * 60 * 1000;

// Matches RELEASE_DESTINATIONS in routes/document.py.
const RELEASE_DESTINATIONS = ["Owner's Copy", "Hospital", "PSA", "Archive Office"];

// Only Late Registration documents require the posting period.
const REQUIRES_POSTING_PATTERN = /late registration/i;

const DOC_TYPES = ["Birth Certificate", "Marriage Certificate", "Death Certificate", "Other"];

const FILTERS = ["All", "In review", "Approved", "Changes requested", "Rejected"];

const VIEW_MODES = [
  { key: "active", label: "Active documents" },
  { key: "archived", label: "Archive" },
];

const STATUS_STYLES = {
  "In review": { fg: "var(--blue-ink)", bg: "var(--blue-soft)" },
  "Approved": { fg: "var(--green-ink)", bg: "var(--green-soft)" },
  "Changes requested": { fg: "var(--amber-ink)", bg: "var(--amber-soft)" },
  "Rejected": { fg: "var(--red-ink)", bg: "var(--red-soft)" },
};

// Text shown for a stage with nobody assigned.
const UNSIGNED_LABEL = "Unsigned";

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

// Shared toast helper (same toastService used by Login / Vital Records).
function notify(message, type = "success") {
  const ok = type === "success";
  pushToast({
    title: ok ? "Success" : "Error",
    message,
    success: ok,
    duration: 4000,
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────
// Network helpers
// ─────────────────────────────────────────────────────────────────────────

const withTimeout = (promise, ms = LIST_TIMEOUT_MS) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("The server did not respond in time. Please try again.")),
        ms
      )
    ),
  ]);

// ─────────────────────────────────────────────────────────────────────────
// Stage identification (mirrors routes/document.py)
// ─────────────────────────────────────────────────────────────────────────

function isRegistryNumberStageLabel(label) {
  return (label || "").toLowerCase().includes("registry number");
}
function isReleasingStageLabel(label) {
  return (label || "").trim().toLowerCase() === "releasing";
}
function isPostingPeriodStageLabel(label) {
  return (label || "").trim().toLowerCase() === "posting period";
}

// Maps a stage label to its document_stage_* permission (mirrors
// _stage_permission_for_label in routes/document.py).
function stagePermissionForLabel(label) {
  const l = (label || "").trim().toLowerCase();
  if (l.includes("registration")) return "document_stage_registration";
  if (l.includes("civil registrar")) return "document_stage_civil_registrar";
  if (l === "posting period") return "document_stage_posting_period";
  if (l.includes("records division")) return "document_stage_records_division";
  if (l.includes("registry number")) return "document_stage_registry_number";
  if (l === "releasing") return "document_stage_releasing";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Formatting and mapping
// ─────────────────────────────────────────────────────────────────────────

function formatDate(value) {
  if (!value) return "Pending";
  // Bare "YYYY-MM-DDTHH:MM:SS" strings from PostgREST are UTC but carry no
  // zone marker; append "Z" so the browser converts them to local time.
  let raw = value;
  if (
    typeof raw === "string" &&
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw) &&
    !/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)
  ) {
    raw = raw.replace(" ", "T") + "Z";
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return value; // already a display string
  return dateTimeFmt.format(d);
}

function initialsFor(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "?";
}

function mapDocumentSummary(row) {
  const archivedAt = row.archived_at ?? null;
  return {
    id: row.id,
    docNumber: row.doc_number || `DOC-${row.id}`,
    title: row.title ?? row.document_title ?? "Untitled document",
    owner: row.owner ?? row.owner_name ?? row.handler_name ?? row.assigned_handler_name ?? "Unassigned",
    activeStage: row.active_stage ?? null,
    type: row.type ?? row.doc_type ?? row.document_type ?? "—",
    status: row.status ?? "In review",
    updated: formatDate(row.updated_at ?? row.updated),
    rejected: row.status === "Rejected",
    archived: Boolean(row.archived || row.is_archived || archivedAt),
    archivedAt,
  };
}

function mapComment(c) {
  return {
    id: c.id,
    author: c.author ?? "Unknown",
    initials: initialsFor(c.author),
    date: formatDate(c.created_at ?? c.date),
    text: c.body ?? c.text ?? "",
  };
}

// Each stage carries its own handler (assigned_handler_name). An empty stage
// renders "Unsigned"; there is no fallback to the document's handler.
function mapStage(stage) {
  return {
    order: stage.stage_order ?? stage.order,
    label: stage.label,
    detail: stage.detail,
    date: formatDate(stage.completed_at ?? stage.date),
    done: Boolean(stage.done),
    flag: Boolean(stage.flag),
    assignedHandlerName: stage.assigned_handler_name ?? null,
    registryNumber: stage.registry_number ?? null,
    releaseDestination: stage.release_destination ?? null,
    postingStartAt: stage.posting_start_at ?? null,
    postingEndAt: stage.posting_end_at ?? null,
    comments: (stage.comments || []).map(mapComment),
  };
}

function mapDocumentDetail(doc) {
  return {
    ...mapDocumentSummary(doc),
    registryNumber: doc.registry_number ?? null,
    releaseDestination: doc.release_destination ?? null,
    stages: (doc.stages || []).map(mapStage),
  };
}

// Recomputes the document-level registry number and release destination from
// the stages, so an optimistic change to a stage is reflected in the header.
function withDerivedFields(detail) {
  const registryStage = detail.stages.find(
    (s) => isRegistryNumberStageLabel(s.label) && s.registryNumber
  );
  const releaseStage = detail.stages.find(
    (s) => isReleasingStageLabel(s.label) && s.releaseDestination
  );
  return {
    ...detail,
    registryNumber: registryStage ? registryStage.registryNumber : null,
    releaseDestination: releaseStage ? releaseStage.releaseDestination : null,
  };
}

// Returns a new detail with one stage replaced by updater(stage).
function updateStage(detail, stageOrder, updater) {
  return withDerivedFields({
    ...detail,
    stages: detail.stages.map((s) => (s.order === stageOrder ? updater(s) : s)),
  });
}

// Active stage = first stage that is not done, or is flagged.
function getActiveIndex(stages) {
  return stages.findIndex((s) => !s.done || s.flag);
}

// ─────────────────────────────────────────────────────────────────────────
// Loading skeletons
// ─────────────────────────────────────────────────────────────────────────

const DetailSkeleton = () => (
  <div className="dt-card dt-detail-card" aria-busy="true" aria-label="Loading document">
    <div className="dt-card-head">
      <div style={{ flex: 1, minWidth: 0 }}>
        <Skeleton variant="text" w="60%" h={16} />
        <Skeleton variant="text" w="30%" style={{ marginTop: 8 }} />
      </div>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} style={{ display: "flex", gap: 14 }}>
          <Skeleton variant="pill" w={12} h={12} radius="50%" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <SkeletonText lines={2} gap="8px" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────
// List row
// ─────────────────────────────────────────────────────────────────────────

const DocumentRow = memo(function DocumentRow({ doc, selected, onSelect, isNew, leaving }) {
  // Rows still being saved (or queued offline) are shown but cannot be opened yet.
  const saving = Boolean(doc.pending);
  const style = saving
    ? STATUS_STYLES["In review"]
    : STATUS_STYLES[doc.status] || STATUS_STYLES["In review"];
  const badgeText = saving ? (doc.queued ? "Waiting to sync" : "Saving…") : doc.status;

  return (
    <button
      className="dt-row"
      data-selected={selected}
      data-new={isNew}
      data-leaving={leaving}
      data-pending={saving}
      aria-disabled={leaving || saving}
      disabled={saving}
      onClick={() => { if (!leaving && !saving) onSelect(doc.id); }}
    >
      <div className="dt-row-main">
        <span className="dt-row-id">
          <span className="dt-row-num">{doc.docNumber}</span>
          <span className="dt-row-type">{doc.type}</span>
        </span>
        <span className="dt-row-title">{doc.title}</span>
        <span className="dt-row-meta">
          <span>
            Handling <strong>{doc.owner}</strong>
            {doc.activeStage ? <> · {doc.activeStage}</> : null}
          </span>
          <span>Updated {doc.updated}</span>
        </span>
      </div>
      <div className="dt-row-side">
        <span className="dt-badge" style={{ color: style.fg, background: style.bg }}>
          {badgeText}
        </span>
      </div>
    </button>
  );
});

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

export default function DocumentTracking() {
  // ROLE POLICY:
  //  - Administrator: view-only on stages; can create, archive, restore,
  //    and permanently delete documents.
  //  - Non-admin: can work a stage (complete / request changes / reject /
  //    comment) only when the stage has a handler AND their role carries
  //    that stage's document_stage_* permission. Archived documents are
  //    read-only for everyone.
  const { is_admin, hasAccess } = usePermissions();
  const dbOnline = useOnlineStatus();

  // ── View and list state ──────────────────────────────────────────────
  const [viewMode, setViewMode] = useState("active");
  const viewModeRef = useRef("active");
  viewModeRef.current = viewMode;

  const [documents, setDocuments] = useState([]);
  const documentsRef = useRef([]);
  documentsRef.current = documents;

  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [visibleCount, setVisibleCount] = useState(DOCUMENT_PAGE_SIZE);
  const [filter, setFilter] = useState("All");

  // Documents removed on this device. Each entry: { archived, ts }.
  // Stops a stale server or cache copy from bringing back a removed row.
  const localRemovedRef = useRef(new Map());
  // Documents created on this device and confirmed by the server. Each entry: { archived, ts }.
  const localCreatedRef = useRef(new Map());
  // Creates still being saved, or queued offline. Keyed by temporary id.
  // Kept until the server lists the same doc_number, so no timer can drop them.
  const pendingCreatesRef = useRef(new Map());

  // Row animation state.
  const [justCreatedId, setJustCreatedId] = useState(null);
  const [leavingIds, setLeavingIds] = useState(() => new Set());

  // ── Selected document state ──────────────────────────────────────────
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [openStage, setOpenStage] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  // ── Form and feedback state ──────────────────────────────────────────
  const [draftComment, setDraftComment] = useState("");
  const [registryNumberInput, setRegistryNumberInput] = useState("");
  const [releaseDestinationInput, setReleaseDestinationInput] = useState("");
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false); // archive / restore / delete only
  const [justSaved, setJustSaved] = useState(false);
  const saveTimerRef = useRef(null);

  // "New Document" modal
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [newDocNumber, setNewDocNumber] = useState("");
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocType, setNewDocType] = useState(DOC_TYPES[0]);
  const [newDocTypeOther, setNewDocTypeOther] = useState("");
  const [newDocError, setNewDocError] = useState(null);
  const newDocNumberRef = useRef(null);
  const newDocTypeOtherRef = useRef(null);

  // "Request changes" modal
  const [flagStageOrder, setFlagStageOrder] = useState(null);
  const [flagNote, setFlagNote] = useState("");
  const [flagError, setFlagError] = useState(null);
  const flagNoteRef = useRef(null);

  // Generic confirm modal: { title, message, confirmLabel, danger, onConfirm } | null
  const [confirmModal, setConfirmModal] = useState(null);
  const confirmModalConfirmRef = useRef(null);

  // ── Refs ─────────────────────────────────────────────────────────────
  // Request-id tickets so an older response can never overwrite a newer one.
  const listRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const refreshTimerRef = useRef(null);

  const detailRef = useRef(null);
  detailRef.current = detail;

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // Action keys currently being sent. Stops the same action from being sent twice.
  const inFlightRef = useRef(new Set());
  // documentId -> number of writes not yet settled.
  const pendingWritesRef = useRef(new Map());

  // ── Small helpers ────────────────────────────────────────────────────
  const flashSaved = useCallback(() => {
    setJustSaved(true);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setJustSaved(false), 1200);
  }, []);
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  // Puts rows on screen for the current view. Keeps the selection when it
  // still exists, otherwise selects the first saved (non-pending) row.
  //
  // Rows still being created stay on screen until the server lists the same
  // doc_number. Recently removed rows stay hidden even if a stale copy lists them.
  const applyRows = useCallback((rows, archivedView) => {
    const now = Date.now();

    // Drop guards that have expired.
    for (const [id, e] of localRemovedRef.current) {
      if (now - e.ts >= LOCAL_GUARD_MS) localRemovedRef.current.delete(id);
    }
    for (const [id, e] of localCreatedRef.current) {
      if (now - e.ts >= LOCAL_GUARD_MS) localCreatedRef.current.delete(id);
    }

    // A guard only applies to the view it was made in.
    const isFresh = (e) => now - e.ts < LOCAL_GUARD_MS && e.archived === archivedView;

    const serverRows = (rows || [])
      .map(mapDocumentSummary)
      // Strict split on the client: Active shows only non-archived,
      // Archive shows only archived.
      .filter((d) => (archivedView ? d.archived : !d.archived));
    const serverIds = new Set(serverRows.map((d) => String(d.id)));
    const serverNumbers = new Set(serverRows.map((d) => d.docNumber));

    // The server now has these documents, so they no longer need a guard.
    for (const id of serverIds) localCreatedRef.current.delete(id);

    // Creates still in flight. Dropped once the server lists the same doc_number.
    const creates = [];
    for (const [key, row] of pendingCreatesRef.current) {
      if (serverNumbers.has(row.docNumber)) {
        pendingCreatesRef.current.delete(key);
      } else if (!archivedView) {
        creates.push(row);
      }
    }

    // Confirmed creates the server does not return yet.
    const confirmed = documentsRef.current.filter((d) => {
      if (d.pending) return false;
      const e = localCreatedRef.current.get(String(d.id));
      return Boolean(e) && isFresh(e) && !serverIds.has(String(d.id));
    });

    // Server rows, minus those removed on this device.
    const kept = serverRows.filter((d) => {
      const e = localRemovedRef.current.get(String(d.id));
      return !(e && isFresh(e));
    });

    // Combine and de-duplicate by id.
    const seen = new Set();
    const mapped = [];
    for (const d of [...creates, ...confirmed, ...kept]) {
      const k = String(d.id);
      if (seen.has(k)) continue;
      seen.add(k);
      mapped.push(d);
    }

    documentsRef.current = mapped;
    setDocuments(mapped);
    setSelectedId((prev) =>
      prev != null && mapped.some((d) => d.id === prev)
        ? prev
        : (mapped.find((d) => !d.pending)?.id ?? null)
    );
    return mapped;
  }, []);

  // Shows the saved copy only when the list is empty. Rows already on screen
  // are never replaced by an older copy. Returns true when the list is up to
  // date, false when the server failed.
  const loadList = useCallback(async (opts) => {
    const requestId = ++listRequestIdRef.current;
    const silent = opts?.silent === true;
    const archivedView = viewModeRef.current === "archived";

    const showingRows = documentsRef.current.length > 0;
    if (!silent) setListLoading(!showingRows);
    setListError(null);

    try {
      const rows = await withTimeout(trackingRead(
        archivedView ? "/api/documents?archived=true" : "/api/documents"
      ));
      // A newer request has already started and decides the outcome.
      if (listRequestIdRef.current !== requestId) return true;
      applyRows(rows, archivedView);
      return true;
    } catch (e) {
      if (listRequestIdRef.current !== requestId) return true;
      console.error("[DocumentTracking] Failed to load documents:", e);
      if (documentsRef.current.length === 0) {
        setListError(e.status === "no-snapshot"
          ? "Connect once to download offline data."
          : e.message || "Could not reach the server.");
      }
      return false;
    } finally {
      if (listRequestIdRef.current === requestId) setListLoading(false);
    }
  }, [applyRows]);

  // Loads the selected document. Silent refreshes are skipped while that
  // document still has unsettled writes; the last write to settle triggers one.
  // Returns true when the detail is up to date, false when the server failed.
  const loadDetail = useCallback(async (id, opts) => {
    if (id == null) {
      detailRequestIdRef.current += 1;
      setDetail(null);
      setDetailLoading(false);
      return true;
    }
    const key = String(id);
    if (opts?.silent && (pendingWritesRef.current.get(key) || 0) > 0) return true;

    const requestId = ++detailRequestIdRef.current;
    // Re-reading the document already on screen never flashes the skeleton.
    const silent = String(detailRef.current?.id) === key;
    if (!silent) {
      setDetailLoading(true);
      setDetailError(null);
    }
    try {
      const doc = await withTimeout(trackingRead(`/api/documents/${id}`));
      if (detailRequestIdRef.current !== requestId) return true;
      if (String(selectedIdRef.current) !== key) return true; // selection moved on
      setDetail(mapDocumentDetail(doc));
      return true;
    } catch (e) {
      if (detailRequestIdRef.current !== requestId) return true;
      console.error("[DocumentTracking] Failed to load document detail:", e);
      setDetailError(e.status === "no-snapshot"
        ? "Connect once to download offline data."
        : e.message || "Could not reach the server.");
      setDetail(null);
      return false;
    } finally {
      if (detailRequestIdRef.current === requestId) setDetailLoading(false);
    }
  }, []);

  // The single debounced refresh path. Used after writes, by realtime
  // signals, by the global documents-changed event, and after reconnects.
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      loadList({ silent: true });
      if (selectedIdRef.current != null) {
        loadDetail(selectedIdRef.current, { silent: true });
      }
    }, REFRESH_DEBOUNCE_MS);
  }, [loadList, loadDetail]);

  // Manual refresh (the global Refresh button via RefreshContext).
  // The list reloads non-silently so the loading state shows when nothing is
  // cached. The detail reloads silently so its card does not flash.
  // Throws on failure so the Topbar shows a failed state.
  const refreshAll = useCallback(async () => {
    const listOk = await loadList();
    if (!listOk) throw new Error("Could not refresh the document list.");

    if (selectedIdRef.current != null) {
      const detailOk = await loadDetail(selectedIdRef.current, { silent: true });
      if (!detailOk) throw new Error("Could not refresh the selected document.");
    }
  }, [loadList, loadDetail]);

  // Always runs the latest refreshAll, so no extra wrapper is needed.
  useRegisterRefresh(refreshAll);

  // ── Write tracking ───────────────────────────────────────────────────
  const beginWrite = (docId) => {
    const key = String(docId);
    pendingWritesRef.current.set(key, (pendingWritesRef.current.get(key) || 0) + 1);
  };

  const endWrite = useCallback((docId) => {
    const key = String(docId);
    const remaining = (pendingWritesRef.current.get(key) || 1) - 1;
    if (remaining > 0) {
      pendingWritesRef.current.set(key, remaining);
    } else {
      pendingWritesRef.current.delete(key);
    }
  }, []);

  // Applies a change to the selected document only if it is still the one shown.
  const patchDetail = useCallback((docId, fn) => {
    setDetail((d) => (d && String(d.id) === String(docId) ? fn(d) : d));
  }, []);

  // The one path every stage action uses:
  //  1. Update the screen now (apply).
  //  2. Send the request in the background.
  //  3. On success, run onSuccess and confirm.
  //  4. On failure, show the error and run onError.
  //  5. Always schedule one debounced refresh to re-sync from the server.
  const performWrite = useCallback(({
    docId, key, apply, request, successMsg, errorFallback, onSuccess, onError,
  }) => {
    if (key) {
      if (inFlightRef.current.has(key)) return;
      inFlightRef.current.add(key);
    }
    setActionError(null);
    if (apply) patchDetail(docId, apply);
    beginWrite(docId);

    Promise.resolve()
      .then(() => request())
      .then((result) => {
        if (onSuccess) onSuccess(result);
        if (successMsg) {
          notify(
            result?.queued ? `${successMsg} Saved on this device, will sync when online.` : successMsg,
            "success"
          );
        }
        flashSaved();
      })
      .catch((e) => {
        console.error("[DocumentTracking] Action failed:", e);
        const message = e?.message || errorFallback || "Something went wrong.";
        setActionError(message);
        notify(message, "error");
        if (onError) onError();
      })
      .finally(() => {
        if (key) inFlightRef.current.delete(key);
        endWrite(docId);
        scheduleRefresh();
      });
  }, [patchDetail, flashSaved, scheduleRefresh, endWrite]);

  // ── Effects: load, selection, realtime, sync ─────────────────────────
  useEffect(() => { loadList(); }, [loadList]);

  // Re-evaluates the posting-period countdown every CLOCK_TICK_MS.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Clears the pending refresh timer when the page unmounts.
  useEffect(() => {
    return () => clearTimeout(refreshTimerRef.current);
  }, []);

  // Realtime: the database trigger sends a Broadcast signal on
  // 'document-tracking'. The signal carries only the table name; the data is
  // re-read through the Flask API, which still enforces login, admin and
  // stage permissions. Also refreshes on the global event and on reconnect.
  useEffect(() => {
    window.addEventListener("documents-changed", scheduleRefresh);
    const unsubDb = subscribeDb((ok) => {
      if (ok) scheduleRefresh();
    });
    const channel = supabase
      .channel("document-tracking")
      .on("broadcast", { event: "changed" }, scheduleRefresh)
      .subscribe((status) => console.log("[document-tracking]", status));

    return () => {
      window.removeEventListener("documents-changed", scheduleRefresh);
      unsubDb();
      channel.unsubscribe();
    };
  }, [scheduleRefresh]);

  useEffect(() => {
    setOpenStage(null);
    setDraftComment("");
    setRegistryNumberInput("");
    setReleaseDestinationInput("");
    setActionError(null);
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // When the sync queue finishes, reload so queued changes show their real state.
  useEffect(() => {
    let wasSyncing = false;
    return subscribeSyncState((s) => {
      if (wasSyncing && !s.syncing) scheduleRefresh();
      wasSyncing = s.syncing;
    });
  }, [scheduleRefresh]);

  useEffect(() => {
    if (newDocOpen && newDocNumberRef.current) newDocNumberRef.current.focus();
  }, [newDocOpen]);

  useEffect(() => {
    if (newDocType === "Other" && newDocTypeOtherRef.current) newDocTypeOtherRef.current.focus();
  }, [newDocType]);

  useEffect(() => {
    if (flagStageOrder != null && flagNoteRef.current) flagNoteRef.current.focus();
  }, [flagStageOrder]);

  useEffect(() => {
    if (confirmModal && confirmModalConfirmRef.current) confirmModalConfirmRef.current.focus();
  }, [confirmModal]);

  // ── Derived data ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return documents.filter((doc) => {
      const matchesFilter = filter === "All" || doc.status === filter;
      const matchesQuery =
        !q ||
        doc.title.toLowerCase().includes(q) ||
        String(doc.id).toLowerCase().includes(q) ||
        doc.docNumber.toLowerCase().includes(q) ||
        doc.owner.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [documents, deferredQuery, filter]);

  const visibleDocuments = filtered.slice(0, visibleCount);

  // Never show a detail that belongs to a different document than the one selected.
  const selected = detail && String(detail.id) === String(selectedId) ? detail : null;
  // Archived documents are paused: no active stage, so no action panels.
  const activeIndex = selected && !selected.archived ? getActiveIndex(selected.stages) : -1;
  const inArchive = viewMode === "archived";
  const requiresPosting = selected ? REQUIRES_POSTING_PATTERN.test(selected.type || "") : false;

  // Detail pane shows a skeleton while the detail loads, or while the list
  // is loading and there is no selected document yet.
  const showDetailSkeleton = detailLoading || (listLoading && !selected);

  // ── Navigation ───────────────────────────────────────────────────────
  // Switches between the active list and the archive. The old view's rows are
  // cleared so the new view's saved copy is the one shown.
  const switchView = (mode) => {
    if (mode === viewModeRef.current) return;
    viewModeRef.current = mode;
    setViewMode(mode);
    setVisibleCount(DOCUMENT_PAGE_SIZE);
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setConfirmModal(null);
    documentsRef.current = [];
    setDocuments([]);
    loadList();
  };

  const toggleStage = (index, hasComments) => {
    if (!hasComments) return;
    setOpenStage((prev) => (prev === index ? null : index));
  };

  // ── Archive / restore / permanent delete ─────────────────────────────
  // Removes a document from the visible list right away and moves the
  // selection to the next saved row. Only changes the screen, not the server.
  const removeFromListLocally = (id) => {
    const remaining = documentsRef.current.filter((d) => String(d.id) !== String(id));
    documentsRef.current = remaining;
    setDocuments(remaining);
    if (String(selectedIdRef.current) === String(id)) {
      setSelectedId(remaining.find((d) => !d.pending)?.id ?? null);
      setDetail(null);
    }
  };

  // Shared path for archive, restore and permanent delete.
  //  1. Play the leave animation and block the row from coming back.
  //  2. Send the request in parallel with the animation.
  //  3. Remove the row after the animation. On success, update the local copy
  //     and refresh in the background.
  //  4. On failure, put the row back exactly as it was and show the error.
  const runDocumentOperation = async ({ id, call, onSuccessLocal, successMsg, offlineMsg }) => {
    if (!isDbAvailable()) {
      notify(offlineMsg, "error");
      return;
    }

    const key = String(id);
    const snapshot = documentsRef.current;
    const previousSelected = selectedIdRef.current;

    setBusy(true);
    setActionError(null);

    // 1. Play the leave animation and block the row from coming back.
    setLeavingIds((prev) => new Set(prev).add(key));
    localRemovedRef.current.set(key, {
      archived: viewModeRef.current === "archived",
      ts: Date.now(),
    });

    // 2. Send the request in parallel with the animation.
    const request = Promise.resolve()
      .then(() => call())
      .then(() => ({ error: null }), (error) => ({ error }));

    await wait(LEAVE_ANIM_MS);

    // 3. Take the row out after the animation.
    removeFromListLocally(id);
    setLeavingIds((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

    const { error } = await request;
    setBusy(false);

    if (!error) {
      onSuccessLocal?.();
      flashSaved();
      notify(successMsg, "success");
      scheduleRefresh();
      return;
    }

    // 4. Failed: put the row back exactly as it was.
    console.error("[DocumentTracking] Server action failed:", error);
    localRemovedRef.current.delete(key);
    documentsRef.current = snapshot;
    setDocuments(snapshot);
    setSelectedId(previousSelected);
    const message = error.message || "Something went wrong.";
    setActionError(message);
    notify(message, "error");
  };

  // Returns the selected document id as a positive integer, or null.
  const validSelectedId = () => {
    const id = Number(selectedIdRef.current);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  const archiveDocument = () => {
    const id = validSelectedId();
    if (id == null) {
      notify("Could not find the document to archive. Please refresh the page.", "error");
      return;
    }
    runDocumentOperation({
      id,
      call: () => apiFetch(`/api/documents/${id}/archive`, { method: "POST" }),
      onSuccessLocal: () => markArchivedLocally(id, true),
      successMsg: "Document moved to archive.",
      offlineMsg: "Archiving needs the connection. Try again when it returns.",
    });
  };

  const restoreDocument = () => {
    const id = validSelectedId();
    if (id == null) {
      notify("Could not find the document to restore. Please refresh the page.", "error");
      return;
    }
    runDocumentOperation({
      id,
      call: () => apiFetch(`/api/documents/${id}/restore`, { method: "POST" }),
      onSuccessLocal: () => markArchivedLocally(id, false),
      successMsg: "Document restored to the active list.",
      offlineMsg: "Restoring needs the connection. Try again when it returns.",
    });
  };

  const deleteDocumentPermanently = () => {
    const id = validSelectedId();
    if (id == null) {
      notify("Could not find the document to delete. Please refresh the page.", "error");
      return;
    }
    runDocumentOperation({
      id,
      call: () => apiFetch(`/api/documents/${id}`, { method: "DELETE" }),
      successMsg: "Document permanently deleted.",
      offlineMsg: "Deleting needs the connection. Try again when it returns.",
    });
  };

  // ── Stage actions (optimistic) ───────────────────────────────────────
  const advanceStage = (docId, stage) =>
    performWrite({
      docId,
      key: `complete:${docId}:${stage.order}`,
      apply: (d) => updateStage(d, stage.order, (s) => ({
        ...s,
        done: true,
        flag: false,
        date: formatDate(new Date().toISOString()),
      })),
      request: () => trackingWrite({
        path: `/api/documents/${docId}/stages/${stage.order}/complete`,
        label: `Mark step complete (doc ${docId})`,
      }),
      successMsg: "Step marked complete.",
      errorFallback: "Could not complete this step.",
    });

  const submitComment = (docId, stage, stageIndex) => {
    const body = draftComment.trim();
    if (!body) return;

    const tempComment = {
      id: `tmp-${Date.now()}`,
      author: "You",
      initials: "YO",
      date: formatDate(new Date().toISOString()),
      text: body,
    };

    setDraftComment("");
    setOpenStage(stageIndex);

    performWrite({
      docId,
      apply: (d) => updateStage(d, stage.order, (s) => ({
        ...s,
        comments: [...s.comments, tempComment],
      })),
      request: () => trackingWrite({
        path: `/api/documents/${docId}/stages/${stage.order}/comments`,
        json: { body },
        label: `Add comment (doc ${docId})`,
      }),
      successMsg: "Comment added.",
      errorFallback: "Could not add this comment.",
      onError: () => {
        // Give the text back so the user does not have to retype it.
        if (String(selectedIdRef.current) === String(docId)) {
          setDraftComment((current) => current || body);
        }
      },
    });
  };

  const submitFlagStage = () => {
    const note = flagNote.trim();
    if (!note) {
      setFlagError("Please describe what needs to change.");
      return;
    }
    const docId = selectedIdRef.current;
    const order = flagStageOrder;

    const tempComment = {
      id: `tmp-${Date.now()}`,
      author: "You",
      initials: "YO",
      date: formatDate(new Date().toISOString()),
      text: note,
    };

    // Close the modal at once. If the request fails it reopens with the note.
    setFlagStageOrder(null);
    setFlagNote("");
    setFlagError(null);

    performWrite({
      docId,
      key: `flag:${docId}:${order}`,
      apply: (d) => updateStage(d, order, (s) => ({
        ...s,
        flag: true,
        done: false,
        comments: [...s.comments, tempComment],
      })),
      request: () => trackingWrite({
        path: `/api/documents/${docId}/stages/${order}/flag`,
        json: { note },
        label: `Request changes (doc ${docId})`,
      }),
      successMsg: "Changes requested.",
      errorFallback: "Could not submit this request.",
      onError: () => {
        if (String(selectedIdRef.current) === String(docId)) {
          setFlagStageOrder(order);
          setFlagNote(note);
        }
      },
    });
  };

  const rejectDocument = (docId) =>
    performWrite({
      docId,
      key: `reject:${docId}`,
      apply: (d) => ({ ...d, rejected: true, status: "Rejected" }),
      request: () => trackingWrite({
        path: `/api/documents/${docId}/reject`,
        label: `Reject document (doc ${docId})`,
      }),
      successMsg: "Document rejected.",
      errorFallback: "Could not reject this document.",
    });

  const saveRegistryNumber = (docId, stage, value) =>
    performWrite({
      docId,
      key: `registry:${docId}:${stage.order}`,
      apply: (d) => updateStage(d, stage.order, (s) => ({ ...s, registryNumber: value })),
      request: () => trackingWrite({
        path: `/api/documents/${docId}/stages/${stage.order}/registry-number`,
        json: { registry_number: value },
        label: `Save registry number (doc ${docId})`,
      }),
      successMsg: "Registry number saved.",
      errorFallback: "Could not save the registry number.",
    });

  const saveReleaseDestination = (docId, stage, value) =>
    performWrite({
      docId,
      key: `release:${docId}:${stage.order}`,
      apply: (d) => updateStage(d, stage.order, (s) => ({ ...s, releaseDestination: value })),
      request: () => trackingWrite({
        path: `/api/documents/${docId}/stages/${stage.order}/release-destination`,
        json: { destination: value },
        label: `Save release destination (doc ${docId})`,
      }),
      successMsg: "Release destination saved.",
      errorFallback: "Could not save the release destination.",
    });

  const startPostingPeriod = (docId, stage) => {
    const startIso = new Date().toISOString();
    const endIso = new Date(Date.now() + POSTING_PERIOD_MS).toISOString();

    performWrite({
      docId,
      key: `posting:${docId}:${stage.order}`,
      apply: (d) => updateStage(d, stage.order, (s) => ({
        ...s,
        postingStartAt: startIso,
        postingEndAt: endIso,
      })),
      request: () => trackingWrite({
        path: `/api/documents/${docId}/stages/${stage.order}/posting-period`,
        label: `Start posting period (doc ${docId})`,
      }),
      onSuccess: (res) => patchDetail(docId, (d) => updateStage(d, stage.order, (s) => ({
        ...s,
        postingStartAt: res?.posting_start_at ?? startIso,
        postingEndAt: res?.posting_end_at ?? endIso,
      }))),
      successMsg: "Posting period started.",
      errorFallback: "Could not start the posting period.",
    });
  };

  // ── New document (optimistic) ────────────────────────────────────────
  const resetNewDocForm = () => {
    setNewDocNumber("");
    setNewDocTitle("");
    setNewDocType(DOC_TYPES[0]);
    setNewDocTypeOther("");
  };

  // Replaces one row in the list (or removes it when nextRow is null).
  // The new row goes to the top, matching the server's order.
  const replaceDocumentRow = (oldId, nextRow) => {
    const next = [
      ...(nextRow ? [nextRow] : []),
      ...documentsRef.current.filter(
        (d) =>
          String(d.id) !== String(oldId) &&
          (!nextRow || String(d.id) !== String(nextRow.id))
      ),
    ];
    documentsRef.current = next;
    setDocuments(next);
  };

  // The new row appears in the list immediately, marked "Saving…". It is
  // replaced by the real row when the server confirms, or removed (and the
  // form reopened with the entered values) when the request fails.
  const submitNewDocument = () => {
    const docNumber = newDocNumber.trim();
    const title = newDocTitle.trim();
    const resolvedType = newDocType === "Other" ? newDocTypeOther.trim() : newDocType;

    if (!docNumber) {
      setNewDocError("Document number is required.");
      return;
    }
    if (!title) {
      setNewDocError("Title is required.");
      return;
    }
    if (!resolvedType) {
      setNewDocError(
        newDocType === "Other" ? "Please type the document type." : "Document type is required."
      );
      return;
    }

    const snapshot = {
      docNumber: newDocNumber,
      title: newDocTitle,
      type: newDocType,
      typeOther: newDocTypeOther,
    };

    const tempKey = `tmp-${Date.now()}`;
    const tempRow = {
      id: tempKey,
      docNumber,
      title,
      owner: "Unassigned",
      activeStage: null,
      type: resolvedType,
      status: "In review",
      updated: formatDate(new Date().toISOString()),
      rejected: false,
      archived: false,
      archivedAt: null,
      pending: true,
      queued: false,
    };

    setNewDocError(null);
    setNewDocOpen(false);
    resetNewDocForm();

    // Show the row now, before the server replies.
    pendingCreatesRef.current.set(tempKey, tempRow);
    replaceDocumentRow(tempKey, tempRow);

    trackingWrite({
      path: "/api/documents",
      json: { doc_number: docNumber, title, doc_type: resolvedType },
      label: `New document ${docNumber}`,
    })
      .then((created) => {
        if (created?.id != null) {
          // Confirmed by the server: swap the temporary row for the real one.
          pendingCreatesRef.current.delete(tempKey);
          const real = mapDocumentSummary(created);
          const realKey = String(real.id);
          localCreatedRef.current.set(realKey, { archived: false, ts: Date.now() });
          localRemovedRef.current.delete(realKey);

          const inActive = viewModeRef.current === "active";
          replaceDocumentRow(tempKey, inActive ? real : null);

          if (inActive) {
            setSelectedId(real.id);
            setJustCreatedId(real.id);
            setTimeout(
              () => setJustCreatedId((current) => (current === real.id ? null : current)),
              NEW_ROW_ANIM_MS
            );
          }
          flashSaved();
          notify("Document created.", "success");
        } else {
          // Queued offline: keep the row, marked until it syncs.
          const queuedRow = { ...tempRow, queued: true };
          pendingCreatesRef.current.set(tempKey, queuedRow);
          replaceDocumentRow(tempKey, queuedRow);
          notify("Saved on this device. It will sync when the connection returns.", "success");
        }
      })
      .catch((e) => {
        console.error("[DocumentTracking] Failed to create document:", e);
        pendingCreatesRef.current.delete(tempKey);
        replaceDocumentRow(tempKey, null);

        const message = e?.message || "Could not create this document.";
        notify(message, "error");
        // Reopen the form with the entered values so nothing is lost.
        setNewDocNumber(snapshot.docNumber);
        setNewDocTitle(snapshot.title);
        setNewDocType(snapshot.type);
        setNewDocTypeOther(snapshot.typeOther);
        setNewDocError(message);
        setNewDocOpen(true);
      })
      .finally(() => scheduleRefresh());
  };

  // ── Confirm dialogs ──────────────────────────────────────────────────
  const askArchive = () =>
    setConfirmModal({
      title: "Move to archive",
      message: `Move ${selected.docNumber} to the archive? Processing will pause and it will be hidden from the active list. You can restore it anytime from the Archive.`,
      confirmLabel: "Archive",
      danger: false,
      onConfirm: () => {
        setConfirmModal(null);
        archiveDocument();
      },
    });

  const askPermanentDelete = () =>
    setConfirmModal({
      title: "Delete permanently",
      message: `Permanently delete ${selected.docNumber}? This cannot be undone and the document will be removed from the system.`,
      confirmLabel: "Delete permanently",
      danger: true,
      onConfirm: () => {
        setConfirmModal(null);
        deleteDocumentPermanently();
      },
    });

  const askReject = () =>
    setConfirmModal({
      title: "Reject document",
      message: `Reject ${selected.docNumber}? This stops the pipeline.`,
      confirmLabel: "Reject",
      danger: true,
      onConfirm: () => {
        setConfirmModal(null);
        rejectDocument(selected.id);
      },
    });

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="dt-root">
      <div className="dt-page">
        {!dbOnline && (
          <div className="dt-offline-banner" role="status">
            You are offline. Your changes are saved on this device and will be
            uploaded automatically when the internet connection comes back.
          </div>
        )}

        <div className="dt-view-switch" role="tablist" aria-label="Choose which documents to show">
          {VIEW_MODES.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={viewMode === v.key}
              className="dt-view-btn"
              data-active={viewMode === v.key}
              onClick={() => switchView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="dt-tabs" role="tablist" aria-label="Filter documents by status">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className="dt-tab"
              data-active={filter === f}
              onClick={() => {
                setVisibleCount(DOCUMENT_PAGE_SIZE);
                setFilter(f);
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {listError && (
          <div className="dt-empty" style={{ marginBottom: 12 }} role={listError === "Connect once to download offline data." ? "status" : undefined}>
            {listError === "Connect once to download offline data."
              ? listError
              : <>Could not load documents: {listError}{" "}
                <button className="dt-btn dt-btn-ghost" onClick={() => loadList()}>Retry</button></>}
          </div>
        )}

        <div className="dt-grid" style={{ alignItems: "stretch" }}>
          {/* ── Document list ── */}
          <div className="dt-card dt-list-card">
            <div className="dt-card-head">
              <div>
                <h2>{inArchive ? "Archive" : "Documents"}</h2>
                <p>
                  {listLoading
                    ? "Loading…"
                    : listError
                    ? "Could not load"
                    : `${visibleDocuments.length} of ${filtered.length} shown`}
                </p>
              </div>
              <div className="dt-toolbar">
                {is_admin && !inArchive && (
                  <button
                    type="button"
                    className="dt-btn dt-btn-primary dt-btn-lg"
                    onClick={() => {
                      setNewDocError(null);
                      setNewDocOpen(true);
                    }}
                  >
                    + New Document
                  </button>
                )}
                <input
                  id="dt-search-input"
                  name="document-search"
                  className="dt-search"
                  type="text"
                  placeholder="Search title, ID, owner"
                  aria-label="Search documents by title, ID or owner"
                  value={query}
                  onChange={(e) => {
                    setVisibleCount(DOCUMENT_PAGE_SIZE);
                    setQuery(e.target.value);
                  }}
                />
              </div>
            </div>

            <div className="dt-list" aria-busy={listLoading}>
              {listLoading && documents.length === 0 && (
                <>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div className="dt-skeleton-row" key={`dt-skeleton-${i}`} aria-hidden="true">
                      <div className="dt-skeleton-main">
                        <Skeleton variant="text" w="38%" />
                        <Skeleton variant="text" w="68%" h={12} />
                        <Skeleton variant="text" w="52%" />
                      </div>
                      <Skeleton variant="pill" w={62} h={21} />
                    </div>
                  ))}
                </>
              )}

              {!listLoading && filtered.length === 0 && (
                <div className="dt-empty">
                  {listError
                    ? "The list could not be loaded. Use Retry above."
                    : inArchive && documents.length === 0
                    ? "The archive is empty."
                    : "No documents match this search or filter."}
                </div>
              )}

              {visibleDocuments.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  selected={selectedId === doc.id}
                  isNew={justCreatedId === doc.id}
                  leaving={leavingIds.has(String(doc.id))}
                  onSelect={setSelectedId}
                />
              ))}
            </div>

            {filtered.length > visibleDocuments.length && (
              <button
                type="button"
                className="dt-btn dt-btn-ghost"
                onClick={() => setVisibleCount((count) => count + DOCUMENT_PAGE_SIZE)}
              >
                Show more ({filtered.length - visibleDocuments.length})
              </button>
            )}
          </div>

          {/* ── Detail states ── */}
          {showDetailSkeleton && <DetailSkeleton />}

          {!showDetailSkeleton && !detailLoading && detailError && (
            <div className="dt-card dt-detail-card">
              <div className="dt-empty" role={detailError === "Connect once to download offline data." ? "status" : undefined}>
                {detailError === "Connect once to download offline data."
                  ? detailError
                  : <>Could not load this document: {detailError}{" "}
                    <button className="dt-btn dt-btn-ghost" onClick={() => loadDetail(selectedId)}>Retry</button></>}
              </div>
            </div>
          )}

          {!showDetailSkeleton && !detailError && !selected && (
            <div className="dt-card dt-detail-card">
              <div
                className="dt-empty"
                style={{
                  minHeight: 240,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  gap: 8,
                }}
              >
                {listError ? (
                  listError === "Connect once to download offline data."
                    ? listError
                    : <>
                      Could not load documents.{" "}
                      <button className="dt-btn dt-btn-ghost" onClick={() => loadList()}>Retry</button>
                    </>
                ) : selectedId != null ? (
                  <>
                    Loading document…{" "}
                    <button className="dt-btn dt-btn-ghost" onClick={() => loadDetail(selectedId)}>Retry</button>
                  </>
                ) : documents.length === 0 ? (
                  inArchive
                    ? "Nothing archived yet."
                    : "No documents yet — they'll appear here once submitted."
                ) : (
                  "Select a document from the list to see its details."
                )}
              </div>
            </div>
          )}

          {/* ── Selected document ── */}
          {!showDetailSkeleton && !detailError && selected && (
            <div className="dt-card dt-detail-card">
              <div className="dt-card-head">
                <div>
                  <h2>{selected.title}</h2>
                  <p className="dt-detail-docno">{selected.docNumber}</p>
                  {(selected.registryNumber || selected.releaseDestination) && (
                    <p style={{ fontSize: 12, color: "var(--ink-mid)", margin: "2px 0 0" }}>
                      {selected.registryNumber && <>Registry No. <strong>{selected.registryNumber}</strong></>}
                      {selected.registryNumber && selected.releaseDestination && " · "}
                      {selected.releaseDestination && <>Released to <strong>{selected.releaseDestination}</strong></>}
                    </p>
                  )}
                </div>
                <div className="dt-head-actions">
                  <span className="dt-save-note">{justSaved ? "Saved" : "\u00A0"}</span>
                  {is_admin && !selected.archived && (
                    <button type="button" className="dt-btn dt-btn-primary" disabled={busy} onClick={askArchive}>
                      Archive
                    </button>
                  )}
                  {is_admin && selected.archived && (
                    <>
                      <button type="button" className="dt-btn dt-btn-primary" disabled={busy} onClick={restoreDocument}>
                        Restore
                      </button>
                      <button type="button" className="dt-btn dt-btn-danger" disabled={busy} onClick={askPermanentDelete}>
                        Delete permanently
                      </button>
                    </>
                  )}
                </div>
              </div>

              {selected.archived && (
                <div className="dt-archived-banner" role="status">
                  This document is in the archive
                  {selected.archivedAt ? ` since ${formatDate(selected.archivedAt)}` : ""}.
                  Processing is paused
                  {is_admin ? ". Restore it to continue, or delete it permanently." : "."}
                </div>
              )}

              {actionError && (
                <div className="dt-empty" style={{ marginBottom: 12 }}>{actionError}</div>
              )}

              <ul className="dt-timeline">
                {selected.stages.map((stage, i) => {
                  const hasComments = stage.comments.length > 0;
                  const isOpen = openStage === i;
                  const isActive = i === activeIndex && !selected.rejected;

                  const isRegistryStage = isRegistryNumberStageLabel(stage.label);
                  const isReleaseStage = isReleasingStageLabel(stage.label);
                  const isPostingStage = isPostingPeriodStageLabel(stage.label);

                  // Posting period gating (Late Registration only).
                  const postingEndMs = stage.postingEndAt ? new Date(stage.postingEndAt).getTime() : null;
                  const postingStarted = isPostingStage && Boolean(stage.postingStartAt);
                  const postingRunning =
                    postingStarted && (postingEndMs == null || now < postingEndMs);
                  const postingNotStarted = isPostingStage && requiresPosting && !stage.postingStartAt;
                  const postingNeedsComment = postingStarted && !postingRunning && !hasComments;

                  const registryMissing = isRegistryStage && !stage.registryNumber;
                  const releaseMissing = isReleaseStage && !stage.releaseDestination;

                  let disabledReason = null;
                  if (postingNotStarted) {
                    disabledReason = `Start the ${POSTING_PERIOD_DAYS}-day posting period before this step can be completed.`;
                  } else if (postingRunning) {
                    disabledReason = `Mark complete unlocks once the ${POSTING_PERIOD_DAYS}-day posting period ends${
                      stage.postingEndAt ? ` (${formatDate(stage.postingEndAt)})` : ""
                    }.`;
                  } else if (postingNeedsComment) {
                    disabledReason = "Add a comment on this step before it can be completed.";
                  } else if (registryMissing) {
                    disabledReason = "Enter and save the Registry Number before this step can be completed.";
                  } else if (releaseMissing) {
                    disabledReason = "Select the release destination before this step can be completed.";
                  }
                  const markCompleteDisabled = disabledReason !== null;

                  // Does the user's role carry this stage's permission?
                  const stagePermission = stagePermissionForLabel(stage.label);
                  const userHasStageAccess = !stagePermission || hasAccess(stagePermission);

                  const handlerName = stage.assignedHandlerName || UNSIGNED_LABEL;
                  const isUnassigned = handlerName === UNSIGNED_LABEL;

                  return (
                    <li
                      key={stage.order ?? i}
                      className="dt-step"
                      data-done={stage.done}
                      data-flag={stage.flag}
                      data-active={isActive}
                    >
                      <span className="dt-step-dot" />
                      <div className="dt-step-body">
                        <button
                          type="button"
                          className="dt-step-header"
                          data-clickable={hasComments}
                          onClick={() => toggleStage(i, hasComments)}
                          disabled={!hasComments}
                        >
                          <div className="dt-step-heading-text">
                            <p className="dt-step-docno">Document No: {selected.docNumber}</p>
                            <p className="dt-step-label">{stage.label}</p>
                            <p className="dt-step-detail">{stage.detail}</p>
                            <p className="dt-step-date">{stage.date}</p>
                            {isRegistryStage && stage.registryNumber && (
                              <p className="dt-step-detail" style={{ marginTop: 2 }}>
                                Registry Number: <strong>{stage.registryNumber}</strong>
                              </p>
                            )}
                            {isReleaseStage && stage.releaseDestination && (
                              <p className="dt-step-detail" style={{ marginTop: 2 }}>
                                Released to: <strong>{stage.releaseDestination}</strong>
                              </p>
                            )}
                            {isPostingStage && stage.postingStartAt && (
                              <p className="dt-step-detail" style={{ marginTop: 2 }}>
                                Posted {formatDate(stage.postingStartAt)} —{" "}
                                {postingRunning
                                  ? <>required until <strong>{formatDate(stage.postingEndAt)}</strong></>
                                  : <>posting period complete</>}
                              </p>
                            )}
                          </div>
                          {hasComments && (
                            <span className="dt-step-comment-btn" data-open={isOpen}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                                <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              {stage.comments.length}
                              <svg className="dt-step-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none">
                                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </span>
                          )}
                        </button>

                        <div className="dt-handler-row" style={{ marginTop: 6 }}>
                          <span className="dt-handler-label">Currently handling:</span>
                          <span className="dt-handler-name" data-unsigned={isUnassigned}>{handlerName}</span>
                        </div>

                        {hasComments && isOpen && (
                          <ul className="dt-comment-list">
                            {stage.comments.map((c) => (
                              <li key={c.id} className="dt-comment">
                                <span className="dt-comment-avatar">{c.initials}</span>
                                <div className="dt-comment-body">
                                  <div className="dt-comment-meta">
                                    <span className="dt-comment-author">{c.author}</span>
                                    <span className="dt-comment-date">{c.date}</span>
                                  </div>
                                  <p className="dt-comment-text">{c.text}</p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Blocked: active stage with nobody assigned. */}
                        {isActive && isUnassigned && (
                          <div className="dt-active-panel dt-active-panel-blocked">
                            <span className="dt-active-panel-label">
                              Unassigned — assign a handler before this step can be worked
                            </span>
                          </div>
                        )}

                        {/* Action panel: active stage, non-admin, has a handler, role covers this stage. */}
                        {isActive && !is_admin && !isUnassigned && userHasStageAccess && (
                          <div className="dt-active-panel">
                            <span className="dt-active-panel-label">Current step — action needed</span>

                            {isPostingStage && (
                              <div style={{ marginBottom: 10 }}>
                                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>
                                  Posting Period ({POSTING_PERIOD_DAYS} days)
                                </label>
                                {!stage.postingStartAt ? (
                                  <button
                                    type="button"
                                    className="dt-btn dt-btn-primary"
                                    onClick={() => startPostingPeriod(selected.id, stage)}
                                  >
                                    10 Days Registration
                                  </button>
                                ) : (
                                  <p style={{ fontSize: 13, color: "var(--ink-mid)", margin: 0 }}>
                                    {postingRunning
                                      ? <>Posted since {formatDate(stage.postingStartAt)} — required until <strong>{formatDate(stage.postingEndAt)}</strong>.</>
                                      : <>Posting period complete (ended {formatDate(stage.postingEndAt)}).</>}
                                  </p>
                                )}
                              </div>
                            )}

                            {isRegistryStage && (
                              <div style={{ marginBottom: 10 }}>
                                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>
                                  Registry Number
                                </label>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <input
                                    id={`dt-registry-number-${stage.order ?? i}`}
                                    name="registry-number"
                                    type="text"
                                    placeholder="e.g. 2026-00458"
                                    value={stage.registryNumber || registryNumberInput}
                                    disabled={Boolean(stage.registryNumber)}
                                    onChange={(e) => setRegistryNumberInput(e.target.value)}
                                    style={{
                                      flex: 1, fontSize: 14, padding: "8px 10px",
                                      border: "1px solid var(--line-strong)", borderRadius: 6, outline: "none",
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className="dt-btn dt-btn-primary"
                                    disabled={Boolean(stage.registryNumber) || !registryNumberInput.trim()}
                                    onClick={() => saveRegistryNumber(selected.id, stage, registryNumberInput.trim())}
                                  >
                                    {stage.registryNumber ? "Saved" : "Save"}
                                  </button>
                                </div>
                              </div>
                            )}

                            {isReleaseStage && (
                              <div style={{ marginBottom: 10 }}>
                                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>
                                  Release destination
                                </label>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <select
                                    id={`dt-release-destination-${stage.order ?? i}`}
                                    name="release-destination"
                                    value={stage.releaseDestination || releaseDestinationInput}
                                    disabled={Boolean(stage.releaseDestination)}
                                    onChange={(e) => setReleaseDestinationInput(e.target.value)}
                                    style={{
                                      flex: 1, fontSize: 14, padding: "8px 10px",
                                      border: "1px solid var(--line-strong)", borderRadius: 6, outline: "none",
                                    }}
                                  >
                                    <option value="" disabled>Select destination…</option>
                                    {RELEASE_DESTINATIONS.map((d) => (
                                      <option key={d} value={d}>{d}</option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="dt-btn dt-btn-primary"
                                    disabled={Boolean(stage.releaseDestination) || !releaseDestinationInput}
                                    onClick={() => saveReleaseDestination(selected.id, stage, releaseDestinationInput)}
                                  >
                                    {stage.releaseDestination ? "Saved" : "Save"}
                                  </button>
                                </div>
                              </div>
                            )}

                            <div className="dt-action-row">
                              <button
                                type="button"
                                className="dt-btn dt-btn-primary"
                                disabled={markCompleteDisabled}
                                onClick={() => advanceStage(selected.id, stage)}
                                style={markCompleteDisabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                                title={disabledReason || undefined}
                              >
                                Mark complete → next step
                              </button>
                              <button
                                type="button"
                                className="dt-btn dt-btn-ghost"
                                onClick={() => {
                                  setFlagError(null);
                                  setFlagNote("");
                                  setFlagStageOrder(stage.order);
                                }}
                              >
                                Request changes
                              </button>
                              <button
                                type="button"
                                className="dt-btn dt-btn-danger"
                                onClick={askReject}
                              >
                                Reject
                              </button>
                            </div>

                            {disabledReason && (
                              <p style={{ fontSize: 12, color: "var(--ink-mid)", margin: "8px 0 0" }}>
                                {disabledReason}
                              </p>
                            )}

                            <form
                              className="dt-comment-form"
                              onSubmit={(e) => {
                                e.preventDefault();
                                submitComment(selected.id, stage, i);
                              }}
                            >
                              <textarea
                                id={`dt-comment-textarea-${stage.order ?? i}`}
                                name="comment"
                                className="dt-comment-textarea"
                                placeholder="Add a comment on this step…"
                                value={draftComment}
                                onChange={(e) => setDraftComment(e.target.value)}
                              />
                              <div className="dt-action-row">
                                <button
                                  type="submit"
                                  className="dt-btn dt-btn-ghost"
                                  disabled={!draftComment.trim()}
                                >
                                  Add comment
                                </button>
                              </div>
                            </form>
                          </div>
                        )}

                        {/* Non-admin, stage has a handler, but the role doesn't cover this stage. */}
                        {isActive && !is_admin && !isUnassigned && !userHasStageAccess && (
                          <div className="dt-active-panel dt-active-panel-blocked">
                            <span className="dt-active-panel-label">
                              This step belongs to a different role — you don't have access to work on it
                            </span>
                          </div>
                        )}

                        {/* Admin: strictly view-only. */}
                        {isActive && is_admin && !isUnassigned && (
                          <div className="dt-active-panel dt-active-panel-admin">
                            <span className="dt-active-panel-label">
                              {stage.flag
                                ? `Blocked — awaiting ${handlerName} to address requested changes`
                                : `In progress — being handled by ${handlerName}`}
                            </span>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {activeIndex === -1 && !selected.rejected && !selected.archived && (
                <p className="dt-pipeline-done" style={{ marginTop: 12 }}>
                  All steps complete — this document is fully processed.
                </p>
              )}
              {selected.rejected && (
                <p className="dt-pipeline-blocked" style={{ marginTop: 12 }}>
                  This document was rejected. No further steps will run.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* "New Document" modal */}
      {newDocOpen && (
        <div
          className="dt-modal-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setNewDocOpen(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 3000,
            background: "var(--backdrop)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            className="dt-modal-card"
            style={{
              width: 360, background: "#fff", borderRadius: 8,
              boxShadow: "var(--shadow-lift)", overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 18px 4px" }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, fontFamily: "var(--font-display)" }}>New Document</h3>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-mid)" }}>
                Enter a unique tracking number for this document.
              </p>
            </div>

            <div style={{ padding: "12px 18px" }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>
                Document number
              </label>
              <input
                ref={newDocNumberRef}
                id="dt-new-doc-number"
                name="new-document-number"
                type="text"
                placeholder="e.g. DOC-2026-00001"
                value={newDocNumber}
                onChange={(e) => { setNewDocNumber(e.target.value); setNewDocError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); submitNewDocument(); }
                  if (e.key === "Escape") setNewDocOpen(false);
                }}
                style={{
                  width: "100%", boxSizing: "border-box", fontSize: 14, padding: "8px 10px",
                  border: "1px solid var(--line-strong)", borderRadius: 6, outline: "none", marginBottom: 12,
                }}
              />

              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>
                Title
              </label>
              <input
                id="dt-new-doc-title"
                name="new-document-title"
                type="text"
                placeholder="e.g. Birth Certificate — Juan Dela Cruz"
                value={newDocTitle}
                onChange={(e) => { setNewDocTitle(e.target.value); setNewDocError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); submitNewDocument(); }
                  if (e.key === "Escape") setNewDocOpen(false);
                }}
                style={{
                  width: "100%", boxSizing: "border-box", fontSize: 14, padding: "8px 10px",
                  border: "1px solid var(--line-strong)", borderRadius: 6, outline: "none", marginBottom: 12,
                }}
              />

              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>
                Document type
              </label>
              <select
                id="dt-new-doc-type"
                name="new-document-type"
                value={newDocType}
                onChange={(e) => {
                  setNewDocType(e.target.value);
                  setNewDocError(null);
                  if (e.target.value !== "Other") setNewDocTypeOther("");
                }}
                style={{
                  width: "100%", boxSizing: "border-box", fontSize: 14, padding: "8px 10px",
                  border: "1px solid var(--line-strong)", borderRadius: 6, outline: "none",
                }}
              >
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              {newDocType === "Other" && (
                <input
                  ref={newDocTypeOtherRef}
                  id="dt-new-doc-type-other"
                  name="new-document-type-other"
                  type="text"
                  placeholder="Type the document type…"
                  value={newDocTypeOther}
                  onChange={(e) => { setNewDocTypeOther(e.target.value); setNewDocError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); submitNewDocument(); }
                    if (e.key === "Escape") setNewDocOpen(false);
                  }}
                  style={{
                    width: "100%", boxSizing: "border-box", fontSize: 14, padding: "8px 10px",
                    border: "1px solid var(--line-strong)", borderRadius: 6, outline: "none", marginTop: 8,
                  }}
                />
              )}

              {newDocError && (
                <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--red)" }}>{newDocError}</p>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, padding: "4px 18px 18px" }}>
              {(() => {
                const missingCustomType = newDocType === "Other" && !newDocTypeOther.trim();
                const createDisabled =
                  !newDocNumber.trim() || !newDocTitle.trim() || missingCustomType;
                return (
                  <button
                    type="button"
                    onClick={submitNewDocument}
                    disabled={createDisabled}
                    style={{
                      flex: 1, padding: "9px 12px", fontSize: 13, fontWeight: 700,
                      borderRadius: 6, border: "none",
                      background: createDisabled ? "var(--raised)" : "var(--blue)",
                      color: createDisabled ? "var(--ink-soft)" : "#fff",
                      cursor: createDisabled ? "not-allowed" : "pointer",
                    }}
                  >
                    Create Document
                  </button>
                );
              })()}
              <button
                type="button"
                onClick={() => setNewDocOpen(false)}
                style={{
                  padding: "9px 12px", fontSize: 13, fontWeight: 700,
                  borderRadius: 6, border: "1px solid var(--line-strong)", background: "#fff",
                  color: "var(--ink)", cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "Request changes" modal */}
      {flagStageOrder != null && (
        <div
          className="dt-modal-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setFlagStageOrder(null); }}
          style={{
            position: "fixed", inset: 0, zIndex: 3000,
            background: "var(--backdrop)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            className="dt-modal-card"
            style={{
              width: 380, background: "#fff", borderRadius: 8,
              boxShadow: "var(--shadow-lift)", overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 18px 4px" }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, fontFamily: "var(--font-display)" }}>Request changes</h3>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-mid)" }}>
                Describe what needs to change on this step. The pipeline will pause until it's addressed.
              </p>
            </div>

            <div style={{ padding: "12px 18px" }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>
                What needs to change?
              </label>
              <textarea
                ref={flagNoteRef}
                id="dt-flag-note"
                name="flag-note"
                placeholder="e.g. Birth certificate copy is missing a signature"
                value={flagNote}
                onChange={(e) => { setFlagNote(e.target.value); setFlagError(null); }}
                onKeyDown={(e) => { if (e.key === "Escape") setFlagStageOrder(null); }}
                rows={4}
                style={{
                  width: "100%", boxSizing: "border-box", fontSize: 14, padding: "8px 10px",
                  border: "1px solid var(--line-strong)", borderRadius: 6, outline: "none", resize: "vertical",
                  fontFamily: "inherit",
                }}
              />

              {flagError && (
                <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--red)" }}>{flagError}</p>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, padding: "4px 18px 18px" }}>
              <button
                type="button"
                onClick={submitFlagStage}
                disabled={!flagNote.trim()}
                style={{
                  flex: 1, padding: "9px 12px", fontSize: 13, fontWeight: 700,
                  borderRadius: 6, border: "none",
                  background: !flagNote.trim() ? "var(--raised)" : "var(--amber)",
                  color: !flagNote.trim() ? "var(--ink-soft)" : "#fff",
                  cursor: !flagNote.trim() ? "not-allowed" : "pointer",
                }}
              >
                Request changes
              </button>
              <button
                type="button"
                onClick={() => setFlagStageOrder(null)}
                style={{
                  padding: "9px 12px", fontSize: 13, fontWeight: 700,
                  borderRadius: 6, border: "1px solid var(--line-strong)", background: "#fff",
                  color: "var(--ink)", cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generic confirm modal (Archive / Delete permanently / Reject) */}
      {confirmModal && (
        <div
          className="dt-modal-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmModal(null); }}
          style={{
            position: "fixed", inset: 0, zIndex: 3000,
            background: "var(--backdrop)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            className="dt-modal-card"
            role="alertdialog"
            aria-modal="true"
            style={{
              width: 380, background: "#fff", borderRadius: 8,
              boxShadow: "var(--shadow-lift)", overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 18px 4px" }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, fontFamily: "var(--font-display)" }}>
                {confirmModal.title}
              </h3>
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-mid)", lineHeight: 1.5 }}>
                {confirmModal.message}
              </p>
            </div>

            <div style={{ display: "flex", gap: 8, padding: "16px 18px 18px" }}>
              <button
                ref={confirmModalConfirmRef}
                type="button"
                onClick={confirmModal.onConfirm}
                style={{
                  flex: 1, padding: "9px 12px", fontSize: 13, fontWeight: 700,
                  borderRadius: 6, border: "none",
                  background: confirmModal.danger ? "var(--red)" : "var(--blue)",
                  color: "#fff", cursor: "pointer",
                }}
              >
                {confirmModal.confirmLabel || "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                style={{
                  padding: "9px 12px", fontSize: 13, fontWeight: 700,
                  borderRadius: 6, border: "1px solid var(--line-strong)", background: "#fff",
                  color: "var(--ink)", cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}