// src/components/VitalRegistry/hooks.js
import { useCallback, useEffect, useState } from "react";
import { pushToast } from "../../services/toastService";
import { getPdfBlobUrl } from "../../utils/pdfUtils";

/** Adapter: showNotif("message", "success" | "error") on top of pushToast. */
export function useShowNotif() {
  return useCallback((message, type = "success") => {
    if (type === "neutral") {
      pushToast({
        title: "Offline data",
        message,
        type: "neutral",
        presentation: "status",
        duration: 5000,
      });
      return;
    }
    const ok = type === "success";
    pushToast({
      title: ok ? "Success" : "Error",
      message,
      success: ok,
      duration: 5000,
    });
  }, []);
}

export function useViewport() {
  const [width, setWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1024,
  );
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return {
    width,
    isMobile: width < 768,
    // One breakpoint for all three registries: cards below 1024px.
    useCards: width < 1024,
  };
}

/** Blob URL for a stored PDF, revoked on change. Shows an error notice when it cannot be displayed. */
export function usePdfUrl(pdfData, pdfError, showNotif) {
  const [pdfUrl, setPdfUrl] = useState("");
  useEffect(() => {
    if (pdfError) {
      setPdfUrl("");
      showNotif?.(pdfError, "error");
      return undefined;
    }
    if (!pdfData) {
      setPdfUrl("");
      return undefined;
    }
    const url = getPdfBlobUrl(pdfData);
    setPdfUrl(url);
    if (!url) showNotif?.("This PDF appears to be corrupted and can't be displayed.", "error");
    return () => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); };
  }, [pdfData, pdfError, showNotif]);
  return pdfUrl;
}