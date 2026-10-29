// src/main.jsx
import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import "./styles/darkTheme.css";
import { applyStoredDisplayPrefs } from "./utils/displayPrefs";
import { PermissionProvider } from "./context/PermissionContext";
import { OfflineProvider } from "./context/OfflineContext";
import { RefreshProvider } from "./context/RefreshContext";
import ProtectedRoute from "./routes/ProtectedRoute";
import Login from "./pages/Auth/Login";
import AccessDenied from "./pages/Auth/AccessDenied";
import HomePreloader from "./routes/HomePreloader";
import ToastContainer from "./components/ToastContainer";
import GlobalRealtime from "./components/GlobalRealtime";
import ErrorBoundary from "./components/ErrorBoundary";
import { installDevRequestCounter } from "./services/devRequestCounter";

// Home is lazy-loaded so it gets its own chunk.
// HomePreloader uses the same dynamic import to warm it up during idle time.
const Home = lazy(() => import("./pages/Home/Home"));

// Safety net: if a chunk cannot be loaded (offline, or a stale service worker
// cache), keep the app running instead of crashing into the ErrorBoundary.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  console.warn("Chunk preload failed (offline or stale cache):", event.payload);
});

// Apply the saved theme, zoom and contrast before the first render so the
// app never paints in the wrong mode after a restart.
applyStoredDisplayPrefs();
installDevRequestCounter();

const HomeFallback = () => (
  <div
    className="module-loading-state"
    style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}
  >
    Loading…
  </div>
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Router>
        <ToastContainer />
        {/* One realtime listener for the whole app. Pages subscribe via useDataChanged. */}
        <GlobalRealtime />
        <PermissionProvider>
          <OfflineProvider>
            <RefreshProvider>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/login" element={<><Login /><HomePreloader /></>} />
                <Route path="/access-denied" element={<AccessDenied />} />

                <Route
                  element={
                    <Suspense fallback={<HomeFallback />}>
                      <ProtectedRoute module="dashboard">
                        <Home />
                      </ProtectedRoute>
                    </Suspense>
                  }
                >
                  <Route path="dashboard" element={<></>} />
                  <Route path="vital-records/*" element={<></>} />
                  <Route path="heatmaps" element={<></>} />
                  <Route path="document-tracking" element={<></>} />
                  <Route path="settings/*" element={<></>} />
                  <Route path="offline-sync" element={<></>} />
                </Route>

                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </RefreshProvider>
          </OfflineProvider>
        </PermissionProvider>
      </Router>
    </ErrorBoundary>
  </React.StrictMode>
);