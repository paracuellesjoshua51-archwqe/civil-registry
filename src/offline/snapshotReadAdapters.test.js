import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSnapshot: vi.fn(async () => null),
  updateSnapshot: vi.fn(async () => ({ status: "no-snapshot" })),
  applySnapshotMutation: vi.fn(async () => ({ status: "no-snapshot" })),
  isDbAvailable: vi.fn(() => false),
  enqueue: vi.fn(),
  listAll: vi.fn(async () => []),
  newOpId: vi.fn(() => "offline-test"),
}));

vi.mock("./snapshotStore", () => ({
  readSnapshot: mocks.readSnapshot,
  updateSnapshot: mocks.updateSnapshot,
  applySnapshotMutation: mocks.applySnapshotMutation,
}));
vi.mock("./connectivityService", () => ({ isDbAvailable: mocks.isDbAvailable }));
vi.mock("./outboxQueue", () => ({
  enqueue: mocks.enqueue,
  listAll: mocks.listAll,
  newOpId: mocks.newOpId,
}));

import { getDashboardData } from "./adapters/dashboardOffline";
import { trackingRead } from "./adapters/documentTrackingOffline";

describe("snapshot read adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSnapshot.mockResolvedValue(null);
    mocks.isDbAvailable.mockReturnValue(false);
  });

  it("reports a no-snapshot state for dashboard reads", async () => {
    await expect(getDashboardData("/api/analytics/summary")).rejects.toMatchObject({
      status: "no-snapshot",
      message: expect.stringContaining("Connect once"),
    });
  });

  it("reports a no-snapshot error for Document Tracking reads", async () => {
    await expect(trackingRead("/api/documents")).rejects.toMatchObject({
      status: "no-snapshot",
      message: expect.stringContaining("Connect once"),
    });
  });
});
