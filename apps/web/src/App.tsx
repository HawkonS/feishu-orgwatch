import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LoadingBlock } from "./components/ui";
import { useBootstrapStatus, useSession, type Role } from "./lib/session";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Directory from "./pages/Directory";
import Diffs from "./pages/Diffs";
import Notifications from "./pages/Notifications";
import DiffDetail from "./pages/DiffDetail";
import Tasks from "./pages/Tasks";
import Settings from "./pages/Settings";
import UsersAdmin from "./pages/UsersAdmin";
import Audit from "./pages/Audit";
import Guide from "./pages/Guide";
import Account from "./pages/Account";
import SystemUpdate from "./pages/SystemUpdate";

function FullScreen({ label }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <LoadingBlock label={label} />
    </div>
  );
}

function RoleGate({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user } = useSession();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function ProtectedLayout() {
  const { user, loading } = useSession();
  const location = useLocation();
  if (loading) return <FullScreen />;
  if (!user) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

export default function App() {
  const { user, loading } = useSession();
  const { data: bootstrap, isLoading, error } = useBootstrapStatus();

  useEffect(() => {
    if (bootstrap?.siteName) document.title = bootstrap.siteName;
  }, [bootstrap?.siteName]);

  if (loading || isLoading) return <FullScreen />;
  if (error || !bootstrap) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
        <p className="text-sm font-medium text-red-600">无法连接服务，请确认 feishu-orgwatch 已启动</p>
        <p className="max-w-md text-xs text-slate-500">
          如果服务刚启动，请稍候刷新；若持续失败，请查看 .runtime/logs/server.log。
        </p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={<Navigate to={user ? "/" : "/login"} replace />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/directory" element={<Directory />} />
        <Route path="/people" element={<Navigate to="/directory" replace />} />
        <Route path="/diffs" element={<Diffs />} />
        <Route path="/diffs/:id" element={<DiffDetail />} />
        <Route
          path="/notifications"
          element={
            <RoleGate roles={["admin", "operator"]}>
              <Notifications />
            </RoleGate>
          }
        />
        <Route path="/tasks" element={<RoleGate roles={["admin", "operator"]}><Tasks /></RoleGate>} />
        <Route path="/admin/users" element={<RoleGate roles={["admin"]}><UsersAdmin /></RoleGate>} />
        <Route path="/settings" element={<RoleGate roles={["admin", "operator"]}><Settings /></RoleGate>} />
        <Route path="/admin/system" element={<RoleGate roles={["admin"]}><SystemUpdate /></RoleGate>} />
        <Route path="/account" element={<Account />} />
        <Route path="/guide" element={<Guide />} />
        <Route path="/audit" element={<RoleGate roles={["admin"]}><Audit /></RoleGate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
