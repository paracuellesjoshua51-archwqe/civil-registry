import { useEffect } from "react";

const API = import.meta.env.VITE_API_BASE_URL || "";
const HEARTBEAT_MS = 30000;

// Tells the server this session is still in use. Paused while the window is
// hidden or minimized, so the account turns Not Active when the user stops.
export default function useHeartbeat(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;

    let timer = null;
    const beat = () => {
      fetch(`${API}/api/heartbeat`, { method: "POST", credentials: "include" })
        .catch((error) => {
          if (import.meta.env.DEV) console.debug("[heartbeat] request failed:", error);
        });
    };

    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };

    const start = () => {
      if (document.hidden || timer !== null) return;
      beat();
      timer = setInterval(beat, HEARTBEAT_MS);
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}