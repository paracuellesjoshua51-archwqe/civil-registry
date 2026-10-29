const INSTALL_KEY = "__civilRegistryRequestCounterInstalled";

function requestUrl(value) {
  const raw = typeof value === "string" ? value : value?.url || String(value);
  try {
    const url = new URL(raw, window.location.href);
    return `${url.pathname}${url.search}`;
  } catch {
    return raw;
  }
}

export function installDevRequestCounter() {
  if (!import.meta.env.DEV || typeof window === "undefined" || window[INSTALL_KEY]) return;
  window[INSTALL_KEY] = true;

  const counts = new Map();
  const count = (url) => {
    const key = requestUrl(url);
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  const report = () => {
    if (!counts.size) return;
    console.debug("[dev request counts] last 60 seconds", Object.fromEntries(counts));
    counts.clear();
  };

  const originalFetch = window.fetch;
  window.fetch = function countedFetch(input, ...args) {
    count(input);
    return originalFetch.call(this, input, ...args);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function countedOpen(method, url, ...args) {
    this.__requestCounterUrl = url;
    return originalOpen.call(this, method, url, ...args);
  };
  XMLHttpRequest.prototype.send = function countedSend(...args) {
    count(this.__requestCounterUrl || "unknown");
    return originalSend.apply(this, args);
  };

  window.setInterval(report, 60_000);
}
