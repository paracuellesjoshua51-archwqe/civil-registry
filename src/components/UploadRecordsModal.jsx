import React, { useEffect, useRef, useState } from "react";
import { isOnline } from "../offline/connectivityService";

const MAX_UPLOAD = 1000;
const QUEUE_RENDER_LIMIT = 200;
const MAX_CLIENT_ATTEMPTS = 3;
const RETRYABLE_STATUS = [502, 503, 504];

const SECTION_LABEL = { birth: "Birth", marriage: "Marriage", death: "Death" };

const LIMIT_CLASS = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-300",
  warn: "bg-amber-50 text-amber-700 border-amber-300",
  reached: "bg-red-50 text-red-600 border-red-300",
};

// Full class strings so Tailwind can detect them at build time.
const STATUS_CLASS = {
  pending: "bg-amber-50 text-amber-700 border-amber-300",
  uploading: "bg-blue-50 text-blue-700 border-blue-300",
  done: "bg-emerald-50 text-emerald-700 border-emerald-300",
  queued: "bg-sky-50 text-sky-700 border-sky-300",
  error: "bg-red-50 text-red-600 border-red-300",
};

const BTN_BASE =
  "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY = `${BTN_BASE} bg-blue-600 text-white shadow-md shadow-blue-600/25 hover:-translate-y-px hover:bg-blue-700`;
const BTN_SECONDARY = `${BTN_BASE} border-2 border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

// Formats seconds as m:ss, or h:mm:ss for long uploads.
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function normalizeFileKey(name) {
  return (name || "").toString().trim().replace(/\.pdf$/i, "")
    .replace(/[_]+/g, " ").replace(/-+/g, " ").replace(/\s+/g, " ").toLowerCase();
}

function ensurePdfName(name) {
  if (!name) return "";
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

function formatDate(d) {
  if (!d) return "—";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return String(d);
  return parsed.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/* ── Icons ─────────────────────────────────────────────────────────────── */

const IconUpload = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const IconDocumentLg = () => (
  <svg className="h-7 w-7 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const FileIconSm = ({ className = "h-3.5 w-3.5 text-slate-400" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const IconCheck = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/* ── Progress bar ──────────────────────────────────────────────────────── */

function UploadProgressBar({ value = 0, className = "", height = "h-2.5", showLabel = true }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className={`flex-1 overflow-hidden rounded-full bg-slate-200 ${height}`}
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="min-w-8.5 text-right text-xs font-bold tabular-nums text-emerald-600">
          {pct}%
        </span>
      )}
    </div>
  );
}

/* ── Upload helpers ────────────────────────────────────────────────────── */

// XHR, because fetch cannot report upload progress.
function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, (e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch { /* non-JSON body */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve(data);
      } else {
        const err = new Error(data.error || "Upload failed");
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error("Cannot reach server."));
    xhr.send(formData);
  });
}

// Retries only when the request never reached the server or the gateway was
// briefly unavailable. Validation and duplicate errors are not retried.
async function uploadWithRetry(url, file, onProgress) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_CLIENT_ATTEMPTS; attempt++) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      return await uploadWithProgress(url, fd, onProgress);
    } catch (err) {
      lastErr = err;
      const retryable = err.message === "Cannot reach server." || RETRYABLE_STATUS.includes(err.status);
      if (!retryable || attempt === MAX_CLIENT_ATTEMPTS) throw err;
      onProgress(0);
      await sleep(800 * attempt);
    }
  }
  throw lastErr;
}

/* ── Main component ────────────────────────────────────────────────────── */

export default function UploadRecordsModal({
  section,
  api,
  getRecordDisplayName,
  queueOffline,
  allRecords,
  showNotif,
  onUploadSuccess,
  onClose,
}) {
  const label = SECTION_LABEL[section] || "Record";

  const [stage, setStage] = useState("upload"); // "upload" | "results"
  const [queue, setQueue] = useState([]);
  const [results, setResults] = useState([]);
  const [failures, setFailures] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const fileRef = useRef(null);
  const startedAtRef = useRef(0);

  // Elapsed-time ticker. Runs only while uploading and is cleared automatically.
  useEffect(() => {
    if (!isUploading) return undefined;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isUploading]);

  const limitReached = queue.length >= MAX_UPLOAD;
  const slotsLeft = Math.max(0, MAX_UPLOAD - queue.length);
  const toSend = queue.filter((q) => q.status !== "done" && q.status !== "queued");

  // Records the server moved to another section are saved there but not listed here.
  const visibleResults = results.filter((r) => !r.routed);

  const overallProgress = queue.length
    ? queue.reduce((sum, q) => {
        if (q.status === "done" || q.status === "queued") return sum + 100;
        if (q.status === "uploading") return sum + (q.progress || 0);
        return sum;
      }, 0) / queue.length
    : 0;

  const limitKey = limitReached
    ? "reached"
    : queue.length >= MAX_UPLOAD - 1 ? "warn" : "ok";

  const rowName = (r) => r.display_name || getRecordDisplayName(r) || r.file_name || "";

  const close = () => { if (!isUploading) onClose(); };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";

    const existingKeys = new Set(
      (allRecords || []).map((r) => normalizeFileKey(r.file_name || getRecordDisplayName(r))),
    );
    const seen = new Set(queue.map((q) => normalizeFileKey(q.file.name)));
    const added = [];
    const skipped = { notPdf: 0, duplicate: 0, limit: 0 };
    let count = queue.length;

    for (const file of files) {
      if (count >= MAX_UPLOAD) { skipped.limit++; continue; }
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (!isPdf) { skipped.notPdf++; continue; }
      const key = normalizeFileKey(file.name);
      if (existingKeys.has(key) || seen.has(key)) { skipped.duplicate++; continue; }
      seen.add(key);
      added.push({
        id: `${Date.now()}-${Math.random()}`,
        file,
        status: "pending",
        progress: 0,
        error: null,
      });
      count++;
    }

    if (added.length) setQueue((q) => [...q, ...added]);

    const parts = [];
    if (skipped.notPdf) parts.push(`${skipped.notPdf} not a PDF`);
    if (skipped.duplicate) parts.push(`${skipped.duplicate} already exist or are queued`);
    if (skipped.limit) parts.push(`${skipped.limit} over the ${MAX_UPLOAD.toLocaleString()}-file limit`);
    if (parts.length) showNotif(`Skipped: ${parts.join(", ")}.`, "error");
  };

  const removeFromQueue = (id) => setQueue((q) => q.filter((item) => item.id !== id));

  const handleUploadAll = async () => {
    const todo = queue.filter((q) => q.status !== "done" && q.status !== "queued");
    if (todo.length === 0) { showNotif("Please add at least one file.", "error"); return; }

    startedAtRef.current = Date.now();
    setElapsed(0);
    setDoneCount(0);
    setUploadTotal(todo.length);
    setIsUploading(true);

    const saved = [];
    const failed = [];

    for (const item of todo) {
      const patch = (fields) =>
        setQueue((q) => q.map((qi) => (qi.id === item.id ? { ...qi, ...fields } : qi)));
      patch({ status: "uploading", progress: 0, error: null });

      const saveOffline = async () => {
        const op = await queueOffline(item.file);
        saved.push({
          id: `offline-${op.opId}`,
          file_name: item.file.name,
          uploaded_at: new Date(op.createdAt).toISOString(),
          _pending: true,
        });
        patch({ status: "queued", progress: 100 });
      };

      try {
        if (!isOnline()) { await saveOffline(); continue; }
        const data = await uploadWithRetry(`${api}/records`, item.file, (pct) => patch({ progress: pct }));
        saved.push(data);
        patch({ status: "done", progress: 100 });
      } catch (err) {
        let message = err.message || "Upload failed";
        if (err.message === "Cannot reach server.") {
          try { await saveOffline(); continue; } catch (e2) { message = e2.message || message; }
        }
        failed.push({ name: item.file.name, error: message });
        patch({ status: "error", error: message });
      } finally {
        setDoneCount((n) => n + 1);
      }
    }

    setIsUploading(false);
    setFailures(failed);

    if (saved.length > 0) {
      setResults((prev) => [...prev, ...saved]);
      setTimeout(() => onUploadSuccess(), 400);
      setStage("results");
    }

    const offlineCount = saved.filter((r) => r._pending).length;

    if (saved.length > 0) {
      showNotif(
        offlineCount
          ? `${plural(saved.length, "file")} processed. ${plural(offlineCount, "file")} saved on this device and will upload when you're back online.`
          : `${plural(saved.length, "file")} uploaded.`,
        "success",
      );
    }
    if (failed.length > 0) {
      showNotif(`${plural(failed.length, "file")} could not be saved. Review the list before closing.`, "error");
    }
  };

  const retryFailed = () => {
    setQueue((q) =>
      q.filter((i) => i.status === "error")
        .map((i) => ({ ...i, status: "pending", progress: 0, error: null })),
    );
    setFailures([]);
    setStage("upload");
  };

  const renderStatus = (item) => {
    switch (item.status) {
      case "pending":
        return "Pending";
      case "uploading":
        return <UploadProgressBar value={item.progress || 0} height="h-2" className="w-36" />;
      case "done":
        return "Done";
      case "queued":
        return "Saved offline";
      case "error":
        return <span title={item.error || ""}>{`Error: ${item.error || "Unknown"}`}</span>;
      default:
        return "";
    }
  };

  const uploadedNow = Math.min(doneCount, uploadTotal);
  const remainingNow = Math.max(0, uploadTotal - uploadedNow);

  return (
    <div
      className="fixed inset-0 z-9999 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm animate-[fadeIn_0.15s_ease]"
      onClick={close}
    >
      <div
        className="flex max-h-[calc(100vh-32px)] w-full max-w-125 flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-600">
            <IconUpload />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold text-slate-800">Upload {label} Record PDFs</div>
            <div className="mt-px text-[11px] text-slate-500">
              {stage === "upload"
                ? `Select up to ${MAX_UPLOAD.toLocaleString()} PDF files to upload`
                : `${plural(results.length, "file")} saved`}
            </div>
          </div>
          <button
            onClick={close}
            disabled={isUploading}
            aria-label="Close upload dialog"
            className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-xs text-slate-600 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Upload stage */}
        {stage === "upload" && (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-white p-4">
              {/* Limit badge */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${LIMIT_CLASS[limitKey]}`}>
                  {queue.length.toLocaleString()} / {MAX_UPLOAD.toLocaleString()} files
                </span>
                {limitReached && (
                  <span className="text-[11px] font-semibold text-red-600">Maximum limit reached</span>
                )}
              </div>

              {/* Dropzone / progress */}
              <div
                className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/60 p-5 text-center transition-all duration-150 ${
                  limitReached
                    ? "pointer-events-none cursor-not-allowed opacity-50"
                    : isUploading
                      ? ""
                      : "cursor-pointer hover:border-blue-500 hover:bg-blue-50"
                }`}
                onClick={() => !isUploading && !limitReached && fileRef.current?.click()}
              >
                <input
                  id={`${section}-upload-file-input`}
                  name={`${section}UploadFile`}
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />

                {isUploading ? (
                  <div className="flex w-4/5 flex-col items-center gap-2">
                    <span className="text-[13px] font-semibold tabular-nums text-blue-900">
                      Uploaded {uploadedNow.toLocaleString()} of {uploadTotal.toLocaleString()} records
                    </span>
                    <UploadProgressBar value={overallProgress} height="h-3" className="w-full" />
                    <span className="text-xs tabular-nums text-slate-600">
                      {remainingNow.toLocaleString()} remaining · Elapsed {formatDuration(elapsed)}
                    </span>
                  </div>
                ) : limitReached ? (
                  <>
                    <div className="text-[13px] font-bold text-slate-800">Upload limit reached</div>
                    <div className="text-xs text-slate-500">Remove a file to add another</div>
                  </>
                ) : (
                  <>
                    <div className="opacity-40"><IconDocumentLg /></div>
                    <div className="text-[13px] font-bold text-slate-800">Click to select PDF files</div>
                    <div className="text-xs leading-relaxed text-slate-500">
                      PDF only · Max {MAX_UPLOAD.toLocaleString()} files · Max 20 MB each
                      {queue.length > 0 ? ` · ${slotsLeft.toLocaleString()} slots remaining` : ""}
                    </div>
                  </>
                )}
              </div>

              {/* Queue */}
              {queue.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-slate-300">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                    <span className="text-[11px] font-bold text-blue-700">
                      Upload Queue ({queue.length.toLocaleString()})
                    </span>
                    {!isUploading && (
                      <button
                        onClick={() => setQueue([])}
                        className="text-[11px] font-bold text-red-600 hover:text-red-700"
                      >
                        Clear All
                      </button>
                    )}
                  </div>

                  {queue.slice(0, QUEUE_RENDER_LIMIT).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 border-b border-slate-100 bg-white px-3 py-2 last:border-b-0"
                    >
                      <FileIconSm className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800" title={item.file.name}>
                        {ensurePdfName(item.file.name)}
                      </span>
                      <span className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${STATUS_CLASS[item.status] || ""}`}>
                        {renderStatus(item)}
                      </span>
                      {!isUploading && item.status !== "done" && item.status !== "queued" && (
                        <button
                          onClick={() => removeFromQueue(item.id)}
                          title="Remove"
                          aria-label={`Remove ${ensurePdfName(item.file.name)} from queue`}
                          className="shrink-0 rounded px-1 py-0.5 text-xs text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}

                  {queue.length > QUEUE_RENDER_LIMIT && (
                    <div className="border-t border-slate-100 bg-white p-3 text-center text-xs text-slate-400">
                      Showing the first {QUEUE_RENDER_LIMIT} of {queue.length.toLocaleString()} files.
                      All of them will be processed.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
              <button className={BTN_SECONDARY} onClick={close} disabled={isUploading}>
                Cancel
              </button>
              <button
                className={BTN_PRIMARY}
                onClick={handleUploadAll}
                disabled={isUploading || toSend.length === 0}
              >
                {isUploading
                  ? `Uploading… ${Math.round(overallProgress)}%`
                  : `Upload ${toSend.length.toLocaleString()} File${toSend.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}

        {/* Results stage */}
        {stage === "results" && (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-white p-4">
              {/* Success summary */}
              <div className="flex flex-col gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                    <IconCheck />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-emerald-900">Upload complete</div>
                    <div className="text-xs text-emerald-700">
                      {results.length.toLocaleString()} of {(results.length + failures.length).toLocaleString()} files saved
                      {failures.length > 0 ? `, ${failures.length.toLocaleString()} failed` : ""}
                      {elapsed > 0 ? ` · Took ${formatDuration(elapsed)}` : ""}
                    </div>
                  </div>
                </div>
                <UploadProgressBar value={100} height="h-1.5" showLabel={false} />
              </div>

              {/* Failures */}
              {failures.length > 0 && (
                <div role="alert" className="flex flex-col gap-1.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-red-900">
                  <div className="text-sm font-bold">
                    {plural(failures.length, "file")} could not be saved
                  </div>
                  <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
                    {failures.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="text-xs">
                        <strong>{ensurePdfName(f.name)}</strong>: {f.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Saved records */}
              <div className="overflow-hidden rounded-lg border border-slate-300">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="text-[11px] font-bold text-blue-700">
                    Saved records: {results.length.toLocaleString()}
                  </span>
                </div>

                {visibleResults.length === 0 ? (
                  <div className="p-3 text-center text-xs text-slate-400">No records were saved.</div>
                ) : (
                  <div className="max-h-65 overflow-y-auto">
                    {visibleResults.map((r, i) => (
                      <div
                        key={r.id || i}
                        className="flex items-center justify-between gap-3 border-b border-l-[3px] border-slate-100 border-l-amber-500 bg-amber-50/40 px-3 py-2 last:border-b-0"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <FileIconSm className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="min-w-0 truncate text-xs font-semibold text-slate-800" title={rowName(r)}>
                            {rowName(r)}
                          </span>
                          <span className="shrink-0 whitespace-nowrap rounded-full border border-amber-300 bg-amber-100 px-1.5 py-px text-[9.5px] font-bold text-amber-700">
                            {r._pending ? "Saved offline" : "Just Uploaded"}
                          </span>
                        </div>
                        <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-500">
                          {formatDate(r.uploaded_at || new Date())}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
              {failures.length > 0 && (
                <button className={BTN_SECONDARY} onClick={retryFailed}>
                  Retry {failures.length.toLocaleString()} Failed
                </button>
              )}
              <button className={BTN_PRIMARY} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}