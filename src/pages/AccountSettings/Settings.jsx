/* global __APP_VERSION__ */
import { useEffect, useState } from "react";
import "./Settings.css";
import {
  ZOOM_OPTIONS,
  THEME_OPTIONS,
  DEFAULT_PREFS,
  loadDisplayPrefs,
  saveDisplayPrefs,
  applyDisplayPrefs,
} from "../../utils/displayPrefs";

const TABS = [
  { key: "display", label: "Display", desc: "Full screen and window" },
  { key: "about", label: "About", desc: "App version and requirements" },
];

// Update these values after testing on the actual machine.
const SYSTEM_REQUIREMENTS = [
  { label: "Operating system", value: "Windows 10 or later", key: "os" },
  { label: "Python", value: "3.13", key: null },
  { label: "Minimum RAM", value: "4 GB", minRamGb: 4 },
  { label: "Recommended RAM", value: "8 GB", minRamGb: 8 },
  { label: "Storage", value: "64 GB free + space for uploads", key: null },
  { label: "Screen", value: "1366 x 768 or higher", minW: 1366, minH: 768 },
  { label: "Internet", value: "Required for login and sync", key: "net" },
];

const SHORTCUTS = [
  { keys: "F11", action: "Toggle full screen" },
  { keys: "Esc", action: "Exit full screen" },
];

const isDesktopApp = () =>
  typeof window !== "undefined" && !!window.desktop;

// Label shown for where the app runs.
const environmentLabel = (isDesktop) =>
  isDesktop ? "Desktop App (Electron)" : "Web Application";

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return "Unknown";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

/* ── Display ─────────────────────────────────────────────── */
function DisplayPanel() {
  const [isDesktop] = useState(isDesktopApp);
  const [isFull, setIsFull] = useState(false);
  const [prefs, setPrefs] = useState(loadDisplayPrefs);

  useEffect(() => {
    if (!isDesktop || typeof window.desktop.isFullscreen !== "function") {
      return undefined;
    }

    let active = true;
    window.desktop
      .isFullscreen()
      .then((v) => { if (active) setIsFull(!!v); })
      .catch((err) => console.error("[Settings] isFullscreen failed:", err));

    const unsubscribe = window.desktop.onFullscreenChange?.((v) => setIsFull(!!v));

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [isDesktop]);

  const canToggle = isDesktop && typeof window.desktop.toggleFullscreen === "function";

  const handleToggle = () => {
    window.desktop.toggleFullscreen().catch((err) =>
      console.error("[Settings] toggleFullscreen failed:", err)
    );
  };

  const updatePref = (patch) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveDisplayPrefs(next);
    applyDisplayPrefs(next);
  };

  const resetPrefs = () => {
    const next = { ...DEFAULT_PREFS };
    setPrefs(next);
    saveDisplayPrefs(next);
    applyDisplayPrefs(next);
  };

  return (
    <div className="st-section-group">
      {/* Full screen */}
      <section className="st-section">
        <h2 className="st-section-title">Full screen</h2>

        {canToggle ? (
          <>
            <p className="st-section-desc">
              Press F11 to toggle full screen, or Esc to exit.
            </p>
            <button
              type="button"
              className="st-btn st-btn--primary"
              onClick={handleToggle}
            >
              {isFull ? "Exit full screen" : "Enter full screen"}
            </button>
          </>
        ) : (
          <p className="st-note">
            Available in the desktop app only. Full screen can't be changed in the browser.
          </p>
        )}
      </section>

      {/* Theme */}
      <section className="st-section">
        <h2 className="st-section-title">Theme</h2>
        <p className="st-section-desc">
          Choose light or dark appearance. System follows your Windows setting.
        </p>
        <div className="st-segmented" role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={prefs.theme === opt.value}
              className={`st-seg${prefs.theme === opt.value ? " active" : ""}`}
              onClick={() => updatePref({ theme: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* Text size */}
      <section className="st-section">
        <h2 className="st-section-title">Text size</h2>
        <p className="st-section-desc">
          Scales the whole interface. Useful for small monitors or easier reading.
        </p>
        <div className="st-segmented" role="radiogroup" aria-label="Text size">
          {ZOOM_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={prefs.zoom === opt.value}
              className={`st-seg${prefs.zoom === opt.value ? " active" : ""}`}
              onClick={() => updatePref({ zoom: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* High contrast */}
      <section className="st-section">
        <h2 className="st-section-title">High contrast</h2>
        <div className="st-toggle-row">
          <p className="st-section-desc">
            Stronger borders and text for better legibility.
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.highContrast}
            className={`st-switch${prefs.highContrast ? " on" : ""}`}
            onClick={() => updatePref({ highContrast: !prefs.highContrast })}
          >
            <span className="st-switch-knob" />
          </button>
        </div>
      </section>

      {/* Shortcuts */}
      <section className="st-section">
        <h2 className="st-section-title">Keyboard shortcuts</h2>
        <dl className="st-info">
          {SHORTCUTS.map((s) => (
            <div className="st-info-row" key={s.keys}>
              <dt><kbd className="st-kbd">{s.keys}</kbd></dt>
              <dd>{s.action}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="st-footer-actions">
        <button type="button" className="st-btn st-btn--ghost" onClick={resetPrefs}>
          Reset display settings
        </button>
      </div>
    </div>
  );
}

/* ── About ───────────────────────────────────────────────── */
function AboutPanel() {
  const [isDesktop] = useState(isDesktopApp);
  const [storage, setStorage] = useState(null);
  const [copied, setCopied] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  // Same value as package.json "version", injected by vite.config.js.
  const versionText = `v${__APP_VERSION__}`;

  const platform = typeof navigator !== "undefined" ? navigator.platform || "Unknown" : "Unknown";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const winMatch = ua.match(/Windows NT (\d+\.\d+)/);
  const isWindows = !!winMatch;
  const ramGb = typeof navigator !== "undefined" ? navigator.deviceMemory : undefined;
  const screenW = typeof window !== "undefined" ? window.screen.width : 0;
  const screenH = typeof window !== "undefined" ? window.screen.height : 0;

  useEffect(() => {
    let active = true;
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((est) => {
        if (active) setStorage(est);
      }).catch(() => {});
    }

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      active = false;
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  // Requirement checks: "pass", "warn", or "unknown"
  const checkRequirement = (req) => {
    if (req.key === "os") {
      if (!isWindows) return { status: "warn", note: "Not detected as Windows" };
      const ver = parseFloat(winMatch[1]);
      return ver >= 10
        ? { status: "pass", note: "Windows 10 or later" }
        : { status: "warn", note: "Older Windows version" };
    }
    if (req.key === "net") {
      return online
        ? { status: "pass", note: "Connected" }
        : { status: "warn", note: "Offline" };
    }
    if (req.minRamGb) {
      if (!ramGb) return { status: "unknown", note: "Could not detect" };
      // navigator.deviceMemory caps at 8, so 8 GB+ may report as 8.
      return ramGb >= req.minRamGb
        ? { status: "pass", note: `About ${ramGb} GB detected` }
        : { status: "warn", note: `About ${ramGb} GB detected` };
    }
    if (req.minW) {
      return screenW >= req.minW && screenH >= req.minH
        ? { status: "pass", note: `${screenW} x ${screenH}` }
        : { status: "warn", note: `${screenW} x ${screenH}` };
    }
    return { status: "unknown", note: "Not checked automatically" };
  };

  // Copied text: only the app details. No online status and no user agent.
  const copySystemInfo = async () => {
    const lines = [
      `Local Civil Register ${versionText}`,
      `Environment: ${environmentLabel(isDesktop)}`,
      `Platform: ${platform}`,
      `Screen: ${screenW} x ${screenH}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(lines);
      setCopied(true);
    } catch (err) {
      console.error("[Settings] copy failed:", err);
    }
  };

  const usage = storage?.usage;
  const quota = storage?.quota;
  const usedPct = usage && quota ? Math.min(100, (usage / quota) * 100) : 0;

  return (
    <div className="st-section-group">
      {/* App info */}
      <section className="st-section">
        <h2 className="st-section-title">Local Civil Register</h2>
        <dl className="st-info">
          <div className="st-info-row"><dt>Version</dt><dd>{versionText}</dd></div>
          <div className="st-info-row">
            <dt>Environment</dt>
            <dd>{environmentLabel(isDesktop)}</dd>
          </div>
          <div className="st-info-row"><dt>Location</dt><dd>San Carlos City</dd></div>
          <div className="st-info-row"><dt>Platform</dt><dd>{platform}</dd></div>
        </dl>
        <div>
          <button type="button" className="st-btn st-btn--ghost" onClick={copySystemInfo}>
            {copied ? "Copied to clipboard" : "Copy system info"}
          </button>
        </div>
      </section>

      {/* Storage */}
      <section className="st-section">
        <h2 className="st-section-title">Browser storage</h2>
        {storage ? (
          <>
            <div className="st-meter" aria-label="Storage used">
              <div className="st-meter-fill" style={{ width: `${usedPct}%` }} />
            </div>
            <p className="st-section-desc">
              {formatBytes(usage)} used of {formatBytes(quota)} available to the app
            </p>
          </>
        ) : (
          <p className="st-note">Storage usage is not available on this device.</p>
        )}
      </section>

      {/* Requirements */}
      <section className="st-section">
        <h2 className="st-section-title">System requirements</h2>
        <dl className="st-info">
          {SYSTEM_REQUIREMENTS.map((req) => {
            const check = checkRequirement(req);
            return (
              <div className="st-info-row" key={req.label}>
                <dt>{req.label}</dt>
                <dd className="st-req-value">
                  <span>{req.value}</span>
                  <span className={`st-badge st-badge--${check.status}`}>
                    {check.status === "pass" ? "OK" : check.status === "warn" ? "Check" : "—"}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="st-note">
          Some checks are estimates from the browser. Python version and free disk space can't be read from here.
        </p>
      </section>
    </div>
  );
}

/* ── Hub ─────────────────────────────────────────────────── */
const Settings = ({ initialTab = "display" }) => {
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="st-root">
      <div className="st-body">
        <div className="st-tabs" role="tablist" aria-label="System settings">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`st-tab${tab === t.key ? " active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              <span className="st-tab-label">{t.label}</span>
              <span className="st-tab-desc">{t.desc}</span>
            </button>
          ))}
        </div>

        <div className="st-panel" role="tabpanel">
          <div className="st-panel-head">
            <div className="st-panel-title">{current.label}</div>
            <div className="st-panel-desc">{current.desc}</div>
          </div>

          <div className="st-panel-body">
            {tab === "display" && <DisplayPanel />}
            {tab === "about" && <AboutPanel />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;