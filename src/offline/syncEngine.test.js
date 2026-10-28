import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listByStatus = vi.fn();
  const updateOp = vi.fn();
  const markSynced = vi.fn();
  const trimSynced = vi.fn();
  const recoverInterrupted = vi.fn(async () => {});
  const markConflict = vi.fn();
  const isEntityAllowed = vi.fn(() => true);
  const isDbAvailable = vi.fn(() => true);
  const subscribeConnectivity = vi.fn(() => () => {});
  const getMeta = vi.fn(async () => null);
  const setMeta = vi.fn(async () => {});
  const requeueOne = vi.fn();

  return {
    listByStatus,
    updateOp,
    markSynced,
    trimSynced,
    recoverInterrupted,
    markConflict,
    isEntityAllowed,
    isDbAvailable,
    subscribeConnectivity,
    getMeta,
    setMeta,
    requeueOne,
  };
});

vi.mock("./outboxQueue", () => ({
  listByStatus: mocks.listByStatus,
  updateOp: mocks.updateOp,
  markSynced: mocks.markSynced,
  trimSynced: mocks.trimSynced,
  recoverInterrupted: mocks.recoverInterrupted,
  requeueOne: mocks.requeueOne,
}));

vi.mock("./db", () => ({
  getDB: vi.fn(async () => ({})),
  getMeta: mocks.getMeta,
  setMeta: mocks.setMeta,
}));

vi.mock("./secureStore", () => ({
  decryptJSON: vi.fn(async (value) => value),
}));

vi.mock("./syncScope", () => ({
  isEntityAllowed: mocks.isEntityAllowed,
}));

vi.mock("./conflictResolver", () => ({
  markConflict: mocks.markConflict,
}));

vi.mock("./connectivityService", () => ({
  isDbAvailable: mocks.isDbAvailable,
  subscribeConnectivity: mocks.subscribeConnectivity,
}));

import { runSync } from "./syncEngine";

async function runWithEmptyApiBase(operation) {
  vi.stubEnv("VITE_API_BASE_URL", "");
  vi.resetModules();
  const syncEngine = await import("./syncEngine");
  expect(syncEngine.API_BASE).toBe("");
  return operation(syncEngine.runSync);
}

describe("syncEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    sessionStorage.setItem("username", "alice");
    mocks.listByStatus.mockImplementation(async (status) => {
      if (status === "pending") return [{
        opId: "op-1",
        entity: "birth",
        method: "POST",
        url: "/api/records",
        json: { ok: true },
        attempts: 0,
        createdAt: Date.now(),
      }];
      if (status === "syncing") return [];
      return [];
    });
    mocks.isDbAvailable.mockReturnValue(true);
  });

  it("calls recoverInterrupted before processing the queue and keeps paused entities in the summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 503,
      json: async () => ({ error: "Server busy" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await runSync();

    expect(mocks.recoverInterrupted).toHaveBeenCalledTimes(1);
    expect(summary.pausedEntities).toEqual(["birth"]);
    expect(mocks.updateOp).toHaveBeenCalledWith("op-1", expect.objectContaining({ status: "pending", attempts: 1 }));
  });

  it("marks duplicate server responses as conflict instead of retrying them", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 409,
      json: async () => ({ error: "duplicate record" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await runSync();

    expect(mocks.markConflict).toHaveBeenCalledWith(expect.objectContaining({ opId: "op-1" }), "duplicate record");
    expect(summary.failed).toBe(1);
  });

  it("strips an old host from queued absolute URLs when API_BASE is empty", async () => {
    mocks.listByStatus.mockImplementation(async (status) => status === "pending" ? [{
      opId: "old-host-op",
      entity: "birth",
      method: "POST",
      url: "https://old-backend.example/api/records?source=offline",
      json: { ok: true },
      attempts: 0,
      createdAt: Date.now(),
    }] : []);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await runWithEmptyApiBase((runSyncWithEmptyBase) => runSyncWithEmptyBase());

    expect(fetchMock.mock.calls[0][0]).toBe("/api/records?source=offline");
  });

  it("preserves relative queued URLs when API_BASE is empty", async () => {
    mocks.listByStatus.mockImplementation(async (status) => status === "pending" ? [{
      opId: "relative-url-op",
      entity: "birth",
      method: "POST",
      url: "/api/records?source=offline",
      json: { ok: true },
      attempts: 0,
      createdAt: Date.now(),
    }] : []);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await runWithEmptyApiBase((runSyncWithEmptyBase) => runSyncWithEmptyBase());

    expect(fetchMock.mock.calls[0][0]).toBe("/api/records?source=offline");
  });

  it("counts a server failure when it reaches the retry limit", async () => {
    mocks.listByStatus.mockImplementation(async (status) => status === "pending" ? [{
      opId: "terminal-failure-op",
      entity: "birth",
      method: "POST",
      url: "/api/records",
      json: { ok: true },
      attempts: 7,
      createdAt: Date.now(),
    }] : []);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 503,
      json: async () => ({ error: "Server busy" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await runSync();

    expect(summary.failed).toBe(1);
    expect(mocks.updateOp).toHaveBeenCalledWith(
      "terminal-failure-op",
      expect.objectContaining({ status: "failed", attempts: 8 }),
    );
  });
});
