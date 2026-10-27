import { apiFetch } from "../services/apiFetch";
import { isDbAvailable } from "../offline/connectivityService";

const CHUNK_SIZE = 100;

async function deleteChunkOnServer(api, ids) {
  try {
    const res = await apiFetch(`${api}/records/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server responded with ${res.status}`);

    const done = new Set(data.deleted_ids || []);
    return {
      deletedIds: ids.filter((id) => done.has(id)),
      failedIds: ids.filter((id) => !done.has(id)),
    };
  } catch {
    return { deletedIds: [], failedIds: ids };
  }
}


export async function runBulkDelete({ api, ids, byId, deleteOne }) {
  const online = isDbAvailable();
  const serverIds = online ? ids.filter((id) => typeof id === "number") : [];
  const serverSet = new Set(serverIds);
  const localIds = ids.filter((id) => !serverSet.has(id));

  let deleted = 0;
  let queued = 0;
  const failedIds = [];

  for (let i = 0; i < serverIds.length; i += CHUNK_SIZE) {
    const result = await deleteChunkOnServer(api, serverIds.slice(i, i + CHUNK_SIZE));
    deleted += result.deletedIds.length;
    failedIds.push(...result.failedIds);
  }

  for (const id of localIds) {
    try {
      const outcome = await deleteOne(id, byId.get(id));
      if (outcome === "queued") queued += 1;
      else deleted += 1;
    } catch {
      failedIds.push(id);
    }
  }

  return { deleted, queued, failedIds };
}