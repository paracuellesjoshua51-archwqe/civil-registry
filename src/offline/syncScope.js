// Which permission-based sync entities this login may send.
// Single source of truth: PermissionContext sets it, the sync engine reads it.
// null = all modules (admin). A Set = only those entities.

export const ENTITY_PERMISSIONS = {
  birth:    ['birth_verification', 'birth_archive_uploader'],
  death:    ['death_verification', 'death_archive_uploader'],
  marriage: ['marriage_verification', 'marriage_archive_uploader'],
  tracking: [
    'document_tracking',
    'document_stage_registration',
    'document_stage_civil_registrar',
    'document_stage_posting_period',
    'document_stage_records_division',
    'document_stage_registry_number',
    'document_stage_releasing',
  ],
};

export const SYNC_MODULE_PERMISSIONS = {
  birth: ['birth_verification', 'birth_archive_uploader'],
  marriage: ['marriage_verification', 'marriage_archive_uploader'],
  death: ['death_verification', 'death_archive_uploader'],
  tracking: [
    'document_tracking',
    'document_stage_registration',
    'document_stage_civil_registrar',
    'document_stage_posting_period',
    'document_stage_records_division',
    'document_stage_registry_number',
    'document_stage_releasing',
  ],
};

export const SYNC_MODULE_LABEL = {
  birth: 'Birth',
  marriage: 'Marriage',
  death: 'Death',
  tracking: 'Document Tracking',
};

// null = everything (admin). A Set = only those entities.
export function getAllowedEntities(permissions, isAdmin) {
  if (isAdmin || (Array.isArray(permissions) && permissions.includes('*'))) return null;
  const perms = Array.isArray(permissions) ? permissions : [];
  const allowed = new Set();
  for (const [entity, required] of Object.entries(ENTITY_PERMISSIONS)) {
    if (required.some((p) => perms.includes(p))) allowed.add(entity);
  }
  return allowed;
}

// Empty until PermissionContext loads the login's scope: nothing syncs before that.
let scope = new Set();
let loaded = false;
const listeners = new Set();

function sameScope(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function setSyncScope(allowed) {
  const next = allowed === null ? null : new Set(allowed);
  // Unchanged scope: no notification, so the sync is not restarted.
  if (loaded && sameScope(scope, next)) return;
  scope = next;
  loaded = true;
  listeners.forEach((fn) => fn(scope));
}

export function getSyncScope() {
  return scope;
}

// True once a login's scope (or a logged-out empty scope) has been set at least once.
export function isScopeLoaded() {
  return loaded;
}

// Called whenever the scope really changes. Returns an unsubscribe function.
export function subscribeSyncScope(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isEntityAllowed(entity) {
  return scope === null || scope.has(entity);
}