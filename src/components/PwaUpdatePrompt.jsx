// src/components/PwaUpdatePrompt.jsx
import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

const UPDATE_CHECK_MS = 60 * 60 * 1000; // check every hour while open

export default function PwaUpdatePrompt() {
  const regRef = useRef(null);
  const [dismissed, setDismissed] = useState(false);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      regRef.current = reg ?? null;
      reg?.update(); // check right away when the app opens
    },
    onRegisterError(error) {
      console.error("[PWA] Service worker registration failed:", error);
    },
  });

  // Check for updates periodically and when the user returns to the app
  useEffect(() => {
    const check = () => {
      if (!document.hidden) regRef.current?.update();
    };
    const interval = setInterval(check, UPDATE_CHECK_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (!needRefresh || dismissed) return null;

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 12,
        background: "#222",
        color: "#fff",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      }}
    >
      <span>May bag-ong update. I-update na?</span>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setDismissed(true)}>Later</button>
        <button
          onClick={() => updateServiceWorker(true)}
          style={{ fontWeight: "bold" }}
        >
          Update Now
        </button>
      </div>
    </div>
  );
}