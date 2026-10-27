// The one implementation of PDF decoding, validation, blob URLs and printing.
// Replaces the copies that lived in the three verifier pages and in
// birthOffline.js / vitalOffline.js.

const DATA_URI_PREFIX = "data:application/pdf;base64,";
const URL_PATTERN = /^(blob:|https?:\/\/)/;
const WHITESPACE = new Set([0x20, 0x0a, 0x0d, 0x09]);

export function base64ToBytes(b64) {
  const binary = atob(String(b64 || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// True when the bytes start with "%PDF-" (leading whitespace allowed).
export function looksLikePdfBytes(bytes) {
  if (!bytes || bytes.length < 5) return false;
  let i = 0;
  while (i < bytes.length && WHITESPACE.has(bytes[i])) i++;
  return (
    i + 5 <= bytes.length &&
    bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 &&
    bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d
  );
}

function bytesToText(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

/**
 * Any stored representation -> Blob. Accepts a Blob, a data URI, raw base64,
 * or base64 that was encoded twice. Returns null when no valid PDF is found.
 */
export function createPdfBlobFromData(pdfData) {
  if (!pdfData) return null;
  try {
    if (pdfData instanceof Blob) {
      return pdfData.type === "application/pdf"
        ? pdfData
        : new Blob([pdfData], { type: "application/pdf" });
    }
    if (typeof pdfData !== "string" || URL_PATTERN.test(pdfData)) return null;

    let bytes;
    try {
      const b64 = pdfData.startsWith(DATA_URI_PREFIX)
        ? pdfData.slice(DATA_URI_PREFIX.length)
        : pdfData;
      bytes = base64ToBytes(b64);
    } catch {
      return null;
    }

    if (!looksLikePdfBytes(bytes)) {
      // Stored twice: the decoded bytes are themselves base64 text.
      try {
        const inner = base64ToBytes(bytesToText(bytes));
        if (looksLikePdfBytes(inner)) bytes = inner;
      } catch {
        /* fall through to the check below */
      }
    }

    return looksLikePdfBytes(bytes)
      ? new Blob([bytes], { type: "application/pdf" })
      : null;
  } catch (error) {
    console.error("Failed to create PDF blob:", error);
    return null;
  }
}

/** A blob: URL for displaying the PDF, or "" when it cannot be displayed. */
export function getPdfBlobUrl(pdfData) {
  if (!pdfData) return "";
  if (typeof pdfData === "string" && URL_PATTERN.test(pdfData)) return pdfData;
  const blob = createPdfBlobFromData(pdfData);
  return blob ? URL.createObjectURL(blob) : "";
}

/** Prints a PDF through a hidden iframe. Resolves when the print dialog closes or times out. */
export function printPdfFromData(pdfData) {
  return new Promise((resolve, reject) => {
    const blob = createPdfBlobFromData(pdfData);
    if (!blob) {
      reject(new Error("This PDF is corrupted or invalid and cannot be printed."));
      return;
    }
    const blobUrl = URL.createObjectURL(blob);
    const iframe = document.createElement("iframe");
    iframe.className = "print-iframe";
    iframe.setAttribute("aria-hidden", "true");

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      setTimeout(() => {
        iframe.remove();
        URL.revokeObjectURL(blobUrl);
      }, 1500);
    };

    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        reject(new Error("Unable to access print frame."));
        return;
      }
      setTimeout(() => {
        try {
          win.focus();
          win.onafterprint = () => { cleanup(); resolve(); };
          win.print();
          setTimeout(() => { cleanup(); resolve(); }, 2000);
        } catch (err) {
          cleanup();
          reject(err);
        }
      }, 800);
    };
    iframe.onerror = () => {
      cleanup();
      reject(new Error("Failed to load PDF for printing."));
    };
    iframe.src = blobUrl;
    document.body.appendChild(iframe);
  });
}