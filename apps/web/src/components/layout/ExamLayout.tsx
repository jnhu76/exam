import { NavLink, Navigate, Outlet, useNavigate } from "react-router";
import { BrandHeader } from "./BrandHeader";
import { useAuth } from "@/hooks/useAuth";
import { routes } from "@/lib/routes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shell layout for candidate-facing exam pages. Renders a top header
 * with branding, exam list link, user info, and logout.
 * Redirects non-candidate users to /login.
 */
export function ExamLayout() {
  const { user, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="flex h-14 items-center justify-between border-b bg-card px-6">
          <BrandHeader textClassName="text-foreground" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="mx-2 h-4 w-px" />
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-8 w-12 rounded-md" />
          </div>
        </header>
      </div>
    );
  }
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
              to={routes.exam.list}
              className={({ isActive }) =>
                cn(isActive && "font-medium text-primary")
              }
            >
              我的考试
            </NavLink>
          </Button>
          <span className="mx-2 h-4 w-px bg-border" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="账号菜单"
                className="flex items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm">{user.name}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="exam-settings-link"
                onSelect={() => void navigate(routes.exam.settings)}
              >
                账号设置
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => void logout()}
              >
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
