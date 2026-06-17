import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { AppSidebar } from "./AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { getPageTitle } from "@/lib/pageMeta";

/**
 * Shell layout for the admin console. Renders a collapsible sidebar,
 * a top bar with the current page title, and an <Outlet> for child routes.
 * Redirects unauthenticated or candidate-role users to /login.
 */
export function AdminLayout() {
  const { user, logout, isLoading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen bg-background">
        <div className="flex w-56 shrink-0 flex-col border-r bg-card">
          <div className="p-2">
            <Skeleton className="h-5 w-16" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <header className="flex h-14 items-center border-b bg-card px-6 shadow-xs">
            <Skeleton className="h-4 w-24" />
          </header>
          <main className="flex flex-col gap-4 p-6">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </main>
        </div>
      </div>
    );
  }
  if (!user || user.role === "Candidate") {
    return <Navigate to="/login" replace />;
  }

  const topbarTitle = getPageTitle(location.pathname);

  return (
    <div
      data-testid="admin-layout"
      className="flex min-h-screen bg-background text-sm"
    >
      <AppSidebar
        user={user}
        collapsed={collapsed}
        onCollapse={() => setCollapsed((value) => !value)}
        onLogout={() => void logout()}
      />
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center border-b bg-card px-6">
          <h2 className="text-sm font-medium text-muted-foreground">
            {topbarTitle}
          </h2>
        </header>
        <main className="p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
