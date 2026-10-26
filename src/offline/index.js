// src/offline/index.js
export * from './db';
export * from './connectivityService';
export * from './outboxQueue';
export * from './syncEngine';
export * from './conflictResolver';
export * from './storagePersistence';
export * from './fileStore';
export * from './offlineRepository';

// Ask the browser to keep offline data (IndexedDB, files) instead of evicting it
// under storage pressure. Safe to call more than once.
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}