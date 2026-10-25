import { Navigate } from "react-router-dom";
import { usePermissions } from "../context/PermissionContext";
import LoadingScreen from "./LoadingScreen";
import useHeartbeat from "../hooks/useHeartbeat";

export default function ProtectedRoute({ module, adminOnly = false, children }) {
  const { hasAccess, is_admin, loading, waking } = usePermissions();

  useHeartbeat(hasAccess("dashboard"));

  if (loading) return <LoadingScreen waking={waking} />;
  if (!hasAccess("dashboard")) return <Navigate to="/login" replace />;
  if (adminOnly && !is_admin) return <Navigate to="/access-denied" replace />;
  if (module && !hasAccess(module)) return <Navigate to="/access-denied" replace />;

  return children;
}