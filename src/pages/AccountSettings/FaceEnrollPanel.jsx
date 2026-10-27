import { useEffect, useState } from "react";
import axios from "axios";
import { pushToast } from "../../services/toastService";
import FaceCaptureModal from "../../components/FaceCaptureModal";

const API = import.meta.env.VITE_API_BASE_URL || "";

export default function FaceEnrollPanel() {
  const [status, setStatus]         = useState(null);
  const [password, setPassword]     = useState("");
  const [showCapture, setShowCapture] = useState(false);
  const [busy, setBusy]             = useState(false);

  useEffect(() => {
    let active = true;
    axios
      .get(`${API}/api/face/status`, { withCredentials: true })
      .then((r) => { if (active) setStatus(r.data); })
      .catch(() => { if (active) setStatus({ enrolled: false, configured: false, error: true }); });
    return () => { active = false; };
  }, []);

  const enroll = async (image) => {
    setBusy(true);
    try {
      await axios.post(
        `${API}/api/face/enroll`,
        { password, image },
        { withCredentials: true }
      );
      setStatus((s) => ({ ...s, enrolled: true }));
      setPassword("");
      setShowCapture(false);
      pushToast({ title: "Face unlock enrolled", success: true, duration: 3000 });
    } catch (err) {
      pushToast({
        title: "Enrollment failed",
        message: err?.response?.data?.message || "Please try again.",
        success: false,
      });
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <p className="st-note">Checking face unlock…</p>;

  if (status.error) {
    return <p className="st-note">Could not check face unlock status. Try again later.</p>;
  }

  if (!status.configured) {
    return (
      <p className="st-note">
        Face unlock is not set up on this server. Ask your system administrator to install the face models and key.
      </p>
    );
  }

  return (
    <section className="st-section">
      <h2 className="st-section-title">Face unlock</h2>
      <p className="st-section-desc">
        {status.enrolled
          ? "Your face is enrolled. Enroll again to replace it."
          : "Enroll your face so you can unlock your account with a face scan after a lockout."}
      </p>

      <label className="st-section-desc" htmlFor="face-enroll-password">
        Current password
      </label>
      <input
        id="face-enroll-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy}
        style={{ display: "block", width: "100%", maxWidth: 320, padding: "8px 10px", margin: "6px 0 12px" }}
      />

      <button
        type="button"
        className="st-btn st-btn--primary"
        disabled={busy || !password}
        onClick={() => setShowCapture(true)}
      >
        {status.enrolled ? "Re-enroll face" : "Enroll face"}
      </button>

      {showCapture && (
        <FaceCaptureModal
          title="Enroll your face"
          actionLabel="Capture and enroll"
          busy={busy}
          onCapture={enroll}
          onClose={() => setShowCapture(false)}
        />
      )}
    </section>
  );
}