(function () {
  var FLAG = 'cr:hard-refresh';
  var ID = 'cr-refresh-skeleton';
  var STYLE_ID = 'cr-refresh-skeleton-style';
  var PREFS_KEY = 'lcr.displayPrefs';
  var MIN_VISIBLE_MS = 500;
  var SAFETY_TIMEOUT_MS = 8000;
  var STABLE_MS = 150;
  var POLL_MS = 50;
  var BUSY_SELECTOR = '[aria-busy="true"], .ui-skeleton, .stat-card--skeleton';

  /* ── Sizes: parehas sa index.css ─────────────────────────────────── */
  var SIDEBAR_W = 250;   /* --sidebar-width */
  var TOPBAR_H = 64;     /* --topbar-height */
  var PAGE_GUTTER = 24;  /* --page-gutter (pageLayout.css) */

  var shownAt = 0;

  function resolveTheme() {
    var theme = 'light';
    try {
      var prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      theme = prefs.theme || 'light';
    } catch (e) { /* default light */ }

    if (theme === 'system') {
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch (e) { return 'light'; }
    }
    return theme === 'dark' ? 'dark' : 'light';
  }

  var PALETTES = {
    light: {
      bg: '#f4f6fa',
      top: '#ffffff',
      topBorder: '#e5e7eb',
      card: '#ffffff',
      cardBorder: '#e5e7eb',
      block: 'linear-gradient(90deg,#e9edf3 25%,#f7f9fc 50%,#e9edf3 75%)',
      dark: 'linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.12) 50%,rgba(255,255,255,.05) 75%)',
      scheme: 'light'
    },
    dark: {
      bg: '#0f1115',
      top: '#1a1d23',
      topBorder: '#2f343d',
      card: '#1a1d23',
      cardBorder: '#2f343d',
      block: 'linear-gradient(90deg,#22262e 25%,#2a2f38 50%,#22262e 75%)',
      dark: 'linear-gradient(90deg,rgba(255,255,255,.04) 25%,rgba(255,255,255,.09) 50%,rgba(255,255,255,.04) 75%)',
      scheme: 'dark'
    }
  };

  function ensureStyle(p) {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + ID + '{position:fixed;inset:0;z-index:2147483647;display:flex;background:' + p.bg + ';color-scheme:' + p.scheme + ';font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}',
      '#' + ID + ' *{box-sizing:border-box;}',

      /* Sidebar (always dark) */
      '#' + ID + ' .crs-side{width:' + SIDEBAR_W + 'px;flex-shrink:0;background:#0b0d12;display:flex;flex-direction:column;}',
      '#' + ID + ' .crs-side-user{height:76px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border-bottom:1px solid rgba(255,255,255,.07);}',
      '#' + ID + ' .crs-side-nav{padding:14px 12px;display:flex;flex-direction:column;gap:10px;}',
      '#' + ID + ' .crs-side-sub{display:flex;flex-direction:column;gap:12px;padding:4px 0 4px 36px;}',
      '#' + ID + ' .crs-side-sub div{height:11px;width:55%;}',
      '#' + ID + ' .crs-side-foot{margin-top:auto;height:64px;border-top:1px solid rgba(255,255,255,.07);display:flex;align-items:center;padding:0 18px;}',

      /* Main area */
      '#' + ID + ' .crs-main{flex:1;min-width:0;display:flex;flex-direction:column;}',
      '#' + ID + ' .crs-top{height:' + TOPBAR_H + 'px;background:' + p.top + ';border-bottom:1px solid ' + p.topBorder + ';display:flex;align-items:center;justify-content:space-between;padding:0 16px;gap:10px;}',
      '#' + ID + ' .crs-top-left{display:flex;align-items:center;gap:10px;}',
      '#' + ID + ' .crs-top-right{display:flex;align-items:center;gap:8px;}',
      '#' + ID + ' .crs-body{flex:1;overflow:hidden;padding:20px ' + PAGE_GUTTER + 'px;display:flex;flex-direction:column;gap:14px;}',
      '#' + ID + ' .crs-live{align-self:flex-end;}',
      '#' + ID + ' .crs-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}',
      '#' + ID + ' .crs-card{background:' + p.card + ';border:1px solid ' + p.cardBorder + ';border-radius:12px;padding:16px;}',
      '#' + ID + ' .crs-chart{flex:1;min-height:260px;}',

      /* Shimmer blocks */
      '#' + ID + ' .crs-block{border-radius:6px;background:' + p.block + ';background-size:200% 100%;animation:crs-shimmer 1.2s infinite linear;}',
      '#' + ID + ' .crs-dark{background:' + p.dark + ';background-size:200% 100%;animation:crs-shimmer 1.2s infinite linear;}',
      '@keyframes crs-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}',
      '@media (prefers-reduced-motion: reduce){#' + ID + ' .crs-block,#' + ID + ' .crs-dark{animation:none;}}',

      /* Responsive: sidebar hides under 768px, same as the app */
      '@media (max-width:767px){#' + ID + ' .crs-side{display:none;}#' + ID + ' .crs-top{padding-left:60px;}#' + ID + ' .crs-body{padding:14px;}}',
      '@media (max-width:767px){#' + ID + ' .crs-grid3{grid-template-columns:1fr;}}',

      /* Fade out */
      '#' + ID + '.crs-out{opacity:0;transition:opacity .25s ease;}'
    ].join('');
    document.head.appendChild(s);
  }

  function bar(w, h, extra) {
    return '<div class="crs-block" style="width:' + w + ';height:' + h + ';' + (extra || '') + '"></div>';
  }
  function dark(w, h, extra) {
    return '<div class="crs-dark" style="width:' + w + ';height:' + h + ';' + (extra || '') + '"></div>';
  }

  function card() {
    return '<div class="crs-card">' +
      bar('40%', '13px') +
      bar('60%', '32px', 'margin-top:12px') +
      bar('70%', '10px', 'margin-top:12px') +
    '</div>';
  }

  function build() {
    var sidebar =
      '<aside class="crs-side">' +
        '<div class="crs-side-user">' +
          dark('64px', '13px') +
          dark('100px', '9px') +
        '</div>' +
        '<nav class="crs-side-nav">' +
          dark('100%', '40px', 'border-radius:9px;') +
          dark('100%', '40px', 'border-radius:9px;') +
          dark('100%', '40px', 'border-radius:9px;') +
          '<div class="crs-side-sub">' + dark('55%', '11px') + dark('55%', '11px') + '</div>' +
          dark('100%', '40px', 'border-radius:9px;') +
          dark('100%', '40px', 'border-radius:9px;') +
          dark('100%', '40px', 'border-radius:9px;') +
        '</nav>' +
        '<div class="crs-side-foot">' + dark('84px', '14px') + '</div>' +
      '</aside>';

    var topbar =
      '<header class="crs-top">' +
        '<div class="crs-top-left">' +
          bar('32px', '32px', 'border-radius:8px;') +
          bar('130px', '14px') +
        '</div>' +
        '<div class="crs-top-right">' +
          bar('150px', '32px', 'border-radius:8px;') +
          bar('32px', '32px', 'border-radius:8px;') +
          bar('32px', '32px', 'border-radius:8px;') +
        '</div>' +
      '</header>';

    var body =
      '<div class="crs-body">' +
        '<div class="crs-live">' + bar('100px', '13px') + '</div>' +
        '<div class="crs-card" style="height:170px">' +
          bar('120px', '12px') +
          bar('160px', '40px', 'margin-top:14px') +
          bar('200px', '10px', 'margin-top:14px') +
        '</div>' +
        '<div class="crs-grid3">' + card() + card() + card() + '</div>' +
        '<div class="crs-card crs-chart"><div class="crs-block" style="height:100%;"></div></div>' +
      '</div>';

    return sidebar + '<div class="crs-main">' + topbar + body + '</div>';
  }

  function show() {
    if (document.getElementById(ID)) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', show, { once: true });
      return;
    }
    var palette = PALETTES[resolveTheme()];
    ensureStyle(palette);
    var el = document.createElement('div');
    el.id = ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-busy', 'true');
    el.setAttribute('aria-label', 'Refreshing');
    el.innerHTML = build();
    document.body.appendChild(el);
    shownAt = Date.now();
  }

  function hide() {
    var el = document.getElementById(ID);
    if (!el) return;
    var wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt));
    setTimeout(function () {
      el.classList.add('crs-out');
      setTimeout(function () { el.remove(); }, 260);
    }, wait);
  }

  /* ── Ready check ───────────────────────────────────────────────────
     Public pages (login / access-denied): ready kung naa na ang React root.
     App pages: ready kung naa na ang topbar ug wala nay busy/skeleton
     sa sulod sa main content. */
  function appIsReady() {
    var path = location.pathname;
    var onPublicPage = path.indexOf('/login') === 0 || path.indexOf('/access-denied') === 0;

    if (onPublicPage) {
      var root = document.getElementById('root');
      return !!root && root.children.length > 0;
    }

    if (!document.querySelector('.topbar')) return false;

    var main = document.querySelector('.main-content-wrapper') || document.getElementById('root');
    if (!main) return false;
    return !main.querySelector(BUSY_SELECTOR);
  }

  function hideWhenAppReady() {
    var start = Date.now();
    var stableSince = 0;
    var poll = setInterval(function () {
      if (Date.now() - start > SAFETY_TIMEOUT_MS) {
        clearInterval(poll);
        hide();
        return;
      }
      if (appIsReady()) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= STABLE_MS) {
          clearInterval(poll);
          hide();
        }
      } else {
        stableSince = 0;
      }
    }, POLL_MS);
  }

  try {
    if (sessionStorage.getItem(FLAG) === '1') {
      sessionStorage.removeItem(FLAG);
      show();
      hideWhenAppReady();
    }
  } catch (e) { /* sessionStorage unavailable: skip the skeleton */ }

  window.crRefreshSkeleton = { show: show, hide: hide };
})();