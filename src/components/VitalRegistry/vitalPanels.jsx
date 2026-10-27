import React, { useState } from "react";
import { Skeleton } from "../Skeleton";
import { printPdfFromData } from "../../utils/pdfUtils";
import { usePdfUrl, useViewport } from "./hooks";
import { STEPS } from "./vitalFormat";
import { IconDocument, IconDocumentLg, IconPrint } from "./icons";

export function StepBar({ current }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  const { isMobile } = useViewport();
  return (
    <div className="ubr-stepbar-wrap">
      <div className="ubr-stepbar">
        <div className="ubr-stepbar__inner">
          {STEPS.map((s, i) => {
            const done = i < idx;
            const active = i === idx;
            const mod = done ? "done" : active ? "active" : "pending";
            const isLast = i === STEPS.length - 1;
            return (
              <React.Fragment key={s.key}>
                <div className="ubr-stepbar__step">
                  <div className={`ubr-stepbar__circle ubr-stepbar__circle--${mod}`}>
                    {done ? "✓" : i + 1}
                  </div>
                  {(!isMobile || active) && (
                    <span className={`ubr-stepbar__label ubr-stepbar__label--${mod}`}>{s.label}</span>
                  )}
                </div>
                {!isLast && (
                  <div className="ubr-stepbar__seg">
                    <div className="ubr-stepbar__seg-rail" />
                    {done && <div className="ubr-stepbar__seg-fill" />}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** parents: [{ text, tone: "father" | "mother" }] */
export function RelativesChips({ parents }) {
  const shown = parents.filter((p) => p.text);
  if (!shown.length) return <span className="tbl-relative-empty">—</span>;
  return (
    <div className="tbl-relatives">
      {shown.map((p) => (
        <span key={p.tone} className={`tbl-relative-chip tbl-relative-chip--${p.tone}`}>{p.text}</span>
      ))}
    </div>
  );
}

export function MobileRecordCard({ index, name, parents, date, selected, pending, onToggle, onView, onDelete }) {
  const shown = parents.filter((p) => p.text);
  return (
    <div className={`mobile-record-card${selected ? " mobile-record-card--selected" : ""}`}>
      <div className="mobile-record-card__top">
        <input
          type="checkbox"
          className="tbl-checkbox"
          checked={!!selected}
          onChange={onToggle}
          aria-label={`Select ${name}`}
        />
        <span className="mobile-record-card__num">#{index + 1}</span>
        <span className="mobile-record-card__name">{name}</span>
        {pending && <span className="archived-badge">Pending sync</span>}
      </div>
      {shown.length > 0 && (
        <div className="mobile-record-card__parents">
          {shown.map((p) => (
            <span key={p.tone} className={`tbl-relative-chip tbl-relative-chip--${p.tone}`}>{p.text}</span>
          ))}
        </div>
      )}
      <div className="mobile-record-card__date">{date}</div>
      <div className="mobile-record-card__actions">
        <button className="tbl-btn tbl-btn--blue" onClick={onView}>View</button>
        <button className="tbl-btn tbl-btn--red" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

export function InlinePdfViewer({ pdfData, pdfError, loadingPdf, displayName, badge, showNotif }) {
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

  if (loadingPdf) {
    return (
      <div className="ui-skeleton-surface">
        <Skeleton h={34} />
        <Skeleton h="46vh" style={{ marginTop: 12 }} />
      </div>
    );
  }

  if (!pdfUrl) {
    return (
      <div className="pdf-inline-empty">
        <span className="pdf-inline-empty__icon"><IconDocumentLg /></span>
        <div className="pdf-inline-empty__title">
          {pdfError ? "Unable to display PDF" : "No document to display"}
        </div>
        <div className="pdf-inline-empty__sub">
          {pdfError || "Select a record to preview it here."}
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-inline-wrap">
      <div className="pdf-inline-toolbar">
        <div className="pdf-inline-toolbar__left">
          <span className="pdf-inline-toolbar__icon"><IconDocument /></span>
          <span className="pdf-inline-toolbar__name">{displayName}</span>
          <span className="pdf-inline-toolbar__badge">{badge}</span>
        </div>
        <button className="pdf-inline-print-btn" onClick={handlePrint} disabled={printing}>
          <span className="pdf-inline-print-btn__icon"><IconPrint /></span>
          {printing ? "Printing…" : "Print"}
        </button>
      </div>
      <div className="pdf-inline-viewer">
        <iframe key={pdfUrl} src={`${pdfUrl}#toolbar=1&navpanes=0`} title={displayName} className="pdf-inline-iframe" />
      </div>
    </div>
  );
}