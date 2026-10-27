import { describe, it, expect } from "vitest";
import { enqueue, listByStatus, removeOp } from "./outboxQueue";

describe("outbox queue", () => {
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

    await removeOp(opId);
    expect((await listByStatus()).some((o) => o.opId === opId)).toBe(false);
  });
});
