import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSnapshot: vi.fn(),
  markOnline: vi.fn(),
}));

vi.mock("../snapshotStore", () => ({
  readSnapshot: mocks.readSnapshot,
}));

vi.mock("../connectivityService", () => ({
  markOnline: mocks.markOnline,
}));

import { getDashboardData } from "./dashboardOffline";

const endpoint = "https://backend.example/api/analytics/summary";
const snapshot = {
  data: {},
  _snapshot: {
    savedAt: "2026-10-29T10:00:00.000Z",
    dashboard: {
      "/api/analytics/summary": { total_records: 17 },
    },
  },
};

describe("dashboard live-first reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSnapshot.mockResolvedValue(snapshot);
  });

  it("uses live data without showing the offline banner when the online request succeeds", async () => {
    const liveData = { total_records: 21 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => liveData,
    }));

    const result = await getDashboardData(endpoint);

    expect(result).toEqual({ data: liveData, fromCache: false, cachedAt: null });
    expect(mocks.readSnapshot).not.toHaveBeenCalled();
  });

  it("shows snapshot data and its timestamp only after a live request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const result = await getDashboardData(endpoint);

    expect(result).toEqual({
      data: { total_records: 17 },
      fromCache: true,
      cachedAt: Date.parse(snapshot._snapshot.savedAt),
    });
    expect(mocks.readSnapshot).toHaveBeenCalledOnce();
    expect(result.fromCache).toBe(true);
  });

  it("returns the neutral no-snapshot state when offline without a saved snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    mocks.readSnapshot.mockResolvedValue(null);

    await expect(getDashboardData(endpoint)).rejects.toMatchObject({
      status: "no-snapshot",
      message: "Connect once to download offline data.",
    });
  });
});
