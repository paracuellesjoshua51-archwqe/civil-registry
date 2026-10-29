import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkNow } from "./connectivityService";

describe("connectivity probe throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ db: true }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reuses the completed probe result for five seconds", async () => {
    await expect(checkNow()).resolves.toBe(true);
    await expect(checkNow()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5001);
    await expect(checkNow()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);

  });
});
