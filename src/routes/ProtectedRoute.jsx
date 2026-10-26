import { Navigate } from "react-router-dom";
import { usePermissions } from "../context/PermissionContext";
import LoadingScreen from "./LoadingScreen";
import useHeartbeat from "../hooks/useHeartbeat";

// Gimarkahan sa Login kung nakalogin ang user niini nga launch/window.
// Mawala kini kung isirado ang window, mao nga ang reopen mo-require og login.
const UNLOCK_KEY = "lcr_unlocked_this_launch";

function isUnlockedThisLaunch() {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

// Renders children only when the user logged in during THIS launch and the
// session is valid (online with a server session, or offline from cache).
export default function ProtectedRoute({ module, adminOnly = false, children }) {
  const { authenticated, hasAccess, is_admin, loading, waking } = usePermissions();

  useHeartbeat(authenticated);

  if (loading) return <LoadingScreen waking={waking} />;

  // Ang cached session dili igo. Kinahanglan og login niini nga launch.
  if (!authenticated || !isUnlockedThisLaunch()) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && !is_admin) return <Navigate to="/access-denied" replace />;
  if (module && !hasAccess(module)) return <Navigate to="/access-denied" replace />;

  return children;
}