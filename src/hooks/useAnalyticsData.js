import { useCallback, useEffect, useRef, useState } from "react";
import { getDashboardData } from "../offline/adapters/dashboardOffline";
import { subscribeConnectivity } from "../offline/connectivityService";

// Relative path: goes through Vite's proxy to Flask (or VITE_API_BASE_URL).
const API = `${import.meta.env.VITE_API_BASE_URL || ""}/api/analytics`;

const ENDPOINTS = {
  summary:           `${API}/summary`,
  byYear:            `${API}/records-by-year`,
  byMonth:           `${API}/records-by-month`,
  reqByYear:         `${API}/requests-by-year`,
  reqByMonth:        `${API}/requests-by-month`,
  topMunicipalities: `${API}/top-municipalities`,
  growthRate:        `${API}/growth-rate`,
  today:             `${API}/dashboard-today`,
};

const STALE_MS = 60_000;
const RECOVERY_POLL_MS = 6000; // while showing saved data, try the server this often
const memCache = new Map();
const NOT_SAVED = /not saved on this device|no snapshot is available|connect once to download offline data/i;

const getCacheKey = () => {
  try {
    return sessionStorage.getItem("username") || "anonymous";
  } catch {
    return "session-unavailable";
  }
};

/**
 * Loads every dashboard endpoint from the live API, falling back to the
 * per-user snapshot only when a live request fails.
 *
 * While saved data is shown, it keeps trying the server in the background and
 * switches back to live data by itself (no reload, no Retry click needed).
 */
export default function useAnalyticsData() {
  const [data, setData] = useState(() => memCache.get(getCacheKey())?.data || {});
  const [loading, setLoading] = useState(() => !memCache.get(getCacheKey())?.data?.summary);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(
    () => memCache.get(getCacheKey())?.stale || { fromCache: false, cachedAt: null }
  );
  const acRef = useRef(null);
  const inFlight = useRef(false);

  const fetchAll = useCallback(async ({ force = false } = {}) => {
    const key = getCacheKey();
    const mem = memCache.get(key);

    if (!force && mem?.ts && !mem.stale?.fromCache && Date.now() - mem.ts < STALE_MS) {
      setData(mem.data);
      setStale(mem.stale);
      setError(null);
      setLoading(false);
      return;
    }

    acRef.current?.abort();
    const controller = new AbortController();
    acRef.current = controller;
    inFlight.current = true;

    if (!mem?.data?.summary) setLoading(true);

    const failures = [];
    let anyCache = false;
    let oldest = null;
    let okCount = 0;
    const working = { ...(mem?.data || {}) };

    try {
      await Promise.all(
        Object.entries(ENDPOINTS).map(async ([name, url]) => {
          try {
            const r = await getDashboardData(url, {
              signal: controller.signal,
            });
            okCount += 1;
            working[name] = r.data;
            if (r.fromCache) {
              anyCache = true;
              oldest = oldest == null ? r.cachedAt : Math.min(oldest, r.cachedAt);
            }
          } catch (e) {
            if (e?.name === "AbortError") return;
            const message = e?.message || "Network error";
            failures.push({ name, message });
            console.warn(`[Dashboard] ${name} failed:`, message);
            if (!working[name] || working[name].__failed) {
              working[name] = { __failed: true, __error: message };
            }
          }

          if (controller.signal.aborted || acRef.current !== controller) return;
          setData({ ...working });
          if (name === "summary") setLoading(false);
        })
      );

      if (controller.signal.aborted || acRef.current !== controller) return;

      const nextStale = { fromCache: anyCache, cachedAt: oldest };
      setStale(nextStale);

      if (failures.length) {
        const nothingSaved =
          okCount === 0 && failures.every((f) => NOT_SAVED.test(f.message));
        setError(
          nothingSaved
            ? "Connect once to download offline data."
            : `${failures.length} dashboard section(s) could not be loaded: ${failures
                .map((f) => f.name)
                .join(", ")}.`
        );
        memCache.set(key, { data: working, ts: 0, stale: nextStale });
      } else {
        setError(null);
        memCache.set(key, { data: working, ts: Date.now(), stale: nextStale });
      }
      setLoading(false);
    } finally {
      if (acRef.current === controller) inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    fetchAll();
    return () => acRef.current?.abort();
  }, [fetchAll]);

  // Retry live requests whenever the connectivity monitor changes state.
  useEffect(
    () =>
      subscribeConnectivity(() => {
        fetchAll({ force: true });
      }),
    [fetchAll]
  );

  // Showing saved data -> keep checking the server until it answers again.
  useEffect(() => {
    if (!stale.fromCache) return undefined;
    const id = setInterval(() => {
      if (!inFlight.current) fetchAll({ force: true });
    }, RECOVERY_POLL_MS);
    return () => clearInterval(id);
  }, [stale.fromCache, fetchAll]);

  const refetch = useCallback(() => fetchAll({ force: true }), [fetchAll]);

  return { data, loading, error, refetch, stale };
}