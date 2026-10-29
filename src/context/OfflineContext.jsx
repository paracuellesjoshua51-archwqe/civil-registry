import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { startConnectivityMonitor, isOnline, subscribeConnectivity } from '../offline/connectivityService';
import {
  startSyncEngine, runSync, retryAllFailed, getSyncState, subscribeSyncState, API_BASE,
} from '../offline/syncEngine';
import { subscribeOutbox, getCounts, listAll } from '../offline/outboxQueue';
import { isScopeLoaded, subscribeSyncScope } from '../offline/syncScope';
import { refreshAllOfflineCredentials } from '../offline/archivePassword';
import { warmVitalCache } from '../offline/vitalOffline';
import { refreshTrackingPersonnel } from '../offline/adapters/documentTrackingOffline';
import { usePermissions } from './PermissionContext';
import { pushToast } from '../services/toastService';
import useOnlineStatus from '../hooks/useOnlineStatus';
import { refreshSnapshot } from '../offline/snapshotStore';
import useHeartbeat from '../hooks/useHeartbeat';

const OfflineContext = createContext(null);

const MODULES = ['birth', 'marriage', 'death', 'tracking'];
const EMPTY_COUNTS = { pending: 0, syncing: 0, failed: 0, conflict: 0, synced: 0, waiting: 0, total: 0 };
const EMPTY_MODULE = { pending: 0, waiting: 0, syncing: 0, failed: 0, conflict: 0, synced: 0, total: 0 };
const WARMUP_INTERVAL_MS = 10 * 60 * 1000;
const SNAPSHOT_API_BASE = import.meta.env.VITE_API_BASE_URL || '';
let lastWarmupAt = null;
let warmupInFlight = null;

async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// Username of the current tab's login. Used only to split "mine" vs "waiting" in the outbox tally.
function currentUsername() {
  try {
    return sessionStorage.getItem('username') || '';
  } catch {
    return '';
  }
}

function tallyModule(rows, entity, user) {
  const rs = rows.filter((r) => r.entity === entity);
  const pending = rs.filter((r) => r.status === 'pending');
  return {
    pending: pending.filter((r) => !r.username || r.username === user).length,
    waiting: pending.filter((r) => r.username && r.username !== user).length,
    syncing: rs.filter((r) => r.status === 'syncing').length,
    failed: rs.filter((r) => r.status === 'failed').length,
    conflict: rs.filter((r) => r.status === 'conflict').length,
    synced: rs.filter((r) => r.status === 'synced').length,
    total: rs.filter((r) => ['pending', 'syncing', 'failed', 'conflict'].includes(r.status)).length,
  };
}

export function OfflineProvider({ children }) {
  const { authenticated } = usePermissions();
  const databaseOnline = useOnlineStatus();
  const [online, setOnline] = useState(isOnline());
  const [sync, setSync] = useState(getSyncState());
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [moduleCounts, setModuleCounts] = useState(() =>
    Object.fromEntries(MODULES.map((m) => [m, EMPTY_MODULE]))
  );
  const lastNotified = useRef(null);

  useHeartbeat(Boolean(authenticated));

  const refreshCounts = useCallback(async () => {
    try {
      const [total, rows] = await Promise.all([getCounts(), listAll()]);
      const user = currentUsername();
      setCounts(total);
      setModuleCounts(Object.fromEntries(MODULES.map((m) => [m, tallyModule(rows, m, user)])));
    } catch (err) {
      console.warn('[OfflineContext] could not read outbox counts:', err);
    }
  }, []);

  const notify = useCallback((nowOnline) => {
    if (lastNotified.current === nowOnline) return;
    const firstCheck = lastNotified.current === null;
    lastNotified.current = nowOnline;
    if (firstCheck && nowOnline) return;

    if (nowOnline) {
      pushToast({
        title: 'Back online',
        message: 'Connection restored. Saved changes will sync now.',
        type: 'success',
        presentation: 'status',
        duration: 4000,
      });
    } else {
      // Offline is a status, not an error, so it uses the neutral (gray) tone.
      pushToast({
        title: 'Offline mode',
        message: 'Changes are saved on this device and will sync when the connection returns.',
        type: 'neutral',
        presentation: 'status',
        duration: 6000,
      });
    }
  }, []);

  // PermissionContext owns the sync scope. The engine starts once a scope has
  // been loaded, and every real scope change re-runs the sync.
  useEffect(() => {
    startConnectivityMonitor();
    requestPersistence();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial outbox count load on mount
    refreshCounts();

    let started = false;
    const onScope = () => {
      if (!isScopeLoaded()) return;
      if (!started) {
        started = true;
        startSyncEngine();
      } else if (isOnline()) {
        runSync();
      }
    };
    onScope();
    const unsubScope = subscribeSyncScope(onScope);

    const unsubConnectivity = subscribeConnectivity((v) => {
      setOnline(v);
      notify(v);
    });
    const unsubSync = subscribeSyncState(setSync);
    const unsubOutbox = subscribeOutbox(refreshCounts);

    notify(isOnline());

    return () => {
      unsubScope();
      unsubConnectivity();
      unsubSync();
      unsubOutbox();
    };
  }, [refreshCounts, notify]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!navigator.onLine) return;
      refreshSnapshot(SNAPSHOT_API_BASE).catch((err) => {
        if (active) console.warn('[OfflineContext] snapshot refresh failed:', err);
      });
    };
    if (databaseOnline) refresh();
    window.addEventListener('online', refresh);
    return () => {
      active = false;
      window.removeEventListener('online', refresh);
    };
  }, [databaseOnline]);

  // Keeps the offline copies fresh while online. Runs only for a confirmed session.
  useEffect(() => {
    if (!online || !authenticated) return undefined;

    let alive = true;
    let cancels = [];

    const stopDownloads = () => {
      cancels.forEach((c) => c?.());
      cancels = [];
    };

    const run = () => {
      if (!alive) return Promise.resolve();
      if (warmupInFlight) return warmupInFlight;
      if (lastWarmupAt !== null && Date.now() - lastWarmupAt < WARMUP_INTERVAL_MS) {
        return Promise.resolve();
      }

      lastWarmupAt = Date.now();
      stopDownloads();

      const task = (async () => {
        await refreshTrackingPersonnel();
        if (!alive) return;

        await refreshAllOfflineCredentials();
        if (!alive) return;

        const birthCancel = await warmVitalCache('birth', `${API_BASE}/api/birth`);
        if (!alive) { birthCancel?.(); return; }
        if (birthCancel) cancels.push(birthCancel);

        for (const entity of ['marriage', 'death']) {
          if (!alive) return;
          const c = await warmVitalCache(entity, `${API_BASE}/api/${entity}`);
          if (c) cancels.push(c);
        }
      })();
      warmupInFlight = task;
      task.then(
        () => { if (warmupInFlight === task) warmupInFlight = null; },
        () => { if (warmupInFlight === task) warmupInFlight = null; },
      );
      return task;
    };

    const safeRun = () => {
      void run().catch((err) => console.warn('[OfflineContext] warm-up failed:', err));
    };

    safeRun();
    const timer = setInterval(safeRun, WARMUP_INTERVAL_MS);

    return () => {
      alive = false;
      clearInterval(timer);
      stopDownloads();
    };
  }, [online, authenticated]);

  return (
    <OfflineContext.Provider
      value={{
        online,
        sync,
        counts,
        moduleCounts,
        syncNow: runSync,
        retryFailed: retryAllFailed,
        refreshCounts,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook colocated with its provider
export const useOffline = () => {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used inside <OfflineProvider>');
  return ctx;
};