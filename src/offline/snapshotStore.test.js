import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySnapshotMutation,
  readSnapshot,
  reconcileSyncedCreate,
  writeSnapshot,
} from "./snapshotStore";
import { removeSnapshotsForOtherUsers } from "./cache";

const mocks = vi.hoisted(() => ({
  listByStatus: vi.fn(async () => []),
}));

vi.mock("./outboxQueue", () => ({
  listByStatus: mocks.listByStatus,
}));

let entries = new Map();
const cache = {
  put: vi.fn(async (request, response) => {
    entries.set(request.url, response.clone());
  }),
  match: vi.fn(async (request) => entries.get(request.url)?.clone()),
  keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
  delete: vi.fn(async (request) => entries.delete(request.url)),
};

describe("snapshotStore", () => {
  beforeEach(() => {
    entries = new Map();
    mocks.listByStatus.mockResolvedValue([]);
    sessionStorage.setItem("username", "alice");
    vi.stubGlobal("caches", {
      open: vi.fn(async (name) => {
        expect(name).toBe("vr-snapshot-v1");
        return cache;
      }),
    });
    vi.clearAllMocks();
  });

  it("writes a snapshot to Cache Storage and reads it back with a saved timestamp", async () => {
    const saved = await writeSnapshot({
      data: { birth_active: [{ id: 8, uploaded_at: "2026-01-02T00:00:00Z" }] },
      users: {},
    });

    const loaded = await readSnapshot();
    expect(cache.put).toHaveBeenCalledOnce();
    expect(loaded.data.birth_active[0]).toMatchObject({
      id: 8,
      updated_at: "2026-01-02T00:00:00Z",
    });
    expect(saved._snapshot.savedAt).toBeTruthy();
  });

  it("returns null when no cached snapshot exists", async () => {
    await expect(readSnapshot()).resolves.toBeNull();
  });

  it("isolates snapshots when a browser is reopened by a different user", async () => {
    await writeSnapshot({ data: { birth_active: [{ id: 8 }] }, users: {} });

    sessionStorage.setItem("username", "bob");
    await expect(readSnapshot()).resolves.toBeNull();

    await writeSnapshot({ data: { birth_active: [{ id: 9 }] }, users: {} });
    await removeSnapshotsForOtherUsers("bob");

    expect(await cache.keys()).toHaveLength(1);
    expect((await readSnapshot()).data.birth_active[0].id).toBe(9);
  });

  it("reflects server-side record deletion on refresh", async () => {
    await writeSnapshot({
      data: { birth_active: [{ id: 8, updated_at: "2026-01-02T00:00:00Z" }] },
      users: {},
    });

    await writeSnapshot({ data: { birth_active: [] }, users: {} });

    expect((await readSnapshot()).data.birth_active).toEqual([]);
  });

  it("moves duplicate records into only the latest archive bucket", async () => {
    await writeSnapshot({
      data: {
        birth_active: [{ id: 8, file_name: "record.pdf", updated_at: "2026-01-02T00:00:00Z" }],
        birth_archived: [{
          id: 8,
          file_name: "record.pdf",
          archived_at: "2026-01-03T00:00:00Z",
          updated_at: "2026-01-03T00:00:00Z",
        }],
      },
      users: {},
    });

    const snapshot = await readSnapshot();
    expect(snapshot.data.birth_active).toEqual([]);
    expect(snapshot.data.birth_archived).toHaveLength(1);
    expect(snapshot.data.birth_archived[0].id).toBe(8);
  });

  it("replaces an offline-created temporary record with the synced server record", async () => {
    sessionStorage.setItem("username", "alice");
    const op = {
      opId: "op-create",
      entity: "birth",
      method: "POST",
      url: "/api/birth/records",
      username: "alice",
      status: "pending",
    };
    mocks.listByStatus.mockResolvedValue([op]);
    await writeSnapshot({ data: { birth_active: [] }, users: {} });
    await applySnapshotMutation({
      entity: "birth",
      method: "POST",
      url: op.url,
      opId: op.opId,
      json: { id: "offline-op-create", file_name: "new.pdf", updated_at: "2026-01-02T00:00:00Z" },
    });
    const optimistic = await readSnapshot();
    expect([
      ...optimistic.data.birth_active,
      ...optimistic.data.birth_archived,
    ]).toHaveLength(1);

    const result = await reconcileSyncedCreate({
      entity: "birth",
      opId: op.opId,
      serverRecord: {
        id: 42,
        file_name: "new.pdf",
        is_archived: false,
        updated_at: "2026-01-03T00:00:00Z",
      },
    });
    expect(result.status).toBe("reconciled");

    const synced = await readSnapshot();
    const records = [...synced.data.birth_active, ...synced.data.birth_archived];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 42, file_name: "new.pdf" });
    expect(records.some((row) => row.id === "offline-op-create")).toBe(false);
  });

  it("converges two device snapshots to the server winner", async () => {
    sessionStorage.setItem("username", "alice");
    const original = {
      data: { birth_active: [{ id: 8, status: "original", updated_at: "2026-01-01T00:00:00Z" }] },
      users: {},
    };
    const server = {
      data: { birth_active: [{ id: 8, status: "device-b", updated_at: "2026-01-03T00:00:00Z" }] },
      users: {},
    };

    const deviceSnapshots = [];
    for (const [opId, status, updatedAt] of [
      ["device-a", "device-a", "2026-01-02T00:00:00Z"],
      ["device-b", "device-b", "2026-01-03T00:00:00Z"],
    ]) {
      entries = new Map();
      mocks.listByStatus.mockResolvedValue([]);
      await writeSnapshot(original);
      mocks.listByStatus.mockResolvedValue([{
        opId,
        entity: "birth",
        method: "PATCH",
        url: "/api/birth/records/8",
        username: "alice",
        status: "pending",
      }]);
      await applySnapshotMutation({
        entity: "birth",
        method: "PATCH",
        url: "/api/birth/records/8",
        opId,
        json: { status, updated_at: updatedAt },
      });
      await writeSnapshot(server);
      deviceSnapshots.push((await readSnapshot()).data.birth_active[0]);
    }

    expect(deviceSnapshots[0]).toEqual(deviceSnapshots[1]);
    expect(deviceSnapshots[0]).toMatchObject({ id: 8, status: "device-b" });
  });
});
