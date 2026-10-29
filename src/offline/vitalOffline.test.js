import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mockDb = { get: vi.fn(), put: vi.fn(), getKey: vi.fn() };
  const isDbAvailable = vi.fn();
  const apiFetch = vi.fn();
  const createPdfBlobFromData = vi.fn();
  const readSnapshot = vi.fn(async () => null);
  const updateSnapshot = vi.fn(async () => ({ status: "no-snapshot" }));
  return { mockDb, isDbAvailable, apiFetch, createPdfBlobFromData, readSnapshot, updateSnapshot };
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

vi.mock("./snapshotStore", () => ({
  readSnapshot: mocks.readSnapshot,
  updateSnapshot: mocks.updateSnapshot,
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

  it("skips PDF prefetch when the PDF is already in IndexedDB", async () => {
    mocks.isDbAvailable.mockReturnValue(true);
    mocks.mockDb.getKey.mockResolvedValue("vr-birth-pdf:42");

    vitalOffline.startPdfPrefetch("birth", [42], "", 0);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("requests a record without PDF data once, caches a missing marker, then skips it", async () => {
    const records = new Map();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.isDbAvailable.mockReturnValue(true);
    mocks.mockDb.get.mockImplementation(async (store, key) => records.get(key));
    mocks.mockDb.put.mockImplementation(async (store, record) => {
      records.set(record.key, record);
    });
    mocks.mockDb.getKey.mockImplementation(async (store, key) =>
      records.has(key) ? key : undefined
    );
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        pdf_data: null,
        pdf_error: "PDF file not found on server.",
      }),
    });

    vitalOffline.startPdfPrefetch("marriage", [191], "", 0);
    await vi.waitFor(() => expect(mocks.mockDb.put).toHaveBeenCalledOnce());

    expect(mocks.apiFetch).toHaveBeenCalledOnce();
    expect(records.get("vr-marriage-pdf-missing:191")).toMatchObject({
      key: "vr-marriage-pdf-missing:191",
      reason: "PDF file not found on server.",
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("[vitalOffline] PDF unavailable", {
      entity: "marriage",
      id: 191,
      pdf_error: "PDF file not found on server.",
    });

    vitalOffline.startPdfPrefetch("marriage", [191], "", 0);
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.apiFetch).toHaveBeenCalledOnce();
  });

  it("shares an in-flight PDF prefetch across recreated record arrays", async () => {
    mocks.isDbAvailable.mockReturnValue(true);
    mocks.apiFetch.mockImplementation(() => new Promise((resolve) => {
      mocks.resolvePdfRequest = resolve;
    }));
    mocks.createPdfBlobFromData.mockReturnValue(new Blob(["pdf"], { type: "application/pdf" }));

    vitalOffline.startPdfPrefetch("birth", [93], "", 0);
    vitalOffline.startPdfPrefetch("birth", [93], "", 0);
    await vi.waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);

    mocks.resolvePdfRequest({
      ok: true,
      json: async () => ({ pdf_data: "data" }),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("keeps the PDF prefetch key stable when records are recreated with the same IDs", () => {
    const first = [{ id: 42 }, { id: 17 }];
    const recreated = [{ id: 17 }, { id: 42 }];

    expect(vitalOffline.pdfPrefetchKey(first)).toBe(vitalOffline.pdfPrefetchKey(recreated));
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

  it("returns an explicit no-snapshot state for VRM list reads", async () => {
    mocks.isDbAvailable.mockReturnValue(false);

    await expect(
      vitalOffline.loadListWithFallback("birth", "/api/birth/records", "records"),
    ).resolves.toMatchObject({
      status: "no-snapshot",
      message: expect.stringContaining("Connect once"),
    });
  });
});
