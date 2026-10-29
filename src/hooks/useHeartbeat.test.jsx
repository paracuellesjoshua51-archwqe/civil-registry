import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useHeartbeat from "./useHeartbeat";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function HeartbeatShell() {
  useHeartbeat(true);
  return null;
}

describe("app-shell heartbeat", () => {
  let container;
  let root;
  let originalHidden;

  beforeEach(() => {
    vi.useFakeTimers();
    originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (originalHidden) Object.defineProperty(document, "hidden", originalHidden);
    else delete document.hidden;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps one 30-second interval and pauses it while the document is hidden", () => {
    act(() => root.render(React.createElement(HeartbeatShell)));
    expect(vi.getTimerCount()).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(30_000));
    expect(fetch).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60_000));
    expect(fetch).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(vi.getTimerCount()).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
