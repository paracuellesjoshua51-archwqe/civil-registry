import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { cacheClear } from "../offline/cache";
import { getAllowedEntities, setSyncScope } from "../offline/syncScope";

const API = import.meta.env.VITE_API_BASE_URL || "";

// Free-tier backends can take 50-90+ seconds to wake up. 45s covers a cold start.
const FETCH_TIMEOUT_MS = 45000;

// Last known good session, kept on this device for offline use.
// Nothing secret is stored (no password, no token).
const SESSION_CACHE_KEY = "cr_session_cache_v1";

// Set in sessionStorage after a real login on this tab. Cleared when the tab closes.
const SESSION_FLAG = "crSessionActive";

// Offline access ends this long after the last successful online check.
const SESSION_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function clearSessionCache() {
  try {
    localStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

// Returns the cache only if it is well formed and not expired. Expired or
// corrupt entries are deleted so they can never grant access.
function readSessionCache() {
  try {
    const c = JSON.parse(localStorage.getItem(SESSION_CACHE_KEY) || "null");
    if (!c || typeof c !== "object" || !c.savedAt) {
      clearSessionCache();
      return null;
    }
    if (Date.now() - c.savedAt > SESSION_CACHE_MAX_AGE_MS) {
      clearSessionCache();
      return null;
    }
    return c;
  } catch {
    clearSessionCache();
    return null;
  }
}

// Single writer for the offline session cache. Login.jsx uses this too.
// eslint-disable-next-line react-refresh/only-export-components -- helper colocated with its provider
export function saveSessionCache({ username, role, permissions, isAdmin }) {
  try {
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
      username: username || null,
      role: role || (isAdmin ? "Administrator" : "User"),
      permissions: Array.isArray(permissions) ? permissions : [],
      isAdmin: Boolean(isAdmin),
      savedAt: Date.now(),
    }));
  } catch {
    /* storage full or blocked */
  }
}

// Call from Login.jsx after a successful login, before refresh().
// eslint-disable-next-line react-refresh/only-export-components -- helper colocated with its provider
export function markSessionActive() {
  try {
    sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {
    /* ignore */
  }
}

function isSessionActive() {
  try {
    return sessionStorage.getItem(SESSION_FLAG) === "1";
  } catch {
    return false;
  }
}

const PermissionContext = createContext({
  role:                 null,
  permissions:          [],
  is_admin:             false,
  can_manage_personnel: false,
  authenticated:        false,
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
    return await fetch(url, { ...options, signal: controller.signal });
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

  // Clears the in-memory session only. The saved offline cache is kept.
  const resetSessionState = useCallback(() => {
    setRole(null);
    setPermissions([]);
    setIsAdmin(false);
    setAuthenticated(false);
    setSyncScope(new Set()); // nothing may sync while logged out
    sessionStorage.removeItem("username");
    sessionStorage.removeItem("isAuthenticated");
    sessionStorage.removeItem(SESSION_FLAG);
  }, []);

  // Full logout path: clears the in-memory session AND the offline cache.
  const clearPerms = useCallback(() => {
    resetSessionState();
    clearSessionCache();
  }, [resetSessionState]);

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

  // Restores the session from the offline cache. Returns true ONLY when the
  // cache exists, is not expired, and is well formed.
  const restoreFromCache = useCallback(() => {
    const c = readSessionCache();
    if (!c) return false;

    const perms = Array.isArray(c.permissions) ? c.permissions : [];
    const admin = Boolean(c.isAdmin);

    setRole(c.role || null);
    setPermissions(perms);
    setIsAdmin(admin);
    // Scope first, so the sync engine knows this login's modules before any UI.
    setSyncScope(getAllowedEntities(perms, admin));
    setAuthenticated(true);

    if (c.username) sessionStorage.setItem("username", c.username);
    sessionStorage.setItem("isAuthenticated", "true");
    sessionStorage.setItem(SESSION_FLAG, "1");
    return true;
  }, []);

  // Confirms the session. Resolves to true only when the user may enter the app.
  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;

    const run = async () => {
      const firstLoad = !hasLoadedOnce.current;
      if (firstLoad) setLoading(true);
      setError(null);

      let wakingTimer = null;
      if (firstLoad) wakingTimer = setTimeout(() => setWaking(true), 2000);

      // Network or server failure: use the cache only on first load.
      const fallBack = (networkFailure) => {
        if (firstLoad && (networkFailure || !navigator.onLine) && restoreFromCache()) return true;
        if (firstLoad) resetSessionState();
        return false;
      };

      try {
        // Browser is offline. The cache is the only proof of a session.
        if (!navigator.onLine) {
          if (restoreFromCache()) return true;
          resetSessionState(); // no valid cache means no session
          return false;
        }

        const res = await fetchWithTimeout(`${API}/api/session`, {
          credentials: "include",
          headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" },
        });

        // Real 401: the server session expired. Log out and forget the cache.
        if (res.status === 401) {
          clearPerms();
          return false;
        }

        if (!res.ok) {
          console.warn("[Permissions] /api/session returned status", res.status);
          setError(`Server returned ${res.status}`);
          return fallBack(false);
        }

        const data = await res.json();

        if (data.authenticated || data.user) {
          // Server has a session, but this tab never logged in: require login.
          if (!isSessionActive()) {
            resetSessionState();
            return false;
          }

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
          const uname = userObj.username || data.username || sessionStorage.getItem("username") || null;

          setSyncScope(getAllowedEntities(perms, userAdmin));
          setRole(resolvedRole);
          setPermissions(perms);
          setIsAdmin(userAdmin);
          setAuthenticated(true);

          saveSessionCache({
            username: uname,
            role: resolvedRole,
            permissions: perms,
            isAdmin: userAdmin,
          });

          if (uname) sessionStorage.setItem("username", uname);
          sessionStorage.setItem("isAuthenticated", "true");
          return true;
        }

        resetSessionState();
        return false;
      } catch (e) {
        if (e.name === "AbortError") {
          console.error("[Permissions] /api/session timed out after", FETCH_TIMEOUT_MS, "ms");
          setError("Request timed out.");
        } else {
          console.error("[Permissions] /api/session failed:", e);
          setError("Could not reach the server.");
        }
        return fallBack(true);
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
  }, [clearPerms, resetSessionState, restoreFromCache]);

  // Initial session check on mount.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Back/forward from bfcache: re-verify, online or offline. refresh() decides
  // from the server when online and from the valid cache when offline.
  useEffect(() => {
    const onPageShow = (e) => {
      if (!e.persisted) return;
      hasLoadedOnce.current = false; // treat as first load
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

  // Nothing is accessible without an authenticated session, including admins.
  const hasAccess = useCallback(
    (mod) => {
      if (!authenticated) return false;
      if (mod === "dashboard") return true;
      if (isAdmin) return true;
      if (Array.isArray(permissions) && permissions.includes("*")) return true;
      return Array.isArray(permissions) && permissions.includes(mod);
    },
    [authenticated, permissions, isAdmin]
  );

  const value = useMemo(() => ({
    role,
    permissions,
    is_admin: isAdmin,
    can_manage_personnel: isAdmin,
    authenticated,
    loading,
    waking,
    error,
    hasAccess,
    refresh,
    restoreFromCache,
    clearPerms,
    logout,
  }), [role, permissions, isAdmin, authenticated, loading, waking, error, hasAccess, refresh, restoreFromCache, clearPerms, logout]);

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