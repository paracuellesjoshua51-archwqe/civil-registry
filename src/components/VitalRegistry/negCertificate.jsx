import React from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { IconClipboard, IconInfo, IconPrint } from "./icons";
import { OFFICE_CONFIG, formatCertDate, formatTodayLong } from "./vitalFormat";

const SCC_LOGO = "/scc.png";
const LCR_LOGO = "/lcr.jpg";

/* ── Logos ── */

export function OfficeLogo({ className = "" }) {
  return (
    <div className="office-logo-group">
      <img src={SCC_LOGO} alt="Office Seal" className={className} />
      <img src={LCR_LOGO} alt="LCR Seal" className={className} />
    </div>
  );
}

/* ── Certificate body (shared by the on-screen preview and the print document) ── */

const DATE_OR_PLACEHOLDER = (copy, eventDate) =>
  eventDate
    ? <strong className="neg-cert-doc__highlight">{formatCertDate(eventDate)}</strong>
    : <strong className="neg-cert-doc__highlight neg-cert-doc__placeholder">[{copy.datePlaceholder}]</strong>;

const VALUE_OR_PLACEHOLDER = (value, placeholder) =>
  value
    ? <strong className="neg-cert-doc__highlight">{String(value).toUpperCase()}</strong>
    : <strong className="neg-cert-doc__highlight neg-cert-doc__placeholder">[{placeholder}]</strong>;

/**
 * data: { subjectName, eventDate, father, mother, requestorName }
 * copy: config.certificate (wording that differs by record type)
 * orNode: the O.R. number element (an input in preview, a span in print)
 */
export function NegCertBody({ copy, data, todayDate, datePaid, orNode }) {
  const { subjectName, eventDate, father, mother, requestorName } = data;
  const year = eventDate ? new Date(eventDate).getFullYear() : new Date().getFullYear();
  const officer = OFFICE_CONFIG.certifyingOfficer;
  const verified = OFFICE_CONFIG.verifiedBy;

  return (
    <div className="neg-cert-doc__inner">
      <div className="neg-cert-doc__logo-wrap">
        <OfficeLogo className="neg-cert-doc__logo" />
      </div>
      <p className="neg-cert-doc__date">{todayDate}</p>
      <p className="neg-cert-doc__salutation">TO WHOM IT MAY CONCERN:</p>
      <p className="neg-cert-doc__para">
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;We certify that this office has no records of {copy.noun} of{" "}
        <strong className="neg-cert-doc__highlight">{(subjectName || "").toUpperCase()}</strong>{" "}
        who is alleged to have been {copy.eventVerb} on {DATE_OR_PLACEHOLDER(copy, eventDate)}{" "}
        in {OFFICE_CONFIG.cityMunicipality}{copy.parentsPhrase}
        {VALUE_OR_PLACEHOLDER(father, "FATHER'S NAME")} and{" "}
        {VALUE_OR_PLACEHOLDER(mother, "MOTHER'S NAME")}{copy.afterParents}
        we cannot issue, as requested, {copy.certificateName} or transcription from the {copy.registerName}.
      </p>
      <p className="neg-cert-doc__para">
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;We also certify that the records of {copy.Noun} for the year{" "}
        <strong>{year}</strong> are still intact in the archives of this office.
      </p>
      <p className="neg-cert-doc__para">
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This certification is issued to{" "}
        {VALUE_OR_PLACEHOLDER(requestorName, "REQUESTOR'S NAME")} upon his/her request.
      </p>

      <div className="neg-cert-doc__sig-block">
        <div className="neg-cert-doc__sig-right">
          <div className="neg-cert-doc__sig-name">{officer.name}</div>
          <div className="neg-cert-doc__sig-title"><strong>{officer.title}</strong></div>
        </div>
      </div>

      <div className="neg-cert-doc__verified">
        <div className="neg-cert-doc__verified-label">Verified by:</div>
        <div className="neg-cert-doc__verified-name">{verified.name}</div>
        <div className="neg-cert-doc__verified-title"><strong>{verified.title}</strong></div>
      </div>

      <div className="neg-cert-doc__payment">
        <div className="neg-cert-doc__payment-row">
          <span className="neg-cert-doc__payment-label">Amount Paid</span>
          <span className="neg-cert-doc__payment-colon">:</span>
          <span className="neg-cert-doc__payment-value">{OFFICE_CONFIG.amountPaid}</span>
        </div>
        <div className="neg-cert-doc__payment-row">
          <span className="neg-cert-doc__payment-label">O.R. Number</span>
          <span className="neg-cert-doc__payment-colon">:</span>
          {orNode}
        </div>
        <div className="neg-cert-doc__payment-row">
          <span className="neg-cert-doc__payment-label">Date Paid</span>
          <span className="neg-cert-doc__payment-colon">:</span>
          <span className="neg-cert-doc__payment-value">{datePaid || todayDate}</span>
        </div>
      </div>
    </div>
  );
}

/* ── On-screen preview with an editable O.R. number ── */

export function NegativeCertPreview({ copy, data, orNumber, onOrNumberChange, onPrint }) {
  const todayDate = formatTodayLong();
  const orNode = (
    <input
      id="neg-or-number"
      name="orNumber"
      type="text"
      aria-label="O.R. Number"
      className="neg-cert-doc__payment-value neg-cert-doc__payment-blank neg-cert-doc__or-input"
      value={orNumber || ""}
      onChange={(e) => onOrNumberChange(e.target.value)}
      placeholder="Enter O.R. Number"
    />
  );

  return (
    <div className="neg-cert-preview-wrap">
      <div className="neg-cert-preview-toolbar">
        <div className="neg-cert-preview-toolbar__left">
          <span className="neg-cert-preview-toolbar__icon"><IconClipboard /></span>
          <span className="neg-cert-preview-toolbar__name">{copy.title}</span>
          <span className="neg-cert-preview-toolbar__badge">Negative Certificate</span>
        </div>
        <button className="pdf-inline-print-btn" onClick={onPrint}>
          <span className="pdf-inline-print-btn__icon"><IconPrint /></span>
          Print Certificate
        </button>
      </div>
      <div className="neg-cert-doc">
        <NegCertBody copy={copy} data={data} todayDate={todayDate} orNode={orNode} />
      </div>
      <div className="neg-cert-note">
        <span className="neg-cert-note__icon"><IconInfo /></span>
        <span>Preview reflects the data you entered. Enter the O.R. Number, then click "Print Certificate" to print the completed document.</span>
      </div>
    </div>
  );
}

/* ── Print ── */

// One stylesheet for the print document. Class names match the preview, so
// the printed page and the preview are built from the same markup.
const PRINT_CSS = `
  @page { size: letter; margin: 0; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    font-family: "Times New Roman", Times, serif;
    font-size: 12pt; color: #000; background: #fff;
    padding: 1.2in 1in 1in 1in; line-height: 1.6;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .office-logo-group { display: flex; align-items: center; gap: 6pt; }
  .neg-cert-doc__inner { position: relative; }
  .neg-cert-doc__logo-wrap { position: absolute; top: -48pt; left: -46pt; }
  .neg-cert-doc__logo { width: 62pt; height: 62pt; display: block; }
  .neg-cert-doc__date { text-align: right; margin-bottom: 28pt; }
  .neg-cert-doc__salutation { margin-bottom: 16pt; }
  .neg-cert-doc__para { text-align: justify; margin-bottom: 12pt; }
  .neg-cert-doc__highlight { font-weight: bold; color: #000; }
  .neg-cert-doc__sig-block { margin-top: 36pt; display: flex; justify-content: flex-end; }
  .neg-cert-doc__sig-right { text-align: center; min-width: 200pt; }
  .neg-cert-doc__sig-name { font-weight: bold; }
  .neg-cert-doc__sig-title { font-style: italic; font-weight: bold; }
  .neg-cert-doc__verified { margin-top: 28pt; }
  .neg-cert-doc__verified-label { margin-bottom: 18pt; }
  .neg-cert-doc__verified-name { font-weight: bold; text-align: center; display: block; }
  .neg-cert-doc__verified-title { font-style: italic; font-weight: bold; text-align: center; display: block; }
  .neg-cert-doc__payment { margin-top: 32pt; }
  .neg-cert-doc__payment-row { margin-bottom: 6pt; display: flex; gap: 4pt; align-items: flex-end; }
  .neg-cert-doc__payment-label { min-width: 90pt; flex-shrink: 0; }
  .neg-cert-doc__payment-colon { min-width: 8pt; flex-shrink: 0; margin-right: 4pt; }
  .neg-cert-doc__payment-value { flex: 1; color: #000; }
`;

/**
 * Renders the certificate off-screen, then prints it through an iframe.
 * data: { subjectName, eventDate, father, mother, requestorName, orNumber }
 */
export function printNegativeCertificate({ copy, data }) {
  const mount = document.createElement("div");
  mount.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;";
  document.body.appendChild(mount);
  const root = ReactDOM.createRoot(mount);
  const todayDate = formatTodayLong();

  flushSync(() => {
    root.render(
      <div className="neg-cert-doc">
        <NegCertBody
          copy={copy}
          data={data}
          todayDate={todayDate}
          datePaid={todayDate}
          orNode={<span className="neg-cert-doc__payment-value">{data.orNumber}</span>}
        />
      </div>,
    );
  });

  const bodyHtml = mount.innerHTML;
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<base href="${window.location.origin}/" />
<title></title>
<style>${PRINT_CSS}</style>
</head>
<body>${bodyHtml}</body>
</html>`;

  const iframe = document.createElement("iframe");
  iframe.className = "print-iframe";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  iframe.onload = () => {
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => {
        iframe.remove();
        try { root.unmount(); } catch { /* already unmounted */ }
        mount.remove();
      }, 2000);
    }, 600);
  };
  iframe.src = "about:blank";
}