# Offline layer

## Responsibilities
- `db.js`: IndexedDB setup and store definitions.
- `fileStore.js`: blob storage for queued uploads.
- `outboxQueue.js`: queued writes (`enqueue`, `listByStatus`, `removeOp`).
- `syncEngine.js`: drains the outbox when the server is reachable.
- `archiveLocalStore.js`: record lists in IndexedDB and password metadata.
- `vitalOffline.js`: entity-level offline logic for Birth, Death, and Marriage.
- `connectivityService.js`: browser online state and DB checks for the app shell.
- `archivePassword.js`: offline bcrypt verification helpers.
- `cache.js`: logout cleanup for cached personal data.

## Rule
- `isDbAvailable()` decides whether the offline layer should call the server. `isOnline()` only decides UI banners and the user-facing status. The app must not treat browser connectivity as a server availability signal for offline writes.
