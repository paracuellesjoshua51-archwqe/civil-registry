// src/offline/cache.js
// Removes personal data for one user. The outbox remains bound to its owner.
import { getDB } from './db'

const LOCAL_STORAGE_KEYS = ['dt_store_v4', 'dt_personnel_cache_v1']
const SNAPSHOT_CACHE = 'vr-snapshot-v1'
const SNAPSHOT_PATH = '/__offline__/'

function normalizedUsername(username) {
  return String(username || '').trim().toLowerCase()
}

function snapshotUrl(username) {
  const normalized = normalizedUsername(username)
  return normalized
    ? new URL(`${SNAPSHOT_PATH}${encodeURIComponent(normalized)}/snapshot.json`, window.location.origin).href
    : null
}

export async function clearSnapshot(username) {
  if (!username) return false
  const cache = await caches.open(SNAPSHOT_CACHE)
  return cache.delete(snapshotUrl(username))
}

export function clearSnapshotOnSessionExpiry(username) {
  return clearSnapshot(username)
}

export async function removeSnapshotsForOtherUsers(username) {
  const current = normalizedUsername(username)
  const cache = await caches.open(SNAPSHOT_CACHE)
  const requests = await cache.keys()
  await Promise.all(requests.filter((request) => {
    const path = new URL(request.url).pathname
    const match = path.match(/^\/__offline__\/([^/]+)\/snapshot\.json$/)
    if (!match) return path === '/__offline__/snapshot.json'
    let owner
    try {
      owner = decodeURIComponent(match[1]).trim().toLowerCase()
    } catch {
      return true
    }
    return owner !== current
  }).map((request) => cache.delete(request)))
}

export async function cacheClear(username) {
  await clearSnapshot(username)
  const db = await getDB()

  // Cached PDF copies.
  await db.clear('cache')

  // Archive password verifiers kept in meta.
  const metaKeys = (await db.getAllKeys('meta')).filter(
    (k) => k === 'archiveCreds:v2'
  )
  if (metaKeys.length) {
    const tx = db.transaction('meta', 'readwrite')
    for (const k of metaKeys) tx.store.delete(k)
    await tx.done
  }

  // Document Tracking copies kept in localStorage
  LOCAL_STORAGE_KEYS.forEach((k) => {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
  })
}