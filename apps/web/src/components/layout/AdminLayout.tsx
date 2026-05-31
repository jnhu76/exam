import { useState } from "react";
import { Outlet } from "react-router";
import { AppSidebar } from "./AppSidebar";
import { BrandHeader } from "./BrandHeader";
import { useAuth } from "@/hooks/useAuth";

export function AdminLayout() {
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  if (!user) {
    return null;
  }

  return (
    <div data-testid="admin-layout" className="flex min-h-screen bg-muted/30">
      <AppSidebar
        user={user}
        collapsed={collapsed}
        onCollapse={() => setCollapsed((value) => !value)}
        onLogout={() => void logout()}
      />
      <div className="min-w-0 flex-1">
        <header className="flex min-h-14 items-center border-b bg-card px-6">
          <BrandHeader />
        </header>
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
