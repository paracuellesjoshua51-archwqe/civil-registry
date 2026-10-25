// src/components/PwaUpdatePrompt.jsx
import { useRegisterSW } from "virtual:pwa-register/react";

const UPDATE_CHECK_MS = 60 * 60 * 1000; // hourly check while the app stays open

const styles = {
  wrap: {
    position: "fixed",
    bottom: 20,
    right: 20,
    zIndex: 9999,
    width: 320,
    maxWidth: "calc(100vw - 40px)",
    background: "#ffffff",
    color: "#1f2937",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
    padding: 16,
    fontFamily: "inherit",
  },
  title: { margin: 0, fontSize: 15, fontWeight: 600 },
  text: { margin: "4px 0 14px", fontSize: 13, color: "#6b7280", lineHeight: 1.4 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  later: {
    padding: "7px 14px",
    borderRadius: 6,
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#374151",
    fontSize: 13,
    cursor: "pointer",
  },
  update: {
    padding: "7px 14px",
    borderRadius: 6,
    border: "1px solid #1d4ed8",
    background: "#1d4ed8",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
};

export default function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;

      // Check right away when the app opens
      reg.update();

      // Check again every hour while the app stays open
      setInterval(() => {
        if (!document.hidden) reg.update();
      }, UPDATE_CHECK_MS);

      // Check again when the user comes back to the app window
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) reg.update();
      });
    },
    onRegisterError(error) {
      console.error("[PWA] Service worker registration failed:", error);
    },
  });

  if (!needRefresh) return null;

  return (
    <div role="alert" aria-live="polite" style={styles.wrap}>
      <p style={styles.title}>Update available</p>
      <p style={styles.text}>
        A new version of the app is ready. Refresh to get the latest changes.
      </p>
      <div style={styles.actions}>
        <button type="button" style={styles.later} onClick={() => setNeedRefresh(false)}>
          Later
        </button>
        <button type="button" style={styles.update} onClick={() => updateServiceWorker(true)}>
          Update
        </button>
      </div>
    </div>
  );
}