import React, { useState } from "react";
import { apiFetch } from "../../services/apiFetch";
import { isOnline } from "../../offline/connectivityService";
import { verifyArchivePasswordOffline, refreshOfflineCredential } from "../../offline/archivePassword";
import { printPdfFromData } from "../../utils/pdfUtils";
import { usePdfUrl } from "./hooks";
import { IconDocument, IconDocumentLg, IconEye, IconEyeOff, IconLock } from "./icons";

/**
 * message is a React node, not an HTML string. Record names are no longer
 * injected with dangerouslySetInnerHTML.
 */
export function ConfirmModal({ title, message, confirmLabel, confirmColor = "#dc2626", onConfirm, onCancel }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-acts">
          <button className="modal-cancel" onClick={onCancel}>Cancel</button>
          <button
            className="modal-confirm modal-confirm--red"
            style={confirmColor ? { background: confirmColor, borderColor: confirmColor } : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Asks for the date and parents before a negative certificate can be issued. */
export function NegCertInfoModal({ subjectName, requestorName, copy, onSubmit, onCancel }) {
  const fields = [
    { key: "eventDate", id: "negcert-event-date", label: `Date of ${copy.Noun}`, type: "date",
      msg: `Date of ${copy.noun} is required.` },
    { key: "father", id: "negcert-father", label: "Father's Full Name", type: "text",
      msg: "Father's name is required." },
    { key: "mother", id: "negcert-mother", label: "Mother's Full Name", type: "text",
      msg: "Mother's name is required." },
  ];
  const [values, setValues] = useState({ eventDate: "", father: "", mother: "" });
  const [errors, setErrors] = useState({});

  const change = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (value.trim()) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const submit = () => {
    const next = {};
    fields.forEach((f) => {
      if (!String(values[f.key] || "").trim()) next[f.key] = f.msg;
    });
    setErrors(next);
    if (Object.keys(next).length) return;
    onSubmit({
      eventDate: values.eventDate,
      father: values.father.trim(),
      mother: values.mother.trim(),
      requestorName: requestorName || subjectName || "",
    });
  };

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal-box negcert-info-modal" onClick={(e) => e.stopPropagation()}>
        <div className="negcert-info-modal__hdr">
          <div className="negcert-info-modal__hdr-text">
            <h3 className="negcert-info-modal__title">Negative Certificate Details</h3>
            <p className="negcert-info-modal__sub">
              For <strong className="negcert-info-modal__name">{subjectName || "this person"}</strong>
            </p>
          </div>
        </div>

        <div className="negcert-info-modal__fields">
          {fields.map((f, i) => (
            <div className="negcert-info-modal__field" key={f.key}>
              <label className="negcert-info-modal__label" htmlFor={f.id}>
                {f.label} <span className="negcert-info-modal__required">*</span>
              </label>
              <input
                id={f.id}
                name={f.key}
                type={f.type}
                className={`negcert-info-modal__input${errors[f.key] ? " negcert-info-modal__input--error" : ""}`}
                value={values[f.key]}
                onChange={(e) => change(f.key, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && f.type === "text") submit(); }}
                autoFocus={i === 0}
              />
              {errors[f.key] && (
                <span className="negcert-info-modal__error">&#9888; {errors[f.key]}</span>
              )}
            </div>
          ))}
        </div>

        <div className="modal-acts negcert-info-modal__acts">
          <button className="modal-cancel" onClick={onCancel}>Cancel</button>
          <button className="modal-confirm negcert-info-modal__submit" onClick={submit}>
            Issue Negative Certificate &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}

export function PdfModal({ pdfData, pdfError, fileName, onClose, showNotif }) {
  const pdfUrl = usePdfUrl(pdfData, pdfError, showNotif);
  const [printing, setPrinting] = useState(false);

  const handlePrint = async () => {
    if (!pdfData) { showNotif?.("No PDF available to print.", "error"); return; }
    try {
      setPrinting(true);
      await printPdfFromData(pdfData);
      showNotif?.("Printing selected PDF…", "success");
    } catch (error) {
      console.error(error);
      showNotif?.(error.message || "Failed to print PDF.", "error");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="pdf-overlay" onClick={onClose}>
      <div className="pdf-box" onClick={(e) => e.stopPropagation()}>
        <div className="pdf-hdr">
          <span className="pdf-hdr__label">
            <span className="pdf-hdr__label-icon"><IconDocument /></span>
            {fileName}
          </span>
          <div className="pdf-hdr-btns">
            {pdfUrl && (
              <button className="hdr-btn hdr-btn--print" onClick={handlePrint} disabled={printing}>
                {printing ? "Printing…" : "Print"}
              </button>
            )}
            <button className="hdr-btn hdr-btn--close" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div className="pdf-body">
          {pdfUrl ? (
            <iframe key={pdfUrl} src={`${pdfUrl}#toolbar=1&navpanes=0`} title={fileName} className="pdf-body__iframe" />
          ) : (
            <div className="pdf-inline-empty">
              <span className="pdf-inline-empty__icon"><IconDocumentLg /></span>
              <div className="pdf-inline-empty__title">Unable to display PDF</div>
              <div className="pdf-inline-empty__sub">{pdfError || "The selected PDF is empty or invalid."}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Administrator password gate for the archive tab. Online it verifies against
 * the server; offline (or when the server fails) it verifies against the
 * cached bcrypt hash.
 */
export function PasswordGate({ module, api, description, onUnlock, showNotif }) {
  const [pwInput, setPwInput] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const unlockOffline = async (pw) => {
    try {
      const result = await verifyArchivePasswordOffline(module, pw);
      if (result === "ok") {
        showNotif("Unlocked offline.", "success");
        onUnlock();
      } else if (result === "wrong") {
        showNotif("Incorrect password.", "error");
      } else if (result === "locked") {
        showNotif("Too many wrong attempts. Try again in 5 minutes.", "error");
      } else if (result === "unset") {
        showNotif("No password is set for this module yet.", "error");
      } else {
        showNotif("This device hasn't saved the password data yet. Open the app once while online and logged in.", "error");
      }
    } catch (error) {
      console.error("Offline archive password verification failed:", error);
      showNotif("Unable to verify the offline password.", "error");
    }
  };

  const handleSubmit = async () => {
    const pw = pwInput.trim();
    if (!pw) { showNotif("Password is required.", "error"); return; }
    setLoading(true);
    try {
      if (!isOnline()) { await unlockOffline(pw); return; }

      let res;
      try {
        res = await apiFetch(`${api}/auth/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ module, password: pw }),
        });
      } catch {
        await unlockOffline(pw);
        return;
      }
      if (res.status >= 500) { await unlockOffline(pw); return; }

      const data = await res.json().catch(() => ({}));
      if (data.success) {
        refreshOfflineCredential(module, api);
        onUnlock();
      } else {
        showNotif(data.message || "Incorrect password.", "error");
      }
    } catch (error) {
      console.error("Archive password verification failed:", error);
      showNotif("Unable to verify the archive password.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pw-gate">
      <div className="pw-gate__icon"><IconLock /></div>
      <p className="pw-gate__desc">{description}</p>
      <div className="pw-gate__form">
        <label className="pw-lbl" htmlFor={`${module}-password`}>Administrator Password</label>
        <div className="pw-input-wrap">
          <input
            id={`${module}-password`}
            name="password"
            type={showPw ? "text" : "password"}
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !loading) handleSubmit(); }}
            placeholder="Enter password"
            className="pw-input"
            autoComplete="current-password"
            autoFocus
            disabled={loading}
          />
          <button
            className="pw-toggle"
            type="button"
            onClick={() => setShowPw((v) => !v)}
            title={showPw ? "Hide password" : "Show password"}
            aria-label={showPw ? "Hide password" : "Show password"}
            disabled={loading}
          >
            {showPw ? <IconEyeOff /> : <IconEye />}
          </button>
        </div>
        <button className="btn btn-primary pw-gate__submit-btn" onClick={handleSubmit} disabled={loading}>
          {loading
            ? (<><div className="spinner spinner--sm" />&nbsp;Verifying…</>)
            : "Unlock & View Records →"}
        </button>
      </div>
    </div>
  );
}