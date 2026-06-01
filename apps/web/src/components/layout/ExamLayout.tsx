import { NavLink, Navigate, Outlet } from "react-router";
import { BrandHeader } from "./BrandHeader";
import { useAuth } from "@/hooks/useAuth";
import { LoadingState } from "@/components/shared/LoadingState";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ExamLayout() {
  const { user, isLoading, logout } = useAuth();
  if (isLoading) return <LoadingState />;
  if (!user || user.role !== "Candidate") {
    return <Navigate to="/login" replace />;
  }
  return (
    <div data-testid="exam-layout" className="min-h-screen bg-background">
      <header className="flex min-h-14 items-center justify-between border-b px-4">
        <BrandHeader />
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <NavLink
              to="/exam/list"
              className={({ isActive }) =>
                cn(isActive && "font-medium underline")
              }
            >
              我的考试
            </NavLink>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <NavLink
              to="/exam/settings"
              className={({ isActive }) =>
                cn(isActive && "font-medium underline")
              }
            >
              账号设置
            </NavLink>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            退出
          </Button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
