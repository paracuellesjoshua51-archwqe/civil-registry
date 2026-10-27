import { describe, it, expect } from "vitest";
import { createPdfBlobFromData, getPdfBlobUrl, looksLikePdfBytes } from "./pdfUtils";

const RAW_PDF = "%PDF-1.4\n%%EOF";
const b64 = (s) => btoa(s);
const toBytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe("looksLikePdfBytes", () => {
  it("accepts a %PDF- header", () => {
    expect(looksLikePdfBytes(toBytes(RAW_PDF))).toBe(true);
  });

  it("allows leading whitespace", () => {
    expect(looksLikePdfBytes(toBytes("\n  " + RAW_PDF))).toBe(true);
  });

  it("rejects other content", () => {
    expect(looksLikePdfBytes(toBytes("hello world"))).toBe(false);
  });
});

describe("createPdfBlobFromData", () => {
  it("reads a data URI", () => {
    const blob = createPdfBlobFromData(`data:application/pdf;base64,${b64(RAW_PDF)}`);
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(RAW_PDF.length);
  });

  it("recovers base64 that was encoded twice", () => {
    const blob = createPdfBlobFromData(b64(b64(RAW_PDF)));
    expect(blob.size).toBe(RAW_PDF.length);
  });

  it("returns null for non-PDF data", () => {
    expect(createPdfBlobFromData(b64("not a pdf"))).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(createPdfBlobFromData("")).toBeNull();
  });
});

describe("getPdfBlobUrl", () => {
  it("passes existing URLs through unchanged", () => {
    expect(getPdfBlobUrl("https://example.test/a.pdf")).toBe("https://example.test/a.pdf");
  });
});
