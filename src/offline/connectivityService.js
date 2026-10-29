const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const HEARTBEAT_URL = `${API_BASE}/api/health`;
const HEARTBEAT_ONLINE_MS = 15000;
const HEARTBEAT_OFFLINE_MS = 3000;
const TIMEOUT_MS = 20000;
const PROBE_THROTTLE_MS = 5000;

// Server reachable (login, general UI).
let online = typeof navigator !== 'undefined' ? navigator.onLine : true;
// Database reachable from the server (data calls, prefetch, sync).
// Starts true so first-load behaviour is unchanged until the first check.
let dbOk = true;

let timer = null;
let running = false;
let lastProbeAt = null;
let lastProbeResult = online;
let probeInFlight = null;
const listeners = new Set();
const dbListeners = new Set();

function setOnline(next) {
  if (next === online) return;
  online = next;
  listeners.forEach((fn) => fn(online));
}

function setDb(next) {
  if (next === dbOk) return;
  dbOk = next;
  dbListeners.forEach((fn) => fn(dbOk));
}

export function markOnline(next = true) {
  setOnline(!!next);
}

export async function checkNow() {
  if (probeInFlight) return probeInFlight;
  if (lastProbeAt !== null && Date.now() - lastProbeAt < PROBE_THROTTLE_MS) {
    return lastProbeResult;
  }

  probeInFlight = (async () => {
    if (!navigator.onLine) {
      setOnline(false);
      setDb(false);
      return false;
    }

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(HEARTBEAT_URL, { cache: 'no-store', signal: ctrl.signal });
      setOnline(true);
      let db = res.ok;
      try {
        const body = await res.json();
        db = body?.db !== false && res.ok;
      } catch {
        /* non-JSON body: keep the status-based value */
      }
      setDb(db);
    } catch (error) {
      setOnline(false);
      setDb(false);
      if (import.meta.env.DEV) {
        console.debug('[connectivityService] probe failed:', HEARTBEAT_URL, error);
      }
    } finally {
      clearTimeout(timeout);
    }
    return online;
  })();

  try {
    lastProbeResult = await probeInFlight;
    return lastProbeResult;
  } finally {
    lastProbeAt = Date.now();
    probeInFlight = null;
  }
}

function schedule() {
  if (!running) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await checkNow();
    schedule();
  }, online ? HEARTBEAT_ONLINE_MS : HEARTBEAT_OFFLINE_MS);
}

const onBrowserOnline = () => { checkNow(); };
const onBrowserOffline = () => {
  setOnline(false);
  setDb(false);
  lastProbeResult = false;
  lastProbeAt = Date.now();
};

export function startConnectivityMonitor() {
  if (running) return;
  running = true;
  window.addEventListener('online', onBrowserOnline);
  window.addEventListener('offline', onBrowserOffline);
  checkNow().finally(schedule);
}

export function stopConnectivityMonitor() {
  running = false;
  clearTimeout(timer);
  timer = null;
  window.removeEventListener('online', onBrowserOnline);
  window.removeEventListener('offline', onBrowserOffline);
}

// Server reachable: use for login and general UI.
export const isOnline = () => online;

// Server reachable AND database reachable: use for every data call, prefetch and sync.
export const isDbAvailable = () => online && dbOk;

export function subscribeConnectivity(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function subscribeDb(fn) {
  dbListeners.add(fn);
  return () => dbListeners.delete(fn);
}