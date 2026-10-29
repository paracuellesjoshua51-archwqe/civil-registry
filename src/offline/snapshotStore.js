import { listByStatus } from "./outboxQueue";
import { removeSnapshotsForOtherUsers } from "./cache";

const CACHE_NAME = "vr-snapshot-v1";
const refreshInFlight = new Map();
const DASHBOARD_PATHS = [
  "/api/analytics/summary",
  "/api/analytics/records-by-year",
  "/api/analytics/records-by-month",
  "/api/analytics/requests-by-year",
  "/api/analytics/requests-by-month",
  "/api/analytics/top-municipalities",
  "/api/analytics/growth-rate",
  "/api/analytics/dashboard-today",
];
const DASHBOARD_DATA_KEYS = {
  "/api/analytics/summary": "summary",
  "/api/analytics/records-by-year": "records-by-year",
  "/api/analytics/records-by-month": "records-by-month",
  "/api/analytics/requests-by-year": "requests-by-year",
  "/api/analytics/requests-by-month": "requests-by-month",
  "/api/analytics/top-municipalities": "top-municipalities",
  "/api/analytics/growth-rate": "growth-rate",
  "/api/analytics/dashboard-today": "dashboard-today",
};

function currentUsername() {
  return sessionStorage.getItem("username")?.trim().toLowerCase() || null;
}

function snapshotRequest(username = currentUsername()) {
  if (!username) return null;
  const key = `/__offline__/${encodeURIComponent(username.trim().toLowerCase())}/snapshot.json`;
  return new Request(new URL(key, window.location.origin));
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object"
    || !snapshot.data || typeof snapshot.data !== "object"
    || !snapshot.users || typeof snapshot.users !== "object") {
    throw new Error("The offline package must include data and users objects.");
  }
  const savedAt = snapshot._snapshot?.savedAt || snapshot.data.synced_at || new Date().toISOString();
  const data = { ...snapshot.data };
  const normalizeRows = (rows) => rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("The offline snapshot contains an invalid record.");
    }
    const id = row.id ?? row.file_name;
    if (id == null) throw new Error("Every offline record must have an id.");
    return {
      ...row,
      id,
      updated_at: row.updated_at || row.uploaded_at || row.created_at || savedAt,
    };
  });
  for (const key of ["birth_active", "birth_archived", "death_active", "death_archived", "marriage_active", "marriage_archived"]) {
    if (Array.isArray(data[key])) data[key] = normalizeRows(data[key]);
  }
  for (const entity of ["birth", "death", "marriage"]) {
    const [active, archived] = uniqueBucketPair(data[`${entity}_active`], data[`${entity}_archived`]);
    if (Array.isArray(data[`${entity}_active`]) || Array.isArray(data[`${entity}_archived`])) {
      data[`${entity}_active`] = active;
      data[`${entity}_archived`] = archived;
    }
  }
  if (data.documents && typeof data.documents === "object") {
    data.documents = Object.fromEntries(Object.entries(data.documents).map(([key, rows]) => [
      key,
      Array.isArray(rows) ? normalizeRows(rows) : rows,
    ]));
    const usernames = new Set(Object.keys(data.documents).map((key) => key.split(":")[0]));
    for (const username of usernames) {
      const [active, archived] = uniqueBucketPair(
        data.documents[`${username}:active`],
        data.documents[`${username}:archived`],
      );
      data.documents[`${username}:active`] = active;
      data.documents[`${username}:archived`] = archived;
    }
  }
  return { ...snapshot, data };
}

const RECORD_ENTITIES = ["birth", "death", "marriage"];

function latestById(rows, archivedFallback = false) {
  const latest = new Map();
  for (const row of rows || []) {
    if (row?.id == null) continue;
    const key = String(row.id);
    const current = latest.get(key);
    const rowTime = Date.parse(row.updated_at || "") || 0;
    const currentTime = Date.parse(current?.row.updated_at || "") || 0;
    const archived = Boolean(row.archived_at || row.archived || row.is_archived || archivedFallback);
    if (!current || rowTime > currentTime || (rowTime === currentTime && archived)) {
      latest.set(key, { row, archived });
    }
  }
  return latest;
}

function uniqueBucketPair(activeRows, archivedRows) {
  const records = latestById(activeRows, false);
  for (const [id, value] of latestById(archivedRows, true)) {
    const current = records.get(id);
    const valueTime = Date.parse(value.row.updated_at || "") || 0;
    const currentTime = Date.parse(current?.row.updated_at || "") || 0;
    if (!current || valueTime > currentTime || (valueTime === currentTime && value.archived)) {
      records.set(id, value);
    }
  }
  const active = [];
  const archived = [];
  for (const { row, archived: isArchived } of records.values()) {
    (isArchived ? archived : active).push(row);
  }
  return [active, archived];
}

function recordTarget(op) {
  if (!RECORD_ENTITIES.includes(op.entity) && op.entity !== "tracking") return null;
  const path = new URL(op.url, window.location.origin).pathname;
  const pattern = op.entity === "tracking"
    ? /^\/api\/documents\/([^/]+)(?:\/.*)?$/
    : new RegExp(`^/api/${op.entity}/records/([^/]+)(?:/.*)?$`);
  const match = path.match(pattern);
  if (match) return { entity: op.entity, id: decodeURIComponent(match[1]) };
  if (op.method === "POST") return { entity: op.entity, id: `offline-${op.opId}` };
  return null;
}

function pendingOpsForCurrentUser(ops, username) {
  return ops.filter((op) => op.status !== "synced"
      && String(op.username || "").trim().toLowerCase() === username)
    .map((op) => ({ op, target: recordTarget(op) }))
    .filter(({ target }) => target);
}

function mergeSnapshotBuckets(serverData, existingData, pendingOps) {
  const data = { ...serverData };
  const pendingFor = (entity, id) => pendingOps.filter(({ target }) =>
    target.entity === entity && target.id === String(id));

  const mergePair = (entity, activeKey, archivedKey, bucketData = data, oldBucketData = existingData) => {
    const serverActive = Array.isArray(bucketData[activeKey]) ? bucketData[activeKey] : [];
    const serverArchived = Array.isArray(bucketData[archivedKey]) ? bucketData[archivedKey] : [];
    const serverRows = new Map(uniqueBucketPair(serverActive, serverArchived)
      .flatMap((rows, index) => rows.map((row) => [String(row.id), { row, archived: index === 1 }])));
    const localRows = new Map(uniqueBucketPair(oldBucketData[activeKey], oldBucketData[archivedKey])
      .flatMap((rows, index) => rows.map((row) => [String(row.id), { row, archived: index === 1 }])));

    const merged = new Map(serverRows);
    for (const [id, local] of localRows) {
      const operations = pendingFor(entity, id);
      if (!operations.length) continue;
      if (operations.some(({ op }) => op.method === "DELETE")) {
        merged.delete(id);
        continue;
      }
      const server = serverRows.get(id);
      const localTime = Date.parse(local.row.updated_at || "") || 0;
      const serverTime = Date.parse(server?.row.updated_at || "") || 0;
      if (!server || localTime > serverTime) merged.set(id, local);
    }

    const active = [];
    const archived = [];
    for (const { row, archived: isArchived } of merged.values()) {
      (isArchived ? archived : active).push(row);
    }
    bucketData[activeKey] = active;
    bucketData[archivedKey] = archived;
  };

  for (const entity of RECORD_ENTITIES) {
    mergePair(entity, `${entity}_active`, `${entity}_archived`);
  }

  const serverDocuments = data.documents && typeof data.documents === "object" ? data.documents : {};
  const existingDocuments = existingData.documents && typeof existingData.documents === "object"
    ? existingData.documents : {};
  const currentUser = sessionStorage.getItem("username")?.trim().toLowerCase();
  const documentUsers = new Set([
    ...Object.keys(serverDocuments).map((key) => key.split(":")[0]),
    ...pendingOps.filter(({ target }) => target.entity === "tracking").map(({ op }) => op.username || currentUser),
  ]);
  const documents = { ...serverDocuments };
  for (const username of documentUsers) {
    if (!username) continue;
    const activeKey = `${username}:active`;
    const archivedKey = `${username}:archived`;
    mergePair("tracking", activeKey, archivedKey, documents, existingDocuments);
  }
  data.documents = documents;
  return data;
}

async function saveSnapshot(snapshot, username = currentUsername()) {
  const cache = await caches.open(CACHE_NAME);
  const request = snapshotRequest(username);
  if (!request) throw new Error("Sign in before saving an offline snapshot.");
  await cache.put(request, new Response(JSON.stringify(snapshot), {
    headers: { "Content-Type": "application/json" },
  }));
}

export async function updateSnapshot(updater) {
  const snapshot = await readSnapshot();
  if (!snapshot) return { status: "no-snapshot" };
  const updated = validateSnapshot(updater(snapshot));
  await saveSnapshot(updated);
  return { status: "updated", snapshot: updated };
}

async function readSnapshot(username = currentUsername()) {
  const request = snapshotRequest(username);
  if (!request) return null;
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(request);
  return response ? validateSnapshot(await response.json()) : null;
}

export function refreshSnapshot(apiBase = "") {
  const username = currentUsername();
  if (!username) return Promise.reject(new Error("Sign in before refreshing the offline snapshot."));
  if (!refreshInFlight.has(username)) {
    const request = removeSnapshotsForOtherUsers(username)
      .then(() => loadSnapshot(apiBase, username))
      .finally(() => refreshInFlight.delete(username));
    refreshInFlight.set(username, request);
  }
  return refreshInFlight.get(username);
}

async function loadSnapshot(apiBase = "", username) {
  const base = String(apiBase).replace(/\/+$/, "");
  const response = await fetch(`${base}/api/offline/snapshot`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Offline snapshot request failed (${response.status}).`);
  }

  const snapshot = validateSnapshot(await response.json());
  const previous = await readSnapshot(username);
  const dashboard = { ...(previous?._snapshot?.dashboard || {}) };
  for (const [path, name] of Object.entries(DASHBOARD_DATA_KEYS)) {
    const savedValue = snapshot.data.analytics?.[name];
    if (savedValue !== undefined) dashboard[path] = savedValue;
  }
  const dashboardErrors = [];
  const results = await Promise.allSettled(DASHBOARD_PATHS.map(async (path) => {
    const result = await fetch(`${base}${path}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!result.ok) throw new Error(`${path} returned ${result.status}.`);
    dashboard[path] = await result.json();
  }));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      dashboardErrors.push({ path: DASHBOARD_PATHS[index], message: result.reason?.message || "Request failed." });
    }
  });

  const documentDetails = { ...(previous?._snapshot?.documentDetails || {}) };
  const documentErrors = [];
  if (username) {
    try {
      const listResponse = await fetch(`${base}/api/documents`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!listResponse.ok) throw new Error(`/api/documents returned ${listResponse.status}.`);
      const documents = await listResponse.json();
      if (!Array.isArray(documents)) throw new Error("The document list response was invalid.");
      snapshot.data.documents = {
        ...(snapshot.data.documents || {}),
        [`${username}:active`]: documents,
      };

      for (let offset = 0; offset < documents.length; offset += 10) {
        const details = await Promise.allSettled(documents.slice(offset, offset + 10).map(async (document) => {
          const detailResponse = await fetch(`${base}/api/documents/${document.id}`, {
            credentials: "include",
            cache: "no-store",
          });
          if (!detailResponse.ok) throw new Error(`Document ${document.id} returned ${detailResponse.status}.`);
          documentDetails[String(document.id)] = await detailResponse.json();
        }));
        details.forEach((result) => {
          if (result.status === "rejected") {
            documentErrors.push(result.reason?.message || "A document detail could not be downloaded.");
          }
        });
      }
    } catch (error) {
      documentErrors.push(error.message || "Document Tracking could not be refreshed.");
    }

    const account = snapshot.users[username];
    if (account?.permissions?.includes("*")) {
      try {
        const archiveResponse = await fetch(`${base}/api/documents?archived=true`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!archiveResponse.ok) throw new Error(`/api/documents?archived=true returned ${archiveResponse.status}.`);
        const archived = await archiveResponse.json();
        if (!Array.isArray(archived)) throw new Error("The document archive response was invalid.");
        snapshot.data.documents = {
          ...(snapshot.data.documents || {}),
          [`${username}:archived`]: archived,
        };
      } catch (error) {
        documentErrors.push(error.message || "The document archive could not be downloaded.");
      }
    }
  }

  const saved = {
    ...snapshot,
    _snapshot: {
      etag: response.headers.get("ETag"),
      savedAt: new Date().toISOString(),
      dashboard,
      dashboardErrors,
      documentErrors,
      documentDetails,
    },
  };
  return writeSnapshot(saved, username);
}

export { readSnapshot };

export async function writeSnapshot(snapshot, username = currentUsername()) {
  username = username?.trim().toLowerCase();
  if (!username) throw new Error("Sign in before saving an offline snapshot.");
  snapshot = validateSnapshot(snapshot);
  const users = Object.fromEntries(Object.entries(snapshot.users).map(([username, user]) => {
    const hash = user?.password;
    if (typeof hash !== "string" || !/^scrypt:32768:8:1\$[^$]+\$[0-9a-f]{128}$/i.test(hash)) {
      throw new Error(`Offline package contains an invalid password hash for ${username}.`);
    }
    return [username, user];
  }));
  const existing = await readSnapshot(username);
  const pendingOps = pendingOpsForCurrentUser(await listByStatus(), username);
  const data = mergeSnapshotBuckets(snapshot.data, existing?.data || {}, pendingOps);
  const saved = {
    ...snapshot,
    data,
    users,
    _snapshot: snapshot._snapshot || { etag: null, savedAt: new Date().toISOString(), dashboard: {}, dashboardErrors: [] },
  };
  await saveSnapshot(saved, username);
  return saved;
}

export async function reconcileSyncedCreate({ entity, opId, serverRecord }) {
  if (!serverRecord || serverRecord.id == null) return { status: "unchanged" };
  const snapshot = await readSnapshot();
  if (!snapshot) return { status: "no-snapshot" };

  const temporaryId = `offline-${opId}`;
  const data = { ...snapshot.data };
  const normalizedEntity = String(entity || "").toLowerCase();
  const pairs = normalizedEntity === "tracking"
    ? Object.keys(data.documents || {}).reduce((all, key) => {
      const username = key.split(":")[0];
      if (!all.some((pair) => pair.username === username)) all.push({ username });
      return all;
    }, [])
    : RECORD_ENTITIES.includes(normalizedEntity) ? [{ entity: normalizedEntity }] : [];
  if (normalizedEntity === "tracking") {
    const username = sessionStorage.getItem("username")?.trim().toLowerCase();
    if (username && !pairs.some((pair) => pair.username === username)) pairs.push({ username });
  }
  let localRecord = null;
  let wasArchived = false;

  for (const pair of pairs) {
    const activeKey = normalizedEntity === "tracking" ? `${pair.username}:active` : `${normalizedEntity}_active`;
    const archivedKey = normalizedEntity === "tracking" ? `${pair.username}:archived` : `${normalizedEntity}_archived`;
    for (const [key, isArchived] of [[activeKey, false], [archivedKey, true]]) {
      const rows = Array.isArray(normalizedEntity === "tracking" ? data.documents[key] : data[key])
        ? (normalizedEntity === "tracking" ? data.documents[key] : data[key])
        : [];
      const temp = rows.find((row) => String(row.id) === temporaryId);
      if (temp) {
        localRecord = temp;
        wasArchived = isArchived || Boolean(temp.archived_at || temp.archived);
      }
    }
  }
  const replacement = {
    ...(localRecord || {}),
    ...serverRecord,
    id: serverRecord.id,
    updated_at: serverRecord.updated_at || localRecord?.updated_at || new Date().toISOString(),
  };
  const hasServerArchiveState = ["archived_at", "archived", "is_archived"]
    .some((key) => Object.prototype.hasOwnProperty.call(serverRecord, key));
  const archived = hasServerArchiveState
    ? Boolean(serverRecord.archived_at || serverRecord.archived || serverRecord.is_archived)
    : wasArchived;
  if (hasServerArchiveState && !archived) replacement.archived_at = null;
  else if (archived && !replacement.archived_at) replacement.archived_at = new Date().toISOString();
  const resultPairs = normalizedEntity === "tracking"
    ? pairs.map(({ username }) => ({ activeKey: `${username}:active`, archivedKey: `${username}:archived` }))
    : [{ activeKey: `${normalizedEntity}_active`, archivedKey: `${normalizedEntity}_archived` }];

  for (const { activeKey, archivedKey } of resultPairs) {
    const active = normalizedEntity === "tracking" ? data.documents[activeKey] : data[activeKey];
    const archivedRows = normalizedEntity === "tracking" ? data.documents[archivedKey] : data[archivedKey];
    const nextActive = (Array.isArray(active) ? active : [])
      .filter((row) => ![temporaryId, String(serverRecord.id)].includes(String(row.id)));
    const nextArchived = (Array.isArray(archivedRows) ? archivedRows : [])
      .filter((row) => ![temporaryId, String(serverRecord.id)].includes(String(row.id)));
    (archived ? nextArchived : nextActive).unshift(replacement);
    if (normalizedEntity === "tracking") {
      data.documents[activeKey] = nextActive;
      data.documents[archivedKey] = nextArchived;
    } else {
      data[activeKey] = nextActive;
      data[archivedKey] = nextArchived;
    }
  }

  await saveSnapshot({ ...snapshot, data });
  return { status: "reconciled", record: replacement };
}

export async function applySnapshotMutation({ entity, method, url, json, opId }) {
  const snapshot = await readSnapshot();
  if (!snapshot) return { status: "no-snapshot" };

  const now = new Date().toISOString();
  const data = { ...snapshot.data };
  const normalizedEntity = String(entity || "").toLowerCase();
  const path = new URL(url, window.location.origin).pathname;
  const idFromPath = path.match(/\/(?:records|documents)\/([^/]+)(?:\/|$)/)?.[1];
  const recordId = json?.id ?? json?.record_id ?? json?.recordId ?? idFromPath
    ?? (method === "POST" ? `offline-${opId}` : null);
  if (recordId == null) return { status: "unchanged" };

  const record = { ...(json || {}), id: recordId, updated_at: json?.updated_at || now };
  const documentBuckets = normalizedEntity === "tracking"
    ? Object.keys(data.documents || {})
    : [];
  const recordBuckets = ["birth", "death", "marriage"].includes(normalizedEntity)
    ? [`${normalizedEntity}_active`, `${normalizedEntity}_archived`]
    : [];
  const buckets = [...documentBuckets, ...recordBuckets];

  if (normalizedEntity === "tracking" && method === "POST") {
    const username = sessionStorage.getItem("username")?.trim().toLowerCase();
    if (username) {
      const activeKey = `${username}:active`;
      if (!buckets.includes(activeKey)) buckets.push(activeKey);
    }
  }
  let changed = false;

  for (const bucket of buckets) {
    if (normalizedEntity === "tracking") {
      const current = Array.isArray(data.documents[bucket]) ? data.documents[bucket] : [];
      const index = current.findIndex((row) => String(row.id) === String(recordId));
      if (method === "DELETE") {
        data.documents[bucket] = current.filter((row) => String(row.id) !== String(recordId));
        changed ||= data.documents[bucket].length !== current.length;
      } else if (index >= 0) {
        const existing = current[index];
        if (Date.parse(record.updated_at) >= Date.parse(existing.updated_at || "")) {
          data.documents[bucket] = current.map((row, i) => i === index ? { ...row, ...record } : row);
          changed = true;
        }
      } else if (method === "POST"
        && bucket === `${sessionStorage.getItem("username")?.trim().toLowerCase()}:active`) {
        data.documents[bucket] = [{ ...record, type: record.doc_type, archived: false }, ...current];
        changed = true;
      }
      continue;
    }

    const current = Array.isArray(data[bucket]) ? data[bucket] : [];
    const index = current.findIndex((row) => String(row.id) === String(recordId));
    if (method === "DELETE") {
      data[bucket] = current.filter((row) => String(row.id) !== String(recordId));
      changed ||= data[bucket].length !== current.length;
    } else if (index >= 0) {
      const existing = current[index];
      if (Date.parse(record.updated_at) >= Date.parse(existing.updated_at || "")) {
        data[bucket] = current.map((row, i) => i === index ? { ...row, ...record } : row);
        changed = true;
      }
    } else if (method === "POST" && record.file_name
      && bucket === `${normalizedEntity}_${record.archived_at ? "archived" : "active"}`) {
      data[bucket] = [{ ...record, archived_at: record.archived_at || now }, ...current];
      changed = true;
    }
  }

  if (!changed) return { status: "unchanged" };
  await saveSnapshot({ ...snapshot, data });
  return { status: "updated", record };
}
