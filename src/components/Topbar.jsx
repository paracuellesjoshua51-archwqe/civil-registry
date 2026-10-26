import React, { memo, useEffect, useState } from "react";
import "./Topbar.css";

const dateFmt = new Intl.DateTimeFormat("en-PH", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const CalendarIcon = () => (
  <svg className="topbar-datetime-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
    <path d="M3 9.5H21" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 3V6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M16 3V6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const RefreshIcon = () => (
  <svg className="topbar-refresh-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 4v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TopbarDate = memo(function TopbarDate() {
  const [label, setLabel] = useState(() => dateFmt.format(new Date()));

  useEffect(() => {
    let timer;
    const schedule = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const delay = nextMidnight.getTime() - now.getTime() + 1000;
      timer = setTimeout(() => {
        setLabel(dateFmt.format(new Date()));
        schedule();
      }, delay);
    };

    schedule();
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="topbar-datetime" aria-label="Current date">
      <span className="topbar-datetime-item">
        <CalendarIcon />
        <span>{label}</span>
      </span>
    </div>
  );
});

const RefreshButton = memo(function RefreshButton() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleClick = () => {
    if (reloading) return;
    setReloading(true);
    // Flag para ma-show ang refresh-skeleton.js human sa reload
    try {
      sessionStorage.setItem("cr:hard-refresh", "1");
    } catch {
      /* sessionStorage unavailable: reload lang gihapon */
    }
    window.location.reload();
  };

  const title = reloading
    ? "Reloading…"
    : online
      ? "Reload page"
      : "Offline: reload cached data";

  return (
    <button
      type="button"
      className="topbar-refresh-btn"
      data-state={reloading ? "loading" : "idle"}
      onClick={handleClick}
      disabled={reloading}
      aria-busy={reloading}
      aria-label="Reload page"
      title={title}
    >
      <span className="topbar-refresh-icon-wrap">
        <RefreshIcon />
      </span>
    </button>
  );
});

const Topbar = ({ activeSubMenu, toggleSidebar, children }) => (
  <header className="topbar">
    <div className="topbar-left">
      <button className="topbar-toggle" onClick={toggleSidebar} type="button">
        <span className="topbar-toggle-icon">☰</span>
      </button>
      <span className="topbar-breadcrumb-current">{activeSubMenu}</span>
    </div>

    <div className="topbar-right">
      <TopbarDate />
      <RefreshButton />
      {children}
    </div>
  </header>
);

export default memo(Topbar);