import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";

// Read the version from package.json so the About page always matches it.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Split node_modules into separate chunks.
// Regex handles both Windows (\) and forward (/) path separators.
const manualChunks = (id) => {
  if (!id.includes("node_modules")) return undefined;

  if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
    return "vendor-react";
  }
  if (/[\\/]node_modules[\\/](recharts|d3|d3-[^\\/]+|lodash)[\\/]/.test(id)) {
    return "vendor-charts";
  }
  return "vendor";
};

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    chunkSizeWarningLimit: 800,
    // All CSS goes into one file, so no lazy CSS chunk can fail to load
    // offline or after a stale service worker cache.
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Automatic update: the new service worker activates right away and the
      // page reloads by itself. No prompt, no manual unregister or cache clear.
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: false, // public/manifest.webmanifest is used instead
      includeAssets: ["scc.png", "lcr.jpg", "icons/pwa-192.png", "icons/pwa-512.png", "offline.html"],
      workbox: {
        skipWaiting: true,           // install the new version without waiting
        clientsClaim: true,          // take control of open pages immediately
        cleanupOutdatedCaches: true, // delete old app files after an update
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,png,jpg,svg,webmanifest}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [{
          urlPattern: ({ url }) =>
            url.pathname === "/api/offline/snapshot"
            || url.pathname === "/api/offline/snapshot/package",
          handler: "NetworkOnly",
        }],
      },
    }),
  ],
});