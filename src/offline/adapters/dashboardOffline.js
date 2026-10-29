import { readSnapshot } from "../snapshotStore";
import { markOnline } from "../connectivityService";

const MONTHS = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const PATH_TO_KEY = {
  "/api/analytics/summary": "summary",
  "/api/analytics/records-by-year": "byYear",
  "/api/analytics/records-by-month": "byMonth",
  "/api/analytics/requests-by-year": "reqByYear",
  "/api/analytics/requests-by-month": "reqByMonth",
  "/api/analytics/top-municipalities": "topMunicipalities",
  "/api/analytics/growth-rate": "growthRate",
  "/api/analytics/dashboard-today": "today",
};

function recordSets(data) {
  return ["birth", "marriage", "death"].map((type) => ({
    type,
    active: Array.isArray(data[`${type}_active`]) ? data[`${type}_active`] : [],
    archived: Array.isArray(data[`${type}_archived`]) ? data[`${type}_archived`] : [],
  }));
}

function allRecords(data) {
  const seen = new Set();
  return recordSets(data).flatMap(({ type, active, archived }) =>
    [...active, ...archived].filter((row) => {
      const key = `${type}:${row.id ?? row.file_name ?? JSON.stringify(row)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((row) => ({ ...row, _recordType: type }))
  );
}

function uploadedAt(row) {
  const date = new Date(row.uploaded_at || row.created_at || "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function municipality(row) {
  return row.city_municipality || row.place_of_birth || row.place_of_marriage
    || row.marriage_city || row.place_of_death || "Unknown";
}

function groupByYear(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const date = uploadedAt(row);
    const rawYear = row.birth_year || row.marriage_year || (date && date.getFullYear());
    const year = Number(rawYear);
    if (Number.isFinite(year) && year > 0) counts.set(year, (counts.get(year) || 0) + 1);
  });
  return [...counts].sort(([a], [b]) => a - b).map(([year, count]) => ({ year, count }));
}

function groupByMonth(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const date = uploadedAt(row);
    if (date) {
      const month = date.getMonth() + 1;
      counts.set(month, (counts.get(month) || 0) + 1);
    }
  });
  return Array.from({ length: 12 }, (_, index) => {
    const month_num = index + 1;
    return { month_num, month_name: MONTHS[month_num], count: counts.get(month_num) || 0 };
  });
}

function summarize(data) {
  const sets = recordSets(data);
  const rows = allRecords(data);
  const count = (type) => rows.filter((row) => row._recordType === type).length;
  const activeByType = Object.fromEntries(sets.map(({ type, active }) => [type, active.length]));
  const archivedByType = Object.fromEntries(sets.map(({ type, archived }) => [type, archived.length]));
  const nowManila = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const uploadedToday = { birth: 0, marriage: 0, death: 0 };
  rows.forEach((row) => {
    const date = uploadedAt(row);
    if (date && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(date) === nowManila) {
      uploadedToday[row._recordType] += 1;
    }
  });
  const birth = count("birth");
  const marriage = count("marriage");
  const death = count("death");
  return {
    total_records: rows.length,
    active_records: Object.values(activeByType).reduce((sum, n) => sum + n, 0),
    archived_records: Object.values(archivedByType).reduce((sum, n) => sum + n, 0),
    total_birth_records: birth,
    total_marriage_records: marriage,
    total_death_records: death,
    active_by_type: activeByType,
    archived_by_type: archivedByType,
    uploaded_today: Object.values(uploadedToday).reduce((sum, n) => sum + n, 0),
    uploaded_today_breakdown: uploadedToday,
    record_breakdown: [
      { label: "Birth", count: birth },
      { label: "Marriage", count: marriage },
      { label: "Death", count: death },
    ],
  };
}

function aggregate(path, data) {
  const rows = allRecords(data);
  if (path === "/api/analytics/summary") return summarize(data);
  if (path === "/api/analytics/records-by-year") return groupByYear(rows);
  if (path === "/api/analytics/records-by-month") return groupByMonth(rows);
  if (path === "/api/analytics/top-municipalities") {
    const places = new Map();
    rows.forEach((row) => {
      const name = municipality(row);
      const count = places.get(name) || { name, cnt: 0, Birth: 0, Marriage: 0, Death: 0 };
      count.cnt += 1;
      count[row._recordType[0].toUpperCase() + row._recordType.slice(1)] += 1;
      places.set(name, count);
    });
    return [...places.values()].sort((a, b) => b.cnt - a.cnt).slice(0, 20);
  }
  if (path === "/api/analytics/growth-rate") {
    const buckets = new Map();
    rows.forEach((row) => {
      const date = uploadedAt(row);
      if (!date) return;
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const key = `${year}-${month}`;
      const bucket = buckets.get(key) || { year, month, count: 0, Birth: 0, Marriage: 0, Death: 0 };
      bucket.count += 1;
      bucket[row._recordType[0].toUpperCase() + row._recordType.slice(1)] += 1;
      buckets.set(key, bucket);
    });
    let previous = null;
    return [...buckets.values()].sort((a, b) => a.year - b.year || a.month - b.month).map((bucket) => {
      const result = {
        ...bucket,
        label: `${MONTHS[bucket.month].slice(0, 3)} ${bucket.year}`,
        mom_growth: previous > 0 ? Math.round(((bucket.count - previous) / previous) * 1000) / 10 : null,
      };
      previous = bucket.count;
      return result;
    });
  }
  throw new Error("This dashboard section is not included in the offline snapshot. Connect to refresh it.");
}

export async function getDashboardData(url, { signal } = {}) {
  if (signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");

  const path = new URL(url, window.location.origin).pathname;
  const key = PATH_TO_KEY[path];
  if (!key) throw new Error(`Unsupported dashboard snapshot path: ${path}`);

  let liveError;
  try {
    const response = await fetch(url, {
      signal,
      credentials: "include",
      cache: "no-store",
    });
    markOnline(true);
    if (!response.ok) {
      throw Object.assign(new Error(`Server responded with ${response.status}`), {
        http: response.status,
      });
    }
    return {
      data: await response.json(),
      fromCache: false,
      cachedAt: null,
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    if (error instanceof TypeError) markOnline(false);
    liveError = error;
    if (error.http && error.http < 500) throw error;
  }

  const snapshot = await readSnapshot();
  if (!snapshot) {
    if (liveError?.http) throw liveError;
    const error = new Error("Connect once to download offline data.");
    error.status = "no-snapshot";
    error.cause = liveError;
    throw error;
  }

  const savedDashboard = snapshot._snapshot?.dashboard?.[path];
  let data;
  if (savedDashboard !== undefined) {
    data = savedDashboard;
  } else {
    data = aggregate(path, snapshot.data);
  }

  return {
    data,
    fromCache: true,
    cachedAt: Date.parse(snapshot._snapshot?.savedAt || "") || null,
  };
}
