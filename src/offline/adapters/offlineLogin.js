// Offline unlock. After a successful ONLINE login, the user's profile (role,
// permissions, admin flag) is stored AES-GCM encrypted, with the key derived
// from the password. Tampering with localStorage cannot change the profile,
// because decryption fails. Lockout is per username.
import { deriveKey, randomSalt, encryptJSON, decryptJSON } from '../crypto';

const CREDS_KEY = 'cr_offline_creds_v2';
const LOCK_KEY = 'cr_offline_lock_v2';
const LEGACY_KEYS = ['cr_offline_creds_v1', 'cr_offline_lock_v1']; // plaintext profiles, removed
const ITER = 210000;
const MAX_TRIES = 5;
const LOCK_MS = 60 * 1000;
const CHECK = 'ok';

const normUser = (u) => String(u || '').trim().toLowerCase();
const categoryOf = (profile) =>
  String(profile?.category || profile?.role_category || 'default').toLowerCase();
const recKey = (username, category) => `${normUser(username)}|${category}`;

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
const readCreds = () => readJSON(CREDS_KEY, {});
const writeCreds = (all) => localStorage.setItem(CREDS_KEY, JSON.stringify(all));
const readLocks = () => readJSON(LOCK_KEY, {});
const writeLocks = (locks) => localStorage.setItem(LOCK_KEY, JSON.stringify(locks));

// Called from Login.jsx after a successful online login.
export async function saveOfflineCredential(username, password, profile = {}) {
  try {
    const category = categoryOf(profile);
    const salt = randomSalt();
    const key = await deriveKey(password, salt, ITER);
    const blob = await encryptJSON(key, { check: CHECK, profile });

    const all = readCreds();
    all[recKey(username, category)] = { salt, iter: ITER, blob, savedAt: Date.now() };
    writeCreds(all);

    LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));

    const locks = readLocks();
    delete locks[normUser(username)];
    writeLocks(locks);

    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  } catch (e) {
    console.warn('Could not save offline credential', e);
  }
}

// Returns { ok, user?, reason?, attemptsLeft? }
// reason: 'no_record' | 'locked' | 'bad_password'
export async function verifyOfflineLogin(username, password) {
  const user = normUser(username);
  if (!user) return { ok: false, reason: 'no_record' };

  const locks = readLocks();
  const lock = locks[user] || { tries: 0, until: 0 };
  if (lock.until && Date.now() < lock.until) {
    return { ok: false, reason: 'locked' };
  }

  // A user may have one record per category. Try each until one decrypts.
  const prefix = `${user}|`;
  const entries = Object.entries(readCreds()).filter(([k]) => k.startsWith(prefix));
  if (entries.length === 0) return { ok: false, reason: 'no_record' };

  for (const [, rec] of entries) {
    try {
      const key = await deriveKey(password, rec.salt, rec.iter);
      const data = await decryptJSON(key, rec.blob);
      if (data?.check !== CHECK) continue;

      delete locks[user];
      writeLocks(locks);
      return { ok: true, user: data.profile || {} };
    } catch {
      // Wrong password for this record, or tampered data. Try the next one.
    }
  }

  const tries = (lock.tries || 0) + 1;
  locks[user] = tries >= MAX_TRIES
    ? { tries: 0, until: Date.now() + LOCK_MS }
    : { tries, until: 0 };
  writeLocks(locks);

  return {
    ok: false,
    reason: 'bad_password',
    attemptsLeft: Math.max(MAX_TRIES - tries, 0),
  };
}

// Admin sync: replace this device's offline records with the server's list.
// Records for disabled, deleted, or unassigned accounts are removed.
const API = import.meta.env.VITE_API_BASE_URL || "";
let lastOfflineSync = 0;

export function applyOfflineAccounts(accounts) {
  const next = {};
  for (const a of accounts || []) {
    if (!a?.offline_record || !a.username || !a.category) continue;
    next[recKey(a.username, a.category)] = a.offline_record;
  }
  writeCreds(next);
  return Object.keys(next).length;
}

// Throttled to once every 30 seconds unless forced.
export async function syncOfflineAccountsFromServer({ force = false } = {}) {
  if (!navigator.onLine) return false;
  if (!force && Date.now() - lastOfflineSync < 30000) return true;

  const res = await fetch(`${API}/api/offline-accounts`, { credentials: "include" });
  if (!res.ok) return false;

  const body = await res.json();
  applyOfflineAccounts(body.accounts || []);
  lastOfflineSync = Date.now();
  return true;
}