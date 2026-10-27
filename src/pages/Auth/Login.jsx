// src/pages/Auth/Login.jsx
import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./Login.css";
import FaceCaptureModal from "../../components/FaceCaptureModal";
import {
  saveOfflineCredential,
  verifyOfflineLogin,
  removeOfflineCredentialsFor,
} from "../../offline/adapters/offlineLogin";
import { pushToast } from "../../services/toastService";
import { usePermissions, markSessionActive, saveSessionCache } from "../../context/PermissionContext";
import bgImage from "../../assets/images/home.jpg";
import loginLogo from "../../assets/images/scc.png";

const API = import.meta.env.VITE_API_BASE_URL || "";

// Same key as ProtectedRoute. Set only after a successful login in this launch.
const UNLOCK_KEY = "lcr_unlocked_this_launch";

function markUnlockedThisLaunch() {
  try {
    sessionStorage.setItem(UNLOCK_KEY, "1");
  } catch {
    /* ignore */
  }
}

function isUnlockedThisLaunch() {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

const UserIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const LockIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const EyeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const LockFilledIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const FaceIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <circle cx="9" cy="10" r="1" />
    <circle cx="15" cy="10" r="1" />
    <path d="M9 15a4 4 0 0 0 6 0" />
  </svg>
);

function formatLockCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));

  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
  }

  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const Login = () => {
  const [username, setUsername]         = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [isLocked, setIsLocked]         = useState(false);

  const [lockSecondsRemaining, setLockSecondsRemaining] = useState(0);
  const countdownRef = useRef(null);

  // Set only when the server offers face unlock for a locked administrator.
  // Kept separate from isLocked so typing in the fields doesn't hide it.
  const [faceUsername, setFaceUsername]         = useState(null);
  const [showFaceCapture, setShowFaceCapture]   = useState(false);
  const [faceBusy, setFaceBusy]                 = useState(false);

  const navigate = useNavigate();
  const { refresh, restoreFromCache, authenticated, loading: sessionLoading } = usePermissions();

  // Only go to the dashboard when the session is valid AND the user logged in
  // during this launch. A cached session alone (offline restore) is not enough,
  // so reopening the app while offline shows the login page.
  useEffect(() => {
    if (sessionLoading || !authenticated) return;
    if (isUnlockedThisLaunch()) {
      navigate("/dashboard", { replace: true });
    }
  }, [sessionLoading, authenticated, navigate]);

  // Lock countdown timer
  useEffect(() => {
    if (!isLocked || lockSecondsRemaining <= 0) {
      clearInterval(countdownRef.current);
      return;
    }

    countdownRef.current = setInterval(() => {
      setLockSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          setIsLocked(false);
          setFaceUsername(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked]);

  // Shared tail of every successful sign-in. Returns false if the session
  // could not be confirmed with the server.
  const enterDashboard = async () => {
    markSessionActive();
    markUnlockedThisLaunch();
    const signedIn = await refresh();
    if (signedIn) {
      navigate("/dashboard", { replace: true });
      return true;
    }
    return false;
  };

  // Applies a lock response from the server. For an administrator, this device's
  // offline record is removed so the locked account can't log in offline.
  const handleLockResponse = (data, locked) => {
    setIsLocked(locked);
    setLockSecondsRemaining(locked ? (data.lock_seconds_remaining || 0) : 0);
    if (locked && data.admin_lock) {
      removeOfflineCredentialsFor(username.trim());
    }
    if (locked && data.unlock_method === "face") {
      setFaceUsername(username.trim());
    }
  };

  const handleFaceUnlock = async (imageBase64) => {
    if (!faceUsername || faceBusy) return;
    setFaceBusy(true);

    let challenge;
    try {
      const ch = await axios.post(
        `${API}/api/face/challenge`,
        { username: faceUsername },
        { withCredentials: true }
      );
      challenge = ch.data.challenge;
    } catch (err) {
      // 403 means the lock ended or the account is no longer eligible.
      if (err?.response?.status === 403) setFaceUsername(null);
      setShowFaceCapture(false);
      pushToast({
        title: "Face unlock unavailable",
        message: err?.response?.data?.message || "Please try again.",
        success: false,
      });
      setFaceBusy(false);
      return;
    }

    try {
      const res = await axios.post(
        `${API}/api/face/unlock`,
        { username: faceUsername, challenge, image: imageBase64 },
        { withCredentials: true }
      );

      setShowFaceCapture(false);
      setFaceUsername(null);
      setIsLocked(false);
      setLockSecondsRemaining(0);
      pushToast({
        title: "Account unlocked",
        message: res.data?.message || "Face verified.",
        success: true,
        duration: 2000,
      });

      // The typed password is not used here, so the offline credential is
      // intentionally not re-saved. It is re-saved on the next password login.
      if (!(await enterDashboard())) {
        pushToast({
          title: "Login failed",
          message: "Could not confirm your session. Please try again.",
          success: false,
        });
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 403 || status === 503) setShowFaceCapture(false);
      pushToast({
        title: "Face unlock failed",
        message: err?.response?.data?.message || "Face verification failed. Please try again.",
        success: false,
      });
    } finally {
      setFaceBusy(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loading || isLocked) return;
    setLoading(true);

    try {
      const response = await axios.post(
        `${API}/api/login`,
        { username, password },
        { withCredentials: true }
      );

      const msg = response?.data?.message || "Login successful.";

      if (response.data.success) {
        setIsLocked(false);
        setLockSecondsRemaining(0);
        setFaceUsername(null);
        const userObj = response.data.user || {};
        const loggedUsername = userObj.username || username;

        // Save hashed credential on this device for future offline login
        await saveOfflineCredential(loggedUsername, password, userObj);

        pushToast({ title: "Login successful!", message: msg, success: true, duration: 2000 });

        if (await enterDashboard()) return;

        pushToast({
          title: "Login failed",
          message: "Could not confirm your session. Please try again.",
          success: false,
        });
        setLoading(false);
      } else {
        const locked = msg.toLowerCase().includes("locked");
        handleLockResponse(response.data, locked);
        pushToast({
          title: locked ? "Account locked" : "Login failed",
          message: msg,
          success: false,
        });
        setLoading(false);
      }
    } catch (error) {
      console.error("Login error:", error);

      const status = error?.response?.status;
      const serverDown = !error.response || status >= 500 || !navigator.onLine;

      if (serverDown) {
        const res = await verifyOfflineLogin(username, password);

        if (res.ok) {
          const u = res.user || {};
          const offlineUsername = u.username || username;
          const offlineIsAdmin =
            Boolean(u.is_admin) || String(u.role || "").toLowerCase().includes("admin");

          // Same shape PermissionContext writes, so role and admin flag survive a reload.
          saveSessionCache({
            username: offlineUsername,
            role: u.role,
            permissions: u.permissions,
            isAdmin: offlineIsAdmin,
          });

          pushToast({
            title: "Offline login",
            message: "Signed in using saved credentials.",
            success: true,
            duration: 2000,
          });

          markUnlockedThisLaunch();

          if (restoreFromCache()) {
            navigate("/dashboard", { replace: true });
            return;
          }
          setLoading(false);
          return;
        }

        const msgs = {
          no_record: "Server unavailable. Log in online at least once on this device first.",
          locked: "Too many offline attempts. Try again in a minute.",
          bad_password: "Invalid username or password.",
        };
        pushToast({
          title: "Login failed",
          message: msgs[res.reason] || "Server error. Please try again later.",
          success: false,
        });
        setLoading(false);
        return;
      }

      // 4xx from the server (wrong password, locked, etc.)
      const data = error?.response?.data || {};
      const backendMessage = data.message || "Server error. Please try again later.";
      const locked = backendMessage.toLowerCase().includes("locked");
      handleLockResponse(data, locked);
      pushToast({
        title: locked ? "Account locked" : "Login failed",
        message: backendMessage,
        success: false,
      });
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-topbar" />

      <div className="login-body">
        <div className="login-bg" style={{ backgroundImage: `url(${bgImage})` }} />
        <div className="login-bg-overlay" />

        <div className="login-card">
          <div className="shake-wrapper">
            <img src={loginLogo} alt="City of San Carlos Logo" className="login-logo" />

            <div className="login-header">
              <span className="eyebrow">City of San Carlos</span>
              <h2>Local Civil Registrar</h2>
              <hr />
            </div>

            {isLocked && (
              <div className="lock-banner">
                <LockFilledIcon />
                <span>
                  Account temporarily locked
                  {lockSecondsRemaining > 0 && (
                    <>
                      {" "}— try again in{" "}
                      {formatLockCountdown(lockSecondsRemaining)}
                    </>
                  )}
                </span>
              </div>
            )}

            <form onSubmit={handleLogin}>
              <div className={`input-group${isLocked ? " input-locked" : ""}${username ? " has-value" : ""}`}>
                <span className="icon-left"><UserIcon /></span>
                <label className="floating-label" htmlFor="login-username">Username</label>
                <input
                  id="login-username"
                  name="username"
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setIsLocked(false); }}
                  required
                  autoComplete="username"
                  disabled={loading}
                />
              </div>

              <div className={`input-group password-group${isLocked ? " input-locked" : ""}${password ? " has-value" : ""}`}>
                <span className="icon-left"><LockIcon /></span>
                <label className="floating-label" htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setIsLocked(false); }}
                  required
                  autoComplete="current-password"
                  disabled={loading}
                />
                <span
                  className="icon-right"
                  onClick={() => setShowPassword((p) => !p)}
                  role="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </span>
              </div>

              <button
                type="submit"
                className={`login-btn${loading ? " btn-loading" : ""}${isLocked ? " btn-locked" : ""}`}
                disabled={loading || isLocked}
              >
                {loading ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span className="spinner" />
                    Logging in…
                  </span>
                ) : isLocked ? (
                  lockSecondsRemaining > 0
                    ? `Account Locked (${formatLockCountdown(lockSecondsRemaining)})`
                    : "Account Locked"
                ) : (
                  "Log in"
                )}
              </button>
            </form>

            {faceUsername && (
              <button
                type="button"
                className="face-unlock-btn"
                onClick={() => setShowFaceCapture(true)}
                disabled={faceBusy || loading}
              >
                <FaceIcon />
                Unlock with Face Scan
              </button>
            )}

            <p className="login-footnote">Office of the Local Civil Registrar</p>
          </div>
        </div>

        {showFaceCapture && (
          <FaceCaptureModal
            title="Face verification"
            actionLabel="Verify face"
            busy={faceBusy}
            onCapture={handleFaceUnlock}
            onClose={() => setShowFaceCapture(false)}
          />
        )}
      </div>
    </div>
  );
};

export default Login;