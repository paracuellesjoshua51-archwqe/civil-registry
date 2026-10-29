import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    clear: vi.fn(async () => {}),
    getAllKeys: vi.fn(async () => []),
    transaction: vi.fn(),
  },
  getDB: vi.fn(),
}));

vi.mock("./db", () => ({
  getDB: mocks.getDB,
}));

import { cacheClear, clearSnapshotOnSessionExpiry } from "./cache";

const cache = {
  delete: vi.fn(async () => true),
};

describe("cacheClear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDB.mockResolvedValue(mocks.db);
    sessionStorage.setItem("username", "alice");
    vi.stubGlobal("caches", {
      open: vi.fn(async (name) => {
        expect(name).toBe("vr-snapshot-v1");
        return cache;
      }),
    });
  });

  it("deletes the current user's offline snapshot when logging out", async () => {
    await cacheClear("alice");

    expect(cache.delete).toHaveBeenCalledWith(expect.stringContaining("/__offline__/alice/snapshot.json"));
    expect(mocks.db.clear).toHaveBeenCalledWith("cache");
  });

  it("deletes the user's snapshot when their cached session expires", async () => {
    await clearSnapshotOnSessionExpiry("alice");

    expect(cache.delete).toHaveBeenCalledWith(expect.stringContaining("/__offline__/alice/snapshot.json"));
  });
});
