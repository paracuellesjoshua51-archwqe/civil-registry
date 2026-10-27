import { useEffect, useRef, useState } from "react";
import "./FaceCaptureModal.css";

// Opens the camera and returns one JPEG frame as base64 (no data: prefix).
// Used by the Login page (face unlock) and Settings (enrollment).
export default function FaceCaptureModal({ title, actionLabel, busy = false, onCapture, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream = null;
    let cancelled = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This device has no camera access.");
      return undefined;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError("Camera not available. Allow camera access and try again.");
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
  };

  return (
    <div className="fc-overlay">
      <div className="fc-box" role="dialog" aria-modal="true" aria-label={title}>
        <div className="fc-head">
          <h3>{title}</h3>
          <button type="button" className="fc-close" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <div className="fc-stage">
          {error ? (
            <p className="fc-error">{error}</p>
          ) : (
            <video ref={videoRef} className="fc-video" playsInline muted />
          )}
        </div>

        <p className="fc-hint">
          Look straight at the camera in good light. Only one face should be visible.
        </p>

        <div className="fc-actions">
          <button type="button" className="fc-btn fc-btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="fc-btn fc-btn--primary"
            onClick={capture}
            disabled={!ready || busy || !!error}
          >
            {busy ? "Checking…" : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}