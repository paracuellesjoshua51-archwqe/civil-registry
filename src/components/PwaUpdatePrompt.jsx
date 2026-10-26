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
      reg?.update(); // check when the app opens
    },
    onRegisterError(error) {
      console.error("[PWA] Service worker registration failed:", error);
    },
  });

  // Only CHECKS for updates. It never applies one.
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
    className="fixed bottom-4 right-4 z-9999 flex w-85 max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border-l-4 border-blue-600 bg-white p-3.5 text-slate-800 shadow-xl max-sm:bottom-3 max-sm:left-3 max-sm:right-3 max-sm:w-auto max-sm:max-w-none"
  >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </div>

      <div className="min-w-0 flex-1">
        <p className="m-0 text-[15px] font-semibold text-blue-900">
          New version available
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-slate-500">
          Refresh to get the latest features.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          Later
        </button>
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          Update
        </button>
      </div>
    </div>
  );
}