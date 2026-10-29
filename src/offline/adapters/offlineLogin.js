// Offline unlock. After a successful ONLINE login, the user's profile (role,
// permissions, admin flag) is stored AES-GCM encrypted, with the key derived
// from the password. Tampering with localStorage cannot change the profile,
// because decryption fails. Lockout is per username.
import { scrypt } from 'scrypt-js';
import { readSnapshot, refreshSnapshot } from '../snapshotStore';

const LOCK_KEY = 'cr_offline_lock_v2';
const MAX_TRIES = 5;
const LOCK_MS = 60 * 1000;

const normUser = (u) => String(u || '').trim().toLowerCase();

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
const readLocks = () => readJSON(LOCK_KEY, {});
const writeLocks = (locks) => localStorage.setItem(LOCK_KEY, JSON.stringify(locks));

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

  const snapshot = await readSnapshot();
  const account = snapshot?.users?.[user];
  if (!account) return { ok: false, reason: 'no_record' };

  const parts = String(account.password || '').split('$');
  const params = parts[0]?.match(/^scrypt:32768:8:1$/);
  if (!params || parts.length !== 3 || !/^[0-9a-f]{128}$/i.test(parts[2])) {
    throw new Error('The saved offline account does not contain a supported scrypt hash.');
  }

  const n = 32768;
  const r = 8;
  const p = 1;
  const expected = parts[2].toLowerCase();
  const derived = await scrypt(
    new TextEncoder().encode(password),
    new TextEncoder().encode(parts[1]),
    n,
    r,
    p,
    expected.length / 2,
  );
  const actual = Array.from(derived, (byte) => byte.toString(16).padStart(2, '0')).join('');
  let mismatch = actual.length ^ expected.length;
  for (let i = 0; i < Math.min(actual.length, expected.length); i += 1) {
    mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch === 0) {
    delete locks[user];
    writeLocks(locks);
    return {
      ok: true,
      user: {
        ...account,
        username: account.username || user,
        role: account.roles?.[0] || '',
        is_admin: Array.isArray(account.permissions) && account.permissions.includes('*'),
      },
    };
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

const API = import.meta.env.VITE_API_BASE_URL || "";
let lastOfflineSync = 0;

// Throttled to once every 30 seconds unless forced.
export async function syncOfflineAccountsFromServer({ force = false } = {}) {
  if (!navigator.onLine) return false;
  if (!force && Date.now() - lastOfflineSync < 30000) return true;

  await refreshSnapshot(API);
  lastOfflineSync = Date.now();
  return true;
}