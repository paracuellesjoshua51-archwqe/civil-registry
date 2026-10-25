// Offline unlock: human sa malampuson nga ONLINE login, i-save ang encrypted verifier.
// Kung offline ug naay valid nga password, ma-unlock ang local data. Ang server gihapon
// ang mo-validate sa tinuod nga session inig sync (401 -> 'sync-auth-required').
import { getMeta, setMeta } from './db'
import { deriveKey, randomSalt, encryptJSON, decryptJSON } from './crypto'

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000 // 14 adlaw
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 5 * 60 * 1000

let sessionKey = null // memory ra, mawala inig refresh/lock
let sessionUser = null

export const getKey = () => sessionKey
export const getOfflineUser = () => sessionUser
export const isUnlocked = () => !!sessionKey

export function lock() {
  sessionKey = null
  sessionUser = null
}

const credKey = (u) => `offlineAuth:${u.toLowerCase()}`
const attemptKey = (u) => `offlineAttempts:${u.toLowerCase()}`

// Tawga sa Login.jsx human sa malampuson nga online login
export async function saveOfflineCredential(username, password, profile = {}) {
  const salt = randomSalt()
  const key = await deriveKey(password, salt)
  const blob = await encryptJSON(key, { check: 'ok', profile })
  await setMeta(credKey(username), { salt, blob, savedAt: Date.now() })
  await setMeta(attemptKey(username), null)
  sessionKey = key
  sessionUser = { username, ...profile }
}

export async function hasOfflineCredential(username) {
  return !!(await getMeta(credKey(username)))
}

// Offline login. Return { ok, profile } o { ok:false, reason }
export async function unlockOffline(username, password) {
  const row = await getMeta(credKey(username))
  if (!row) return { ok: false, reason: 'no_credential' }
  const { salt, blob, savedAt } = row
  if (Date.now() - savedAt > MAX_AGE_MS) return { ok: false, reason: 'expired' }

  const att = (await getMeta(attemptKey(username))) || { count: 0, until: 0 }
  if (att.until > Date.now()) return { ok: false, reason: 'locked', retryAt: att.until }

  try {
    const key = await deriveKey(password, salt)
    const { check, profile } = await decryptJSON(key, blob)
    if (check !== 'ok') throw new Error('bad')
    await setMeta(attemptKey(username), null)
    sessionKey = key
    sessionUser = { username, ...profile }
    return { ok: true, profile: sessionUser }
  } catch {
    const count = att.count + 1
    await setMeta(attemptKey(username), {
      count: count >= MAX_ATTEMPTS ? 0 : count,
      until: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
    })
    return { ok: false, reason: 'wrong_password', attemptsLeft: Math.max(MAX_ATTEMPTS - count, 0) }
  }
}

export async function clearOfflineCredential(username) {
  await setMeta(credKey(username), null)
  await setMeta(attemptKey(username), null)
  lock()
}