// src/components/PwaUpdatePrompt.jsx
import { useRegisterSW } from "virtual:pwa-register/react";
import "./PwaUpdatePrompt.css";

const UPDATE_CHECK_MS = 60 * 60 * 1000; // susiha kada oras

export default function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) {
        setInterval(() => {
          if (!document.hidden) reg.update();
        }, UPDATE_CHECK_MS);
      }
    },
    onRegisterError(error) {
      console.error("[PWA] Service worker registration failed:", error);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="pwa-update" role="alert" aria-live="polite">
      <div className="pwa-update__icon" aria-hidden="true">
        ↻
      </div>

      <div className="pwa-update__text">
        <strong>May bag-ong version na</strong>
        <span>I-refresh aron magamit ang pinakabag-o nga features.</span>
      </div>

      <div className="pwa-update__actions">
        <button
          type="button"
          className="pwa-update__btn pwa-update__btn--ghost"
          onClick={() => setNeedRefresh(false)}
        >
          Later
        </button>
        <button
          type="button"
          className="pwa-update__btn pwa-update__btn--primary"
          onClick={() => updateServiceWorker(true)}
        >
          Update
        </button>
      </div>
    </div>
  );
}