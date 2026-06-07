import { NavLink, Navigate, Outlet } from "react-router";
import { BrandHeader } from "./BrandHeader";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/shared/LoadingState";

export function ExamLayout() {
  const { user, isLoading, logout } = useAuth();
  if (isLoading) return <LoadingState />;
  if (!user || user.role !== "Candidate") {
    return <Navigate to="/login" replace />;
  }
  const initials = user.name.slice(0, 2);
  return (
    <div data-testid="exam-layout" className="min-h-screen bg-background">
      <header className="flex h-14 items-center justify-between border-b bg-card px-6">
        <BrandHeader />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <NavLink
              to="/exam/list"
              className={({ isActive }) =>
                cn(isActive && "font-medium text-primary")
              }
            >
              我的考试
            </NavLink>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <NavLink
              to="/exam/settings"
              className={({ isActive }) =>
                cn(isActive && "font-medium text-primary")
              }
            >
              账号设置
            </NavLink>
          </Button>
          <span className="mx-2 h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Avatar className="size-7">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <span className="text-sm">{user.name}</span>
          </div>
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
