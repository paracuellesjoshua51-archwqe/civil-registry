// Archive credentials are kept in IndexedDB. Snapshot record lists use Cache Storage.
import { getMeta, setMeta } from './db';

const CREDS_KEY = 'archiveCreds:v2';
const LEGACY_PREFIX = 'cr_archive_';

const emptyCreds = () => ({ modules: {}, fails: {}, syncedAt: 0 });

export async function readCredentials() {
  try {
    const v = await getMeta(CREDS_KEY);
    if (!v || typeof v !== 'object') return emptyCreds();
    return { modules: v.modules || {}, fails: v.fails || {}, syncedAt: v.syncedAt || 0 };
  } catch {
    return emptyCreds();
  }
}

export async function writeCredentials(creds) {
  try {
    await setMeta(CREDS_KEY, creds);
    return true;
  } catch (e) {
    console.warn('[archiveLocalStore] could not save credentials:', e);
    return false;
  }
}

// Removes the copies written by the earlier localStorage version.
export function purgeLegacyLocalStorage() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(LEGACY_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}