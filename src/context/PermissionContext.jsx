import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { cacheClear } from "../offline/cache";
import { getAllowedEntities, setSyncScope } from "../offline/syncScope";

const API = import.meta.env.VITE_API_BASE_URL || "";

// Free-tier backends (e.g. Render) can take 50-90+ seconds to wake up
// after idling. 45s covers a cold start; a warm server responds quickly.
const FETCH_TIMEOUT_MS = 45000;

// ── Offline support ─────────────────────────────────────────────────────────
// Last known good session, kept on this device. The server cookie still
// decides real access; this only keeps the UI usable while the server cannot
// be reached. Nothing secret is stored (no password, no token).
const SESSION_CACHE_KEY = "cr_session_cache_v1";

function readSessionCache() {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeSessionCache(c) {
  try {
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ ...c, savedAt: Date.now() }));
  } catch {
    /* storage full or blocked */
  }
}

function clearSessionCache() {
  try {
    localStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

const PermissionContext = createContext({
  role:                 null,
  permissions:          [],
  is_admin:             false,
  can_manage_personnel: false,
  loading:              true,
  waking:               false,
  error:                null,
  hasAccess:            () => false,
  refresh:              async () => false,
  restoreFromCache:     () => false,
  clearPerms:           () => {},
  logout:               async () => {},
});

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export function PermissionProvider({ children }) {
  const [role,          setRole]          = useState(null);
  const [permissions,   setPermissions]   = useState([]);
  const [isAdmin,       setIsAdmin]       = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [waking,        setWaking]        = useState(false);

  const inFlight = useRef(null);
  const hasLoadedOnce = useRef(false);

  const clearPerms = useCallback(() => {
    setRole(null);
    setPermissions([]);
    setIsAdmin(false);
    setAuthenticated(false);
    setSyncScope(new Set()); // logged out: nothing may sync
    clearSessionCache();
    sessionStorage.removeItem("username");
    sessionStorage.removeItem("isAuthenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetchWithTimeout(`${API}/api/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (e) {
      console.warn("[Permissions] logout request failed:", e);
    } finally {
      cacheClear().catch(() => {});
      clearPerms();
      sessionStorage.clear();
    }
  }, [clearPerms]);

  // Restores the saved session. Used when the server cannot be reached and
  // by the offline login path. Returns true if a saved session was restored.
  const restoreFromCache = useCallback(() => {
    const c = readSessionCache();
    if (!c) return false;
    const cachedPerms = Array.isArray(c.permissions) ? c.permissions : [];
    const cachedAdmin = Boolean(c.isAdmin);
    setRole(c.role);
    setPermissions(cachedPerms);
    setIsAdmin(cachedAdmin);
    // Scope first, so the sync engine knows this login's modules before any UI.
    setSyncScope(getAllowedEntities(cachedPerms, cachedAdmin));
    setAuthenticated(true);
    if (c.username) sessionStorage.setItem("username", c.username);
    sessionStorage.setItem("isAuthenticated", "true");
    return true;
  }, []);

  // Confirms the session with the server. Resolves to true when the user is
  // signed in, so callers can navigate without a full page reload.
  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;

    const run = async () => {
      const firstLoad = !hasLoadedOnce.current;
      if (firstLoad) setLoading(true);
      setError(null);

      let wakingTimer = null;
      if (firstLoad) wakingTimer = setTimeout(() => setWaking(true), 2000);

      // The server could not confirm the session: on the first load, keep the
      // user in with the saved session if there is one, otherwise log out.
      const fallBackOrLogOut = () => {
        if (firstLoad && restoreFromCache()) return true;
        if (firstLoad) clearPerms();
        return false;
      };

      try {
        // Browser already knows it is offline: skip the network wait.
        if (!navigator.onLine && restoreFromCache()) return true;

        const res = await fetchWithTimeout(`${API}/api/session`, {
          credentials: "include",
          headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" },
        });

        // A real 401 means the session expired: log out and forget the cache.
        if (res.status === 401) {
          clearPerms();
          return false;
        }

        if (!res.ok) {
          console.warn("[Permissions] /api/session returned status", res.status);
          setError(`Server returned ${res.status}`);
          return fallBackOrLogOut();
        }

        const data = await res.json();

        if (data.authenticated || data.user) {
          const userObj = data.user || {};

          const userAdmin =
            Boolean(userObj.is_admin || data.is_admin) ||
            (userObj.role && userObj.role.toLowerCase().includes("admin")) ||
            (data.role && data.role.toLowerCase().includes("admin"));

          const perms = [
            ...(Array.isArray(userObj.permissions)
              ? userObj.permissions
              : Array.isArray(data.permissions)
                ? data.permissions
                : []),
          ];

          if (!perms.includes("dashboard")) perms.push("dashboard");

          const resolvedRole =
            userObj.role || data.role || (userAdmin ? "Administrator" : "User");

          // Scope the offline sync to this login's permissions BEFORE the
          // UI renders, so nothing outside the user's modules is ever sent.
          // setSyncScope ignores unchanged values, so repeated refreshes
          // (e.g. coming back online) do not restart the sync.
          setSyncScope(getAllowedEntities(perms, userAdmin));

          setRole(resolvedRole);
          setPermissions(perms);
          setIsAdmin(userAdmin);
          setAuthenticated(true);

          // Remember this session for offline reloads.
          writeSessionCache({
            role: resolvedRole,
            permissions: perms,
            isAdmin: userAdmin,
            username: userObj.username || data.username || sessionStorage.getItem("username") || null,
          });

          const uname = userObj.username || data.username;
          if (uname) sessionStorage.setItem("username", uname);
          sessionStorage.setItem("isAuthenticated", "true");
          return true;
        }

        clearPerms();
        return false;
      } catch (e) {
        if (e.name === "AbortError") {
          console.error("[Permissions] /api/session timed out after", FETCH_TIMEOUT_MS, "ms");
          setError("Request timed out.");
        } else {
          console.error("[Permissions] /api/session failed:", e);
          setError("Could not reach the server.");
        }
        return fallBackOrLogOut();
      } finally {
        hasLoadedOnce.current = true;
        if (wakingTimer) clearTimeout(wakingTimer);
        setWaking(false);
        if (firstLoad) setLoading(false);
      }
    };

    inFlight.current = run().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [clearPerms, restoreFromCache]);

  // Initial session check on mount. Without this, "Loading..." never finishes.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Back/forward from the bfcache: don't reuse the old state, verify with the server.
  // Back online: confirm with the server. A 401 here means the session
  // really expired, so the user is sent to login.
  useEffect(() => {
    const onPageShow = (e) => {
      if (!e.persisted) return;        // true only when restored from bfcache
      if (!navigator.onLine) return;   // offline mode: don't kick the user out
     hasLoadedOnce.current = false;   // treat as first load: LoadingScreen + clearPerms if expired
      refresh();
    };
    const onOnline = () => { refresh(); };

    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh]);

  const hasAccess = useCallback(
    (mod) => {
      if (isAdmin) return true;
      if (Array.isArray(permissions) && permissions.includes("*")) return true;
      if (mod === "dashboard" && authenticated) return true;
      return Array.isArray(permissions) && permissions.includes(mod);
    },
    [permissions, isAdmin, authenticated]
  );

  const value = useMemo(() => ({
    role,
    permissions,
    is_admin: isAdmin,
    can_manage_personnel: isAdmin,
    loading,
    waking,
    error,
    hasAccess,
    refresh,
    restoreFromCache,
    clearPerms,
    logout,
  }), [role, permissions, isAdmin, loading, waking, error, hasAccess, refresh, restoreFromCache, clearPerms, logout]);

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook colocated with its provider
export function usePermissions() {
  return useContext(PermissionContext);
}