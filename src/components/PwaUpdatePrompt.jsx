// src/components/PwaUpdatePrompt.jsx
import { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

const UPDATE_CHECK_MS = 60 * 60 * 1000; // check for new versions every hour
const IDLE_BEFORE_UPDATE_MS = 30 * 1000; // wait 30s of inactivity before reloading

export default function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;

      // Check when the app opens
      reg.update();

      // Check again every hour while the app is open
      setInterval(() => {
        if (!document.hidden) reg.update();
      }, UPDATE_CHECK_MS);

      // Check when the user comes back to the app
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) reg.update();
      });
    },
    onRegisterError(error) {
      console.error("[PWA] Service worker registration failed:", error);
    },
  });

  const appliedRef = useRef(false);

  useEffect(() => {
    if (!needRefresh) return undefined;

    let idleTimer = null;

    const applyUpdate = () => {
      if (appliedRef.current) return;
      appliedRef.current = true;
      // Activates the new version. The page reloads once the new version takes control.
      updateServiceWorker(true);
    };

    // Do not reload while the user is typing in a form, so unsaved input is not lost.
    const isTyping = () => {
      const el = document.activeElement;
      return el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    };

    const scheduleIdleUpdate = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (isTyping()) {
          scheduleIdleUpdate();
          return;
        }
        applyUpdate();
      }, IDLE_BEFORE_UPDATE_MS);
    };

    // If the app is hidden (minimized or in another tab), update right away.
    const onVisibility = () => {
      if (document.hidden) applyUpdate();
    };

    const activityEvents = ["pointerdown", "keydown", "scroll", "touchstart"];
    activityEvents.forEach((evt) =>
      window.addEventListener(evt, scheduleIdleUpdate, { passive: true })
    );
    document.addEventListener("visibilitychange", onVisibility);

    if (document.hidden) {
      applyUpdate();
    } else {
      scheduleIdleUpdate();
    }

    return () => {
      clearTimeout(idleTimer);
      activityEvents.forEach((evt) =>
        window.removeEventListener(evt, scheduleIdleUpdate)
      );
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [needRefresh, updateServiceWorker]);

  return null;
}