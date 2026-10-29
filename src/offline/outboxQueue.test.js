import { beforeEach, describe, it, expect, vi } from "vitest";
import { enqueue, listByStatus, removeOp } from "./outboxQueue";
import { getToasts } from "../services/toastService";

describe("outbox queue", () => {
  beforeEach(() => {
    sessionStorage.setItem("username", "alice");
  });

  it("stores a queued transaction as pending and removes it cleanly", async () => {
    const opId = "test-op-queue-1";
    await enqueue({
      opId,
      entity: "birth",
      label: "Transaction: test",
      method: "POST",
      url: "/api/birth/records/complete",
      json: { paymentAmount: 75 },
    });

    const queued = (await listByStatus()).find((o) => o.opId === opId);
    expect(queued?.status).toBe("pending");
    expect(queued?.url).toBe("/api/birth/records/complete");
    expect(queued?.username).toBe("alice");

    await removeOp(opId);
    expect((await listByStatus()).some((o) => o.opId === opId)).toBe(false);
  });

  it("refuses to queue an operation without a signed-in owner", async () => {
    sessionStorage.removeItem("username");
    await expect(enqueue({
      opId: "unowned-op",
      entity: "preferences",
      label: "Preference update",
      method: "POST",
      url: "/api/preferences",
      json: { theme: "dark" },
    })).rejects.toThrow("Sign in before queuing");
  });

  it("rejects sensitive writes without WebCrypto and shows an error toast", async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      randomUUID: originalCrypto?.randomUUID?.bind(originalCrypto),
      subtle: undefined,
    });

    try {
      await expect(enqueue({
        opId: "test-op-sensitive-no-crypto",
        entity: "birth",
        label: "Transaction: sensitive",
        method: "POST",
        url: "/api/birth/records/complete",
        json: { child_full_name: "Test Person", payment_amount: 75 },
      })).rejects.toThrow("secure encryption is unavailable");

      expect(getToasts().some((toast) =>
        toast.title === "Secure offline storage required"
        && toast.message.includes("secure encryption is unavailable")
      )).toBe(true);

      await enqueue({
        opId: "test-op-nonsensitive-no-crypto",
        entity: "preferences",
        label: "Preference update",
        method: "POST",
        url: "/api/preferences",
        json: { theme: "dark" },
      });
      expect((await listByStatus()).some((op) =>
        op.opId === "test-op-nonsensitive-no-crypto"
      )).toBe(true);
    } finally {
      vi.stubGlobal("crypto", originalCrypto);
    }
  });
});
