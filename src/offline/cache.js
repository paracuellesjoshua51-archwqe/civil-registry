// src/offline/cache.js
// Called on logout. Removes personal data cached on this device.
// The outbox (unsynced changes) and offline login records are kept.
import { getDB } from './db'

const LOCAL_STORAGE_KEYS = ['dt_store_v4', 'dt_personnel_cache_v1']

// Archive record lists saved through archiveLocalStore.js. Matches keys
// such as "birth:records", "death:archived", "marriage:records", with or
// without a storage prefix in front. Verify against archiveLocalStore.js.
const ARCHIVE_LIST_KEY = /(birth|death|marriage):(records|archived)/

function clearLocalArchiveLists() {
  try {
    const doomed = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && ARCHIVE_LIST_KEY.test(k)) doomed.push(k)
    }
    doomed.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

export async function cacheClear() {
  const db = await getDB()

  // Cached API responses, PDF copies, and dashboard data
  await db.clear('cache')

  // Archive password verifiers kept in meta; record lists are stored under
  // archiveLocalStore.js with the v2 prefix and are deleted via localStorage cleanup.
  const metaKeys = (await db.getAllKeys('meta')).filter(
    (k) => k === 'archiveCreds:v2'
  )
  if (metaKeys.length) {
    const tx = db.transaction('meta', 'readwrite')
    for (const k of metaKeys) tx.store.delete(k)
    await tx.done
  }

  // Archive record lists kept in localStorage (birth, death, marriage)
  clearLocalArchiveLists()

  // Document Tracking copies kept in localStorage
  LOCAL_STORAGE_KEYS.forEach((k) => {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
  })
}