// src/routes/HomePreloader.jsx
import { useEffect } from "react";

// Warms up the Home chunk during idle time (on the login page) so the first
// visit to the dashboard loads faster. It renders nothing.
// The import path matches the lazy() import in main.jsx, so both share one chunk.
export default function HomePreloader() {
  useEffect(() => {
    let idleId;
    let timeoutId;

    const preload = () => {
      // If the preload fails (e.g. a network hiccup), lazy() in main.jsx retries later.
      import("../pages/Home/Home").catch(() => undefined);
    };

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(preload, { timeout: 3000 });
    } else {
      timeoutId = window.setTimeout(preload, 1500);
    }

    return () => {
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  return null;
}