import { Navigate } from "react-router-dom";
import { usePermissions } from "../context/PermissionContext";
import LoadingScreen from "./LoadingScreen";
import useHeartbeat from "../hooks/useHeartbeat";

// Renders children only when a session is confirmed: online with a server
// session, or offline with a valid, unexpired cached session.
export default function ProtectedRoute({ module, adminOnly = false, children }) {
  const { authenticated, hasAccess, is_admin, loading, waking } = usePermissions();

  useHeartbeat(authenticated);

  if (loading) return <LoadingScreen waking={waking} />;
  if (!authenticated) return <Navigate to="/login" replace />;
  if (adminOnly && !is_admin) return <Navigate to="/access-denied" replace />;
  if (module && !hasAccess(module)) return <Navigate to="/access-denied" replace />;

  return children;
}