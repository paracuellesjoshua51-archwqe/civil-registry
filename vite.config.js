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
    // All CSS goes into one file, so no lazy CSS chunk (like bulkDelete-*.css)
    // can fail to load offline or after a stale service worker cache.
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
  registerType: "prompt",
  manifest: false,
  includeAssets: ["scc.png", "lcr.jpg", "icons/pwa-192.png", "icons/pwa-512.png", "offline.html"],
  workbox: {
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/api\//],
    globPatterns: ["**/*.{js,css,html,png,jpg,svg,webmanifest}"],
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    cleanupOutdatedCaches: true, // remove old app files after an update
    clientsClaim: true,          // the new version takes control of open pages right away
  },
}),
  ],
});