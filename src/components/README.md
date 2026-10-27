# Components

One component per file. CSS lives next to the component it styles.

## Shared UI
- `Sidebar.jsx`, `Topbar.jsx`: app chrome.
- `AccuracyBadge.jsx`: displays a match score. Calculation is in `utils/matchAccuracy.js`.
- `ConnectionStatusBadge.jsx`, `OfflineBanner.jsx`, `LiveIndicator.jsx`: connection and realtime status.
- `ConfirmModal`, `LogoutModal.jsx`, `ProfileModal.jsx`: dialogs.
- `Skeleton.jsx`: loading placeholders (`Skeleton`, `SkeletonTable`).
- `StatusToast.jsx`, `ToastContainer.jsx`: toast display. Push toasts through `services/toastService.js`.
- `NotificationBell.jsx`, `NotificationDetailModal.jsx`: notifications.
- `UserAvatar.jsx`, `ErrorBoundary.jsx`, `SyncStatusPanel.jsx`, `UploadRecordsModal.jsx`.

## Vital records
- `VitalRegistry/`: the single Birth, Death, and Marriage screen. Entity differences live in `VitalRegistry/configs/`. Do not add entity-specific branches to the shared components. Add a config field instead.

## Rules
- Do not add a PDF viewer or certificate printer here. Use `VitalRegistry/` for records, and `utils/pdfUtils.js` for PDF handling.
- If a component has no CSS file, it uses classes from a shared stylesheet. Note which one.
