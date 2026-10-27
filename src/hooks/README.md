# Hooks

## Data refresh
- `useDataChanged(onChange, { tables })`: runs `onChange` when a watched table changes. Fed by `GlobalRealtime`. This is the only realtime hook to use in new code.
- `useRealtimeRefresh`: deprecated. It opens its own channel for each use. Migrate callers to `useDataChanged` and delete the file.

## Connectivity and sync
- `useOnlineStatus`: true when the browser reports online.
- `useSyncStatus`: outbox progress for the sync UI.
- `useHeartbeat`: periodic server check. Confirm it is not duplicated by `connectivityService.js`.

## Other
- `useAnalyticsData`, `useRequestDetail`, `useNotifications`, `useToasts`.

## Rule
- Do not open Supabase channels inside a hook. Realtime goes through `GlobalRealtime`.
