import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readCredentials: vi.fn(),
  writeCredentials: vi.fn(),
  purgeLegacyLocalStorage: vi.fn(),
}));

vi.mock("./archiveLocalStore", () => mocks);

import {
  clearOfflineCredentialRefreshCache,
  refreshAllOfflineCredentials,
} from "./archivePassword";

describe("offline credential refresh cache", () => {
  let ownerSequence = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T00:00:00Z"));
    ownerSequence += 1;
    sessionStorage.setItem("username", `offline-credential-user-${ownerSequence}`);
    mocks.readCredentials.mockResolvedValue({ modules: {}, fails: {}, syncedAt: 0 });
    mocks.writeCredentials.mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ modules: {} }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reuses a successful result for ten minutes, then refreshes again", async () => {
    await expect(refreshAllOfflineCredentials()).resolves.toBe("saved");
    await expect(refreshAllOfflineCredentials()).resolves.toBe("saved");
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await expect(refreshAllOfflineCredentials()).resolves.toBe("saved");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("invalidates the refresh cache when the account's credentials are cleared", async () => {
    const username = sessionStorage.getItem("username");
    await refreshAllOfflineCredentials();
    clearOfflineCredentialRefreshCache(username);
    await refreshAllOfflineCredentials();

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
