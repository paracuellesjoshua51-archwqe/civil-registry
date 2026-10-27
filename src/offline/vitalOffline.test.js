import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mockDb = { get: vi.fn(), put: vi.fn(), getKey: vi.fn() };
  const isDbAvailable = vi.fn();
  const apiFetch = vi.fn();
  const createPdfBlobFromData = vi.fn();
  return { mockDb, isDbAvailable, apiFetch, createPdfBlobFromData };
});

vi.mock("./db", () => ({
  getDB: vi.fn(async () => mocks.mockDb),
}));

vi.mock("./connectivityService", () => ({
  isDbAvailable: mocks.isDbAvailable,
  subscribeDb: vi.fn(),
  checkNow: vi.fn(),
}));

vi.mock("../services/apiFetch", () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock("../utils/pdfUtils", () => ({
  createPdfBlobFromData: mocks.createPdfBlobFromData,
}));

import * as vitalOffline from "./vitalOffline";

describe("vitalOffline.loadPdfForRecord", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.mockDb.get.mockImplementation(async () => undefined);
    mocks.mockDb.put.mockResolvedValue(undefined);
    mocks.mockDb.getKey.mockImplementation(async () => undefined);
  });

  it("downloads and caches a PDF when the server is reachable", async () => {
    const blob = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    mocks.isDbAvailable.mockReturnValue(true);
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ pdf_data: "data" }),
    });
    mocks.createPdfBlobFromData.mockReturnValue(blob);

    const result = await vitalOffline.loadPdfForRecord("birth", "", 42, {});

    expect(result).toBe(blob);
    expect(mocks.apiFetch).toHaveBeenCalledWith("/records/42");
    expect(mocks.mockDb.put).toHaveBeenCalled();
  });

  it("returns the cached PDF when the device is offline", async () => {
    const cached = new Blob(["cached-pdf"], { type: "application/pdf" });
    mocks.isDbAvailable.mockReturnValue(false);
    mocks.mockDb.get.mockImplementation(async (store, key) => {
      if (store === "cache" && key === "vr-birth-pdf:42") return { blob: cached };
      return undefined;
    });

    const result = await vitalOffline.loadPdfForRecord("birth", "", 42, {});

    expect(result).toBe(cached);
  });

  it("falls back to cache when the server responds 503", async () => {
    const cached = new Blob(["server-down-fallback"], { type: "application/pdf" });
    mocks.isDbAvailable.mockReturnValue(true);
    mocks.apiFetch.mockResolvedValue({ ok: false, status: 503 });
    mocks.mockDb.get.mockImplementation(async (store, key) => {
      if (store === "cache" && key === "vr-birth-pdf:42") return { blob: cached };
      return undefined;
    });

    const result = await vitalOffline.loadPdfForRecord("birth", "", 42, {});

    expect(result).toBe(cached);
  });
});
