import React, { memo } from "react";
import { useOffline } from "../context/OfflineContext";
import { SYNC_MODULE_LABEL, SYNC_MODULE_PERMISSIONS } from "../offline/syncScope";
import UserAvatar from "./UserAvatar";
import "./Sidebar.css";

// Badge shows up to 99; anything higher reads "99+". The exact count stays in the tooltip.
const formatBadgeCount = (n) => (n > 99 ? "99+" : String(n));

const ACTIVATE_KEYS = new Set(["Enter", " "]);

function MenuIcon({ src, className }) {
  return (
    <img
      src={src}
      alt=""
      className={className ? `menu-icon ${className}` : "menu-icon"}
      width="18"
      height="18"
    />
  );
}

// A keyboard-accessible menu entry. Enter and Space activate it like a click.
function MenuItem({ active = false, className, title, ariaLabel, ariaExpanded, onActivate, children }) {
  const classes = [className, active && "active"].filter(Boolean).join(" ");

  return (
    <li
      role="menuitem"
      tabIndex={0}
      className={classes || undefined}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (ACTIVATE_KEYS.has(e.key)) {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      {children}
    </li>
  );
}

const Sidebar = ({
  activeSubMenu,
  settingsOpen,
  vitalRecordsOpen,
  mobileMenuOpen,
  viewport,
  sidebarCollapsed,
  tabletExpanded,
  showLabels,
  visibleVitalChildren,
  canAccess,
  handleMenuClick,
  handleSubMenuClick,
  setShowLogoutModal,
  displayName,
  avatarSrc,
  onOpenProfile,
  isAdminUser,
  MENU_KEYS,
  VITAL_CHILDREN,
  SETTINGS_CHILDREN,
  logoImg,
  dashboardIcon,
  vitalIcon,
  heatmapsIcon,
  trackingIcon,
  accountIcon,
  logoutIcon,
  syncIcon,
}) => {
  const { moduleCounts } = useOffline();

  const vitalIsActive = VITAL_CHILDREN?.includes(activeSubMenu) ?? false;
  const settingsIsActive = SETTINGS_CHILDREN?.includes(activeSubMenu) ?? false;

  // With labels hidden (collapsed rail), each item still needs an accessible name.
  const srLabel = (text) => (showLabels ? undefined : text);

  const sidebarClasses = [
    "sidebar",
    viewport === "mobile" && mobileMenuOpen ? "mobile-open" : "",
    viewport === "desktop" && sidebarCollapsed ? "collapsed" : "",
    viewport === "tablet" && tabletExpanded ? "tablet-expanded" : "",
    viewport === "tablet" && !tabletExpanded ? "collapsed" : "",
  ].filter(Boolean).join(" ");

  // Per-module breakdown for only the modules this user can access.
  const syncBreakdown = Object.entries(SYNC_MODULE_PERMISSIONS)
    .filter(([, perms]) => perms.some((p) => canAccess(p)))
    .map(([key]) => ({
      key,
      label: SYNC_MODULE_LABEL[key],
      total: moduleCounts?.[key]?.total ?? 0,
    }));

  const syncTotal = syncBreakdown.reduce((sum, m) => sum + m.total, 0);
  const syncTooltip = syncBreakdown.length
    ? syncBreakdown.map((m) => `${m.label}: ${m.total}`).join(" · ")
    : "Nothing to sync";
  const pendingLabel = `${syncTotal} not yet synced (${syncTooltip})`;

  return (
    <aside id="main-sidebar" className={sidebarClasses} aria-label="Main navigation">
      <div className="sidebar-header">
        <img src={logoImg} alt="Local Civil Registry" className="logo-img" width="38" height="38" />
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-title">Local Civil Registry</span>
          <span className="sidebar-brand-subtitle">San Carlos City</span>
        </div>
      </div>

      <div className="sidebar-body">
        <div className="sidebar-user">
          <button
            type="button"
            className="sidebar-user-button"
            onClick={onOpenProfile}
            aria-label={`Edit profile for ${displayName}`}
          >
            <UserAvatar src={avatarSrc} name={displayName} size={56} />
            {showLabels && (
              <>
                <span className="sidebar-user-name">{displayName}</span>
                <span className="sidebar-user-role">
                  {isAdminUser ? "Administrator" : "Active"}
                </span>
              </>
            )}
          </button>
        </div>

        <ul className="sidebar-menu" role="menu">
          <MenuItem
            active={activeSubMenu === MENU_KEYS.DASHBOARD}
            ariaLabel={srLabel("Dashboard")}
            onActivate={() => handleMenuClick(MENU_KEYS.DASHBOARD)}
          >
            <MenuIcon src={dashboardIcon} />
            {showLabels && <span>Dashboard</span>}
          </MenuItem>

          {visibleVitalChildren.length > 0 && (
            <>
              <MenuItem
                className="parent-only"
                active={vitalIsActive}
                ariaLabel={srLabel("Vital Records Management")}
                ariaExpanded={vitalRecordsOpen}
                onActivate={() => handleMenuClick(MENU_KEYS.VITAL)}
              >
                <MenuIcon src={vitalIcon} />
                {showLabels && <span>Vital Records Management</span>}
                {showLabels && <span className={`arrow${vitalRecordsOpen ? " down" : ""}`} />}
              </MenuItem>

              {showLabels && (
                <ul className={`submenu${vitalRecordsOpen ? " open" : ""}`} role="menu">
                  {canAccess("birth_verification") && (
                    <MenuItem
                      active={activeSubMenu === MENU_KEYS.BIRTH}
                      onActivate={() => handleSubMenuClick(MENU_KEYS.BIRTH, MENU_KEYS.VITAL)}
                    >
                      Birth Verifier
                    </MenuItem>
                  )}
                  {canAccess("marriage_verification") && (
                    <MenuItem
                      active={activeSubMenu === MENU_KEYS.MARRIAGE}
                      onActivate={() => handleSubMenuClick(MENU_KEYS.MARRIAGE, MENU_KEYS.VITAL)}
                    >
                      Marriage Verifier
                    </MenuItem>
                  )}
                  {canAccess("death_verification") && (
                    <MenuItem
                      active={activeSubMenu === MENU_KEYS.DEATH}
                      onActivate={() => handleSubMenuClick(MENU_KEYS.DEATH, MENU_KEYS.VITAL)}
                    >
                      Death Verifier
                    </MenuItem>
                  )}
                  {canAccess("scims_lookup") && (
                    <MenuItem
                      active={activeSubMenu === MENU_KEYS.SCIMS}
                      onActivate={() => handleSubMenuClick(MENU_KEYS.SCIMS, MENU_KEYS.VITAL)}
                    >
                      SCIMS Lookup
                    </MenuItem>
                  )}
                </ul>
              )}
            </>
          )}

          {canAccess("heatmaps") && (
            <MenuItem
              active={activeSubMenu === MENU_KEYS.HEATMAPS}
              ariaLabel={srLabel("Heatmaps")}
              onActivate={() => handleMenuClick(MENU_KEYS.HEATMAPS)}
            >
              <MenuIcon src={heatmapsIcon} />
              {showLabels && <span>Heatmaps</span>}
            </MenuItem>
          )}

          {canAccess("document_tracking") && (
            <MenuItem
              active={activeSubMenu === MENU_KEYS.DOCUMENT_TRACKING}
              ariaLabel={srLabel("Document Tracking")}
              onActivate={() => handleMenuClick(MENU_KEYS.DOCUMENT_TRACKING)}
            >
              <MenuIcon src={trackingIcon} />
              {showLabels && <span>Document Tracking</span>}
            </MenuItem>
          )}

          {canAccess("offline_sync") && (
            <MenuItem
              active={activeSubMenu === MENU_KEYS.OFFLINE_SYNC}
              title={pendingLabel}
              ariaLabel={srLabel("Offline Data & Sync")}
              onActivate={() => handleMenuClick(MENU_KEYS.OFFLINE_SYNC)}
            >
              <MenuIcon src={syncIcon} className="menu-icon--sync" />
              {showLabels && <span>Offline Data &amp; Sync</span>}
              {showLabels && syncTotal > 0 && (
                <span className="sync-badge">{formatBadgeCount(syncTotal)}</span>
              )}
            </MenuItem>
          )}

          <MenuItem
            className="parent-only"
            active={settingsIsActive}
            ariaLabel={srLabel("System Settings")}
            ariaExpanded={settingsOpen}
            onActivate={() => handleMenuClick(MENU_KEYS.SETTINGS)}
          >
            <MenuIcon src={accountIcon} />
            {showLabels && <span>System Settings</span>}
            {showLabels && <span className={`arrow${settingsOpen ? " down" : ""}`} />}
          </MenuItem>

          {showLabels && (
            <ul className={`submenu${settingsOpen ? " open" : ""}`} role="menu">
              <MenuItem
                active={activeSubMenu === MENU_KEYS.ACCOUNT}
                onActivate={() => handleSubMenuClick(MENU_KEYS.ACCOUNT, MENU_KEYS.SETTINGS)}
              >
                Update Account
              </MenuItem>
              {canAccess("audit_logs") && (
                <MenuItem
                  active={activeSubMenu === MENU_KEYS.AUDIT}
                  onActivate={() => handleSubMenuClick(MENU_KEYS.AUDIT, MENU_KEYS.SETTINGS)}
                >
                  Audit Logs
                </MenuItem>
              )}
              {canAccess("role_management") && (
                <MenuItem
                  active={activeSubMenu === MENU_KEYS.ROLE_MANAGEMENT}
                  onActivate={() => handleSubMenuClick(MENU_KEYS.ROLE_MANAGEMENT, MENU_KEYS.SETTINGS)}
                >
                  Role Management
                </MenuItem>
              )}
              <MenuItem
                active={activeSubMenu === MENU_KEYS.DISPLAY}
                onActivate={() => handleSubMenuClick(MENU_KEYS.DISPLAY, MENU_KEYS.SETTINGS)}
              >
                Display
              </MenuItem>
            </ul>
          )}
        </ul>

        <div className="sidebar-footer">
          <button
            className="footer-item"
            onClick={() => setShowLogoutModal(true)}
            type="button"
            aria-label={srLabel("Logout")}
          >
            <img src={logoutIcon} alt="" className="menu-icon" width="18" height="18" />
            {showLabels && <span>Logout</span>}
          </button>
        </div>
      </div>
    </aside>
  );
};

export default memo(Sidebar);