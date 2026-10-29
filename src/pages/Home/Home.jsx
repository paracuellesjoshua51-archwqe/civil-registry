import { Suspense, lazy, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AccessDenied from "../Auth/AccessDenied";
const ChangePassword = lazy(() => import("../AccountSettings/ChangePassword"));
const AuditLogs = lazy(() => import("../AccountSettings/AuditLogs"));
const RoleManagement = lazy(() => import("../AccountSettings/RoleManagement"));
const DisplaySettings = lazy(() => import("../AccountSettings/Settings"));
const UnifiedBirthRegistry = lazy(() => import("../VitalRecords/Birth/BirthVerifier"));
const UnifiedMarriageRegistry = lazy(() => import("../VitalRecords/Marriage/MarriageVerifier"));
const DeathVerifier = lazy(() => import("../VitalRecords/Death/DeathVerifier"));
const PaymentInventory = lazy(() => import("../Dashboard/Dashboard"));
const Heatmaps = lazy(() => import("../Heatmaps/Heatmaps"));
const ExternalIndividualsLookup = lazy(() => import("../ExternalIndividuals/ExternalIndividualsLookup"));
const DocumentTracking = lazy(() => import("../DocumentTracking/DocumentTracking"));
const SyncCenter = lazy(() => import("../SyncCenter/SyncCenter"));

import { usePermissions } from "../../context/PermissionContext";
import { useOffline } from "../../context/OfflineContext";

import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import LogoutModal from "../../components/LogoutModal";
import NotificationBell from "../../components/NotificationBell";
import NotificationDetailModal from "../../components/NotificationDetailModal";
import ProfileModal from "../../components/ProfileModal";
import useNotifications from "../../hooks/useNotifications";
import { loadSnapshot, prefetchRequestSnapshot, recordSavedStatus } from "../../hooks/useRequestDetail";
import { fetchSnapshot, saveRequestStatus } from "../../services/requestSnapshotService";
import { pushToast } from "../../services/toastService";
import { avatarUrl, fetchProfile } from "../../services/profileService";

import dashboardIcon from "../../assets/icons/sidebar/dashboard.png";
import vitalIcon from "../../assets/icons/sidebar/vital.png";
import heatmapsIcon from "../../assets/icons/sidebar/heatmap.png";
import trackingIcon from "../../assets/icons/sidebar/tracking.png";
import accountIcon from "../../assets/icons/sidebar/account.png";
import logoutIcon from "../../assets/icons/sidebar/logout.png";
import syncIcon from "../../assets/icons/sidebar/sync.png";

const logoImg = "/scc.png";


const MENU_KEYS = {
  DASHBOARD:         "Dashboard",
  VITAL:             "Vital Records Management",
  HEATMAPS:          "Heatmaps",
  DOCUMENT_TRACKING: "Document Tracking",
  SETTINGS:          "System Settings",
  BIRTH:             "Birth Verifier",
  MARRIAGE:          "Marriage Verifier",
  DEATH:             "Death Verifier",
  SCIMS:             "SCIMS Lookup",
  ACCOUNT:           "Update Account",
  AUDIT:             "Audit Logs",
  ROLE_MANAGEMENT:   "Role Management",
  DISPLAY:           "Display Settings",
  OFFLINE_SYNC:      "Offline Data & Sync",
};

const VITAL_CHILDREN    = [MENU_KEYS.BIRTH, MENU_KEYS.MARRIAGE, MENU_KEYS.DEATH, MENU_KEYS.SCIMS];
const SETTINGS_CHILDREN = [MENU_KEYS.ACCOUNT, MENU_KEYS.AUDIT, MENU_KEYS.ROLE_MANAGEMENT, MENU_KEYS.DISPLAY];

// ROUTING: each page has its own URL. The URL is the source of truth for
// which page is active.
const MENU_ROUTES = {
  [MENU_KEYS.DASHBOARD]:         "/dashboard",
  [MENU_KEYS.BIRTH]:             "/vital-records/birth",
  [MENU_KEYS.MARRIAGE]:          "/vital-records/marriage",
  [MENU_KEYS.DEATH]:             "/vital-records/death",
  [MENU_KEYS.SCIMS]:             "/vital-records/scims-lookup",
  [MENU_KEYS.HEATMAPS]:          "/heatmaps",
  [MENU_KEYS.DOCUMENT_TRACKING]: "/document-tracking",
  [MENU_KEYS.ACCOUNT]:           "/settings/update-account",
  [MENU_KEYS.AUDIT]:             "/settings/audit-logs",
  [MENU_KEYS.ROLE_MANAGEMENT]:   "/settings/role-management",
  [MENU_KEYS.DISPLAY]:           "/settings/display",
  [MENU_KEYS.OFFLINE_SYNC]:      "/offline-sync",
};

const ROUTE_TO_MENU = Object.fromEntries(
  Object.entries(MENU_ROUTES).map(([menu, path]) => [path, menu])
);

const BP_TABLET_MAX = 1024;
const BP_MOBILE_MAX = 767;

const SESSION_FLAG_KEY = "homeSessionActive";

const NOTIF_TARGETS = {
  birth:    { menu: MENU_KEYS.BIRTH,    permission: "birth_verification" },
  marriage: { menu: MENU_KEYS.MARRIAGE, permission: "marriage_verification" },
  death:    { menu: MENU_KEYS.DEATH,    permission: "death_verification" },
};

const NOTIF_TYPE_KEYS = Object.keys(NOTIF_TARGETS);

// REJECTED is selectable too (the backend requires a remark for it).
const REQUEST_STATUS_OPTIONS = ["PENDING", "PROCESSING", "COMPLETED", "REJECTED"];
const REQUEST_STATUS_LABELS = {
  PENDING:    "Pending Review",
  PROCESSING: "Being Processed",
  COMPLETED:  "Completed",
  REJECTED:   "Rejected",
};

const TYPE_SECTIONS = {
  birth: {
    title: "Child's information",
    fields: [
      ["child_firstname",  "First name"],
      ["child_middlename", "Middle name"],
      ["child_surname",    "Surname"],
      ["birth_month",      "Birth month"],
      ["birth_date",       "Birth day"],
      ["birth_year",       "Birth year"],
      ["place_of_birth",   "Place of birth"],
    ],
  },
  death: {
    title: "Deceased's information",
    fields: [
      ["deceased_firstname",  "First name"],
      ["deceased_middlename", "Middle name"],
      ["deceased_surname",    "Surname"],
      ["death_month",         "Death month"],
      ["death_date",          "Death day"],
      ["death_year",          "Death year"],
      ["place_of_death",      "Place of death"],
    ],
  },
  marriage: {
    title: "Marriage information",
    fields: [
      ["husband_fullname",  "Husband's full name"],
      ["wife_maiden_name",  "Wife's maiden name"],
      ["marriage_date",     "Date of marriage"],
      ["place_of_marriage", "Place of marriage"],
    ],
  },
};

const COMMON_SECTIONS = [
  {
    title: "Request details",
    fields: [
      ["form_type",  "Form type"],
      ["num_copies", "Number of copies"],
      ["purposes",   "Purpose"],
      ["search_by",  "Search by"],
    ],
  },
  {
    title: "Requester",
    fields: [
      ["requester_name",         "Name"],
      ["requester_relationship", "Relationship to owner"],
      ["requester_address",      "Address"],
      ["requester_telephone",    "Telephone"],
      ["requester_email",        "Email"],
      ["signature_printed_name", "Signature over printed name"],
    ],
  },
  {
    title: "Registry reference",
    fields: [
      ["registry_no",          "Registry no."],
      ["date_of_registration", "Date of registration"],
      ["book",                 "Book"],
      ["page",                 "Page"],
    ],
  },
];

const SIGNATURE_FIELD_KEY = "signature_printed_name";

const SIGNATURE_BASE64_KEYS = [
  "signature_base64",
  "signature_image",
  "signature_image_base64",
  "signature_data_url",
  "signature",
];

// Served by the session-gated backend on the same origin, so the login cookie is sent automatically.
const getSignatureSrc = (snap, _type, recordId) => {
  for (const key of SIGNATURE_BASE64_KEYS) {
    const val = snap?.[key];
    if (typeof val === "string" && val.trim()) {
      return val.startsWith("data:") ? val : `data:image/png;base64,${val}`;
    }
  }
  return `/api/requests/${recordId}/signature`;
};

const getViewport = () => {
  const w = window.innerWidth;
  if (w <= BP_MOBILE_MAX) return "mobile";
  if (w <= BP_TABLET_MAX) return "tablet";
  return "desktop";
};

const toTitleCase = (str = "") => str.replace(/\b\w/g, (c) => c.toUpperCase());

const getStoredUsername = () => {
  try { return sessionStorage.getItem("username") || ""; }
  catch { return ""; }
};

const getPersistedSubmenuState = (key) => {
  try {
    const sameSession = sessionStorage.getItem(SESSION_FLAG_KEY) === "true";
    return sameSession && localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
};

const Home = () => {
  const { hasAccess, is_admin: isAdminUser, loading, logout } = usePermissions();
  const username = getStoredUsername();
  const offline = useOffline();

  const canAccess = useCallback(
    (mod) => {
      if (isAdminUser) return true;
      try { return !!hasAccess(mod); }
      catch { return false; }
    },
    [isAdminUser, hasAccess]
  );

  // Document types this user is assigned, from their verifier permissions.
  // Admins get all types. Document Tracking personnel have none, so they
  // receive no notifications. While permissions load this is empty.
  const allowedTypes = useMemo(
    () => (loading ? [] : NOTIF_TYPE_KEYS.filter((t) => canAccess(NOTIF_TARGETS[t].permission))),
    [loading, canAccess]
  );

  // ROUTING: the URL is now the single source of truth for the active page.
  const navigate = useNavigate();
  const location = useLocation();

  const currentPath = location.pathname.replace(/\/+$/, "").toLowerCase() || "/";
  const activeSubMenu = ROUTE_TO_MENU[currentPath] || MENU_KEYS.DASHBOARD;
  // "archive" | null. Carried in the navigation state so it survives refresh.
  const verifierEntry = location.state?.verifierEntry ?? null;

  const goTo = useCallback((menu, state) => {
    const path = MENU_ROUTES[menu];
    if (!path) return;
    navigate(path, state ? { state } : undefined);
  }, [navigate]);

  const [settingsOpen, setSettingsOpen] = useState(() => getPersistedSubmenuState("settingsOpen"));
  const [vitalRecordsOpen, setVitalRecordsOpen] = useState(() => getPersistedSubmenuState("vitalRecordsOpen"));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [viewport, setViewport] = useState(getViewport);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebarCollapsed") === "true"; }
    catch { return false; }
  });
  const [tabletExpanded, setTabletExpanded] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Profile (display name + picture) is owned here so the sidebar and the
  // edit modal always read the same copy.
  const [profile, setProfile] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const {
    notifOpen,
    setNotifOpen,
    notifications,
    setNotifications,
    unreadCount,
    notifLoading,
    notifStatus,
    openActionMenuId,
    notifWrapperRef,
    toggleActionMenu,
    toggleNotifDropdown,
    markNotificationRead,
    markNotificationUnread,
    markAllNotificationsRead,
    markNotificationClicked,
    deleteNotification,
    timeAgo,
    setOpenActionMenuId,
  } = useNotifications({
    username,
    allowedTypes,
    onOpenVerifier: null,
  });

  const [selectedNotif, setSelectedNotif] = useState(null);
  const [sigFailed, setSigFailed]         = useState(false);
  const [sigZoomed, setSigZoomed]         = useState(false);
  const [statusDraft, setStatusDraft]     = useState("");
  const [statusNote, setStatusNote]       = useState("");
  const [statusSaving, setStatusSaving]   = useState(false);
  const [notifyVia, setNotifyVia]         = useState("email");

  // Full request row fetched from the session-gated backend. Kept in
  // its own state (NOT merged into the notification / snapshot that is
  // stored in the database) so requester details are never written back
  // to the `notification` table.
  const [requestDetail, setRequestDetail] = useState(null); // { notifId, data }
  const activeNotifIdRef = useRef(null);

  const showStatusToast = useCallback((title, message, type = "success") => {
    pushToast({ title, message, type, presentation: "status", duration: 5000 });
  }, []);

  const visibleVitalChildren = useMemo(
    () => isAdminUser
      ? VITAL_CHILDREN
      : [
          ...(canAccess("birth_verification")    ? [MENU_KEYS.BIRTH]    : []),
          ...(canAccess("marriage_verification") ? [MENU_KEYS.MARRIAGE] : []),
          ...(canAccess("death_verification")    ? [MENU_KEYS.DEATH]    : []),
          ...(canAccess("scims_lookup")          ? [MENU_KEYS.SCIMS]    : []),
        ],
    [isAdminUser, canAccess]
  );

  // Load the profile once so the sidebar shows the saved name and picture.
  // Load the profile on mount, and again whenever the window regains focus,
  // so a name or picture changed in another window shows up here.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchProfile()
        .then((data) => {
          if (!cancelled) setProfile(data);
        })
        .catch((err) => console.error("[Home] Could not load profile:", err));
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, []);

  // ROUTING: unknown URL under /dashboard -> go to the dashboard.
  useEffect(() => {
    if (!ROUTE_TO_MENU[currentPath]) {
      navigate(MENU_ROUTES[MENU_KEYS.DASHBOARD], { replace: true });
    }
  }, [currentPath, navigate]);

  // ROUTING: keep the parent submenu open when the URL points at a child
  // (also covers refresh / direct links).
  useEffect(() => {
    if (VITAL_CHILDREN.includes(activeSubMenu)) {
      setVitalRecordsOpen(true);
      try { localStorage.setItem("vitalRecordsOpen", "true"); } catch { /* ignore: storage unavailable (e.g. private mode) */ }
    } else if (SETTINGS_CHILDREN.includes(activeSubMenu)) {
      setSettingsOpen(true);
      try { localStorage.setItem("settingsOpen", "true"); } catch { /* ignore: storage unavailable (e.g. private mode) */ }
    }
  }, [activeSubMenu]);

  useEffect(() => {
    try { sessionStorage.setItem(SESSION_FLAG_KEY, "true"); } catch { /* ignore: storage unavailable (e.g. private mode) */ }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const vp = getViewport();
      setViewport(vp);
      if (vp !== "mobile") setMobileMenuOpen(false);
      if (vp !== "tablet") setTabletExpanded(false);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    document.body.style.overflow = viewport === "mobile" && mobileMenuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [viewport, mobileMenuOpen]);

  // Only notifications created from the public request website carry
  // source === "online_request". For any other notification, record_id
  // points at a different table, so it must NOT be looked up in
  // civil_registry_request or have its status edited.
  const isOnlineRequest = selectedNotif?.request_snapshot?.source === "online_request";

  // The notification the modal displays = stored notification + live row.
  const modalNotification = useMemo(() => {
    if (!selectedNotif) return null;
    const detail = requestDetail?.notifId === selectedNotif.id ? requestDetail.data : null;
    if (!detail) return selectedNotif;
    return {
      ...selectedNotif,
      request_snapshot: { ...(selectedNotif.request_snapshot || {}), ...detail },
    };
  }, [selectedNotif, requestDetail]);

  // Warm the cache before the click lands (hover / focus / touch in the bell).
  // Only online requests have a live row to fetch.
  const handlePrefetchNotification = useCallback((notif) => {
    if (notif?.request_snapshot?.source === "online_request") {
      prefetchRequestSnapshot(notif, fetchSnapshot);
    }
  }, []);

  const handleNotifClick = useCallback((notif) => {
    markNotificationClicked(notif.id);
    setSigFailed(false);
    setSigZoomed(false);
    setSelectedNotif(notif);
    setNotifOpen(false);
    setStatusNote("");
    setRequestDetail(null);
    // Don't seed the status from the stored (possibly stale) snapshot.
    // The modal shows a skeleton until the live row is ready, then syncs it.
    setStatusDraft("");
    activeNotifIdRef.current = notif.id;

    const snap = notif.request_snapshot || {};
    setNotifyVia((snap.requester_email || "").trim() ? "email" : "none");

    if (!notif.record_id || snap.source !== "online_request") return;

    // Shares the cache + in-flight request with the modal (and with the hover
    // prefetch), so this does NOT cause a second network call.
    loadSnapshot(notif, fetchSnapshot)
      .then((data) => {
        if (activeNotifIdRef.current !== notif.id) return;

        setRequestDetail({ notifId: notif.id, data });

        // Default to emailing the citizen whenever an address is on file.
        setNotifyVia((data.requester_email || "").trim() ? "email" : "none");

        const liveStatus = (data.status || "").toUpperCase();
        if (liveStatus) {
          setStatusDraft(liveStatus);
          setNotifications((prev) =>
            prev.map((n) =>
              n.id === notif.id
                ? {
                    ...n,
                    request_status: liveStatus,
                    request_snapshot: { ...(n.request_snapshot || {}), status: liveStatus },
                  }
                : n
            )
          );
        }
      })
      .catch((err) => {
        console.error("[Home] Could not load request details:", err);
      });
  }, [markNotificationClicked, setNotifOpen, setNotifications]);

  const closeNotifDetails = useCallback(() => {
    activeNotifIdRef.current = null;
    setSelectedNotif(null);
    setRequestDetail(null);
    setSigZoomed(false);
    setStatusDraft("");
    setStatusNote("");
    setNotifyVia("email");
  }, []);

  const updateRequestStatus = async () => {
    if (!selectedNotif?.record_id || !isOnlineRequest) return;
    setStatusSaving(true);
    try {
      const data = await saveRequestStatus(selectedNotif, statusDraft, {
        note: statusNote.trim(),
        notifyVia,
      });

      const savedStatus = (data.status || statusDraft).toUpperCase();

      // Store the confirmed status so every later read of this request shows it.
      recordSavedStatus(selectedNotif, savedStatus, data.updated_at);

      // Update the bell pill right away instead of waiting for the next poll.
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === selectedNotif.id ? { ...n, request_status: savedStatus } : n
        )
      );

      const statusLabel = REQUEST_STATUS_LABELS[savedStatus] || savedStatus;
      showStatusToast("Success", `Status updated to ${statusLabel}`, "success");

      if (data.email_attempted && !data.email_sent) {
        showStatusToast(
          "Notice",
          "The email notification could not be sent. Check server logs.",
          "warning"
        );
      }

      setStatusDraft(savedStatus);
      setStatusNote("");

      setRequestDetail((prev) =>
        prev && prev.notifId === selectedNotif.id
          ? { ...prev, data: { ...prev.data, status: savedStatus, updated_at: data.updated_at ?? prev.data.updated_at } }
          : prev
      );
      setSelectedNotif((prev) =>
        prev ? { ...prev, request_snapshot: { ...(prev.request_snapshot || {}), status: savedStatus } } : prev
      );
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === selectedNotif.id
            ? { ...n, request_snapshot: { ...(n.request_snapshot || {}), status: savedStatus } }
            : n
        )
      );
    } catch (err) {
      showStatusToast("Error", err.message || "Could not update status.", "error");
    } finally {
      setStatusSaving(false);
    }
  };

  const openRecordPage = useCallback(
    (type) => {
      const target = NOTIF_TARGETS[type];
      if (!target || !canAccess(target.permission)) return;
      goTo(target.menu, { verifierEntry: "archive" });
      setVitalRecordsOpen(true);
      try { localStorage.setItem("vitalRecordsOpen", "true"); } catch { /* ignore: storage unavailable (e.g. private mode) */ }
      if (viewport === "mobile") setMobileMenuOpen(false);
    },
    [canAccess, viewport, goTo]
  );

  const recordLinks = {
    birth:    canAccess("birth_verification")    ? () => openRecordPage("birth")    : null,
    marriage: canAccess("marriage_verification") ? () => openRecordPage("marriage") : null,
    death:    canAccess("death_verification")    ? () => openRecordPage("death")    : null,
  };

  useEffect(() => {
    if (!selectedNotif) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (sigZoomed) setSigZoomed(false);
      else closeNotifDetails();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedNotif, sigZoomed, closeNotifDetails]);

  const toggleSidebar = useCallback(() => {
    if (viewport === "mobile") {
      setMobileMenuOpen((p) => !p);
    } else if (viewport === "tablet") {
      setTabletExpanded((p) => !p);
    } else {
      setSidebarCollapsed((p) => {
        const next = !p;
        localStorage.setItem("sidebarCollapsed", String(next));
        return next;
      });
    }
  }, [viewport]);

  const closeMobileMenu = useCallback(() => {
    if (viewport === "mobile") setMobileMenuOpen(false);
  }, [viewport]);

  const handleMenuClick = useCallback((menu) => {
    if (menu === MENU_KEYS.VITAL) {
      setVitalRecordsOpen((prev) => {
        const next = !prev;
        localStorage.setItem("vitalRecordsOpen", String(next));
        return next;
      });
      return;
    }
    if (menu === MENU_KEYS.SETTINGS) {
      setSettingsOpen((prev) => {
        const next = !prev;
        localStorage.setItem("settingsOpen", String(next));
        return next;
      });
      return;
    }
    goTo(menu);
    closeMobileMenu();
  }, [closeMobileMenu, goTo]);

  const handleSubMenuClick = useCallback((submenu, parent) => {
    goTo(submenu);
    if (parent === MENU_KEYS.VITAL) {
      setVitalRecordsOpen(true);
      localStorage.setItem("vitalRecordsOpen", "true");
    }
    if (parent === MENU_KEYS.SETTINGS) {
      setSettingsOpen(true);
      localStorage.setItem("settingsOpen", "true");
    }
    closeMobileMenu();
  }, [closeMobileMenu, goTo]);

  const handleConfirmLogout = async () => {
    setLoggingOut(true);
    try {
      const loggedOut = await logout();
      if (loggedOut === false) {
        setLoggingOut(false);
        return;
      }
    } catch (err) {
      console.error("[Home] logout was cancelled because pending offline changes could not be checked:", err);
      setLoggingOut(false);
      return;
    }
    sessionStorage.clear();
    localStorage.removeItem("vitalRecordsOpen");
    localStorage.removeItem("settingsOpen");
    window.location.replace("/");
  };

  const showLabels =
    viewport === "mobile" ||
    (viewport === "tablet"  && tabletExpanded) ||
    (viewport === "desktop" && !sidebarCollapsed);

  const containerClasses = [
    "dashboard-container",
    viewport === "desktop" && sidebarCollapsed ? "sidebar-is-collapsed"       : "",
    viewport === "tablet"  && tabletExpanded   ? "sidebar-is-tablet-expanded" : "",
    viewport === "tablet"  && !tabletExpanded  ? "sidebar-is-collapsed"       : "",
  ].filter(Boolean).join(" ");

  const avatarSrc = avatarUrl(profile);
  const displayName = profile?.display_name || (username ? toTitleCase(username) : "Admin");

  const renderContent = () => {
    if (loading) {
      return (
        <div className="module-loading-state" style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
          Loading…
        </div>
      );
    }

    switch (activeSubMenu) {
      case MENU_KEYS.HEATMAPS:
        return canAccess("heatmaps") ? <Heatmaps /> : <AccessDenied />;
      case MENU_KEYS.DOCUMENT_TRACKING:
        return canAccess("document_tracking") ? <DocumentTracking /> : <AccessDenied />;
      case MENU_KEYS.ACCOUNT:
        return <ChangePassword />;
      case MENU_KEYS.DISPLAY:
        return <DisplaySettings />;
      case MENU_KEYS.BIRTH:
        return canAccess("birth_verification") ? <UnifiedBirthRegistry initialView={verifierEntry} /> : <AccessDenied />;
      case MENU_KEYS.MARRIAGE:
        return canAccess("marriage_verification") ? <UnifiedMarriageRegistry initialView={verifierEntry} /> : <AccessDenied />;
      case MENU_KEYS.DEATH:
        return canAccess("death_verification") ? <DeathVerifier initialView={verifierEntry} /> : <AccessDenied />;
      case MENU_KEYS.SCIMS:
        return canAccess("scims_lookup") ? <ExternalIndividualsLookup /> : <AccessDenied />;
      case MENU_KEYS.AUDIT:
        return canAccess("audit_logs") ? <AuditLogs /> : <AccessDenied />;
      case MENU_KEYS.ROLE_MANAGEMENT:
        return canAccess("role_management") ? <RoleManagement /> : <AccessDenied />;
      case MENU_KEYS.OFFLINE_SYNC:
        return canAccess("offline_sync") ? <SyncCenter /> : <AccessDenied />;
      case MENU_KEYS.DASHBOARD:
      default:
        return <PaymentInventory recordLinks={recordLinks} />;
    }
  };

  return (
    <div className={containerClasses}>
      <button
        type="button"
        className={`mobile-menu-toggle${mobileMenuOpen ? " active" : ""}`}
        aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
        aria-expanded={mobileMenuOpen}
        aria-controls="main-sidebar"
        onClick={() => setMobileMenuOpen((p) => !p)}
      >
        <span />
        <span />
        <span />
      </button>

      <div
        className={`mobile-overlay${mobileMenuOpen ? " active" : ""}`}
        onClick={closeMobileMenu}
        aria-hidden="true"
      />

      <Sidebar
        activeSubMenu={activeSubMenu}
        settingsOpen={settingsOpen}
        vitalRecordsOpen={vitalRecordsOpen}
        mobileMenuOpen={mobileMenuOpen}
        viewport={viewport}
        sidebarCollapsed={sidebarCollapsed}
        tabletExpanded={tabletExpanded}
        showLabels={showLabels}
        visibleVitalChildren={visibleVitalChildren}
        canAccess={canAccess}
        handleMenuClick={handleMenuClick}
        handleSubMenuClick={handleSubMenuClick}
        setShowLogoutModal={setShowLogoutModal}
        displayName={displayName}
        avatarSrc={avatarSrc}
        onOpenProfile={() => setProfileOpen(true)}
        isAdminUser={isAdminUser}
        MENU_KEYS={MENU_KEYS}
        VITAL_CHILDREN={VITAL_CHILDREN}
        SETTINGS_CHILDREN={SETTINGS_CHILDREN}
        logoImg={logoImg}
        dashboardIcon={dashboardIcon}
        vitalIcon={vitalIcon}
        heatmapsIcon={heatmapsIcon}
        trackingIcon={trackingIcon}
        accountIcon={accountIcon}
        logoutIcon={logoutIcon}
        syncIcon={syncIcon}
        offlinePendingCount={offline.counts.pending}
      />

      <div className="main-content-wrapper">
        <Topbar activeSubMenu={activeSubMenu} toggleSidebar={toggleSidebar}>
          {(isAdminUser || allowedTypes.length > 0) && (
            <NotificationBell
              notifOpen={notifOpen}
              notifWrapperRef={notifWrapperRef}
              toggleNotifDropdown={toggleNotifDropdown}
              unreadCount={unreadCount}
              notifStatus={notifStatus}
              notifLoading={notifLoading}
              notifications={notifications}
              openActionMenuId={openActionMenuId}
              toggleActionMenu={toggleActionMenu}
              markAllNotificationsRead={markAllNotificationsRead}
              markNotificationRead={markNotificationRead}
              markNotificationUnread={markNotificationUnread}
              deleteNotification={deleteNotification}
              handleNotifClick={handleNotifClick}
              timeAgo={timeAgo}
              NOTIF_TARGETS={NOTIF_TARGETS}
              setOpenActionMenuId={setOpenActionMenuId}
              onPrefetchNotification={handlePrefetchNotification}
            />
          )}
        </Topbar>

        <main className="main-content">
          <Suspense fallback={null}>
            {renderContent()}
          </Suspense>
        </main>
      </div>

      <NotificationDetailModal
        notification={modalNotification}
        isOnlineRequest={isOnlineRequest}
        onClose={closeNotifDetails}
        canAccess={canAccess}
        timeAgo={timeAgo}
        sigFailed={sigFailed}
        setSigFailed={setSigFailed}
        sigZoomed={sigZoomed}
        setSigZoomed={setSigZoomed}
        statusDraft={statusDraft}
        setStatusDraft={setStatusDraft}
        statusNote={statusNote}
        setStatusNote={setStatusNote}
        statusSaving={statusSaving}
        updateRequestStatus={updateRequestStatus}
        notifyVia={notifyVia}
        setNotifyVia={setNotifyVia}
        NOTIF_TARGETS={NOTIF_TARGETS}
        TYPE_SECTIONS={TYPE_SECTIONS}
        COMMON_SECTIONS={COMMON_SECTIONS}
        SIGNATURE_FIELD_KEY={SIGNATURE_FIELD_KEY}
        getSignatureSrc={getSignatureSrc}
        REQUEST_STATUS_OPTIONS={REQUEST_STATUS_OPTIONS}
        REQUEST_STATUS_LABELS={REQUEST_STATUS_LABELS}
        fetchSnapshot={fetchSnapshot}
      />

      <ProfileModal
        open={profileOpen}
        username={username}
        profile={profile}
        onProfileChange={setProfile}
        onClose={() => setProfileOpen(false)}
      />

      <LogoutModal
        open={showLogoutModal}
        loggingOut={loggingOut}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={handleConfirmLogout}
      />
    </div>
  );
};

export default Home;