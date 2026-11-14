import { NavLink, Navigate, Outlet, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { BrandHeader } from "./BrandHeader";
import {
  LeaveGuardProvider,
  useConfirmLeave,
  useGuardedExit,
} from "@/components/layout/leaveGuard";
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
import {
  canAccessExamRuntime,
  canAccessAdminConsole,
  adminLandingPath,
} from "@/lib/capabilities";
import { NotificationBell } from "@/components/notifications/NotificationBell";

/**
 * Inner shell content: lives under LeaveGuardProvider so the shell's exits
 * consult the active page's leave guard (#971 F-01) before navigating.
 */
function ExamLayoutContent() {
  const { t } = useTranslation();
  const { user, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const exit = useGuardedExit();
  const exitGuard = useConfirmLeave();
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
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!canAccessExamRuntime(user)) {
    // Multi-role user with admin-console capabilities but no ExamTake:
    // redirect to the admin console landing instead of login.
    if (canAccessAdminConsole(user)) {
      return <Navigate to={adminLandingPath(user)!} replace />;
    }
    return <Navigate to="/login" replace />;
  }
  const initials = user.name.slice(0, 2);
  return (
    <div data-testid="exam-layout" className="min-h-screen bg-background">
      <header className="flex h-14 items-center justify-between border-b bg-card px-4 sm:px-6">
        <BrandHeader />
        <div className="flex shrink-0 items-center gap-2">
          {/* Exam-controlled exits route through the leave guard (#971
              F-01): the active take page drains its pending answer saves and
              obtains server ACKs before the shell navigates. Native browser
              Back is not Exam-controlled under BrowserRouter — documented
              tradeoff. */}
          <Button variant="ghost" size="sm" asChild>
            <NavLink
              to={routes.exam.list}
              className={({ isActive }) =>
                cn(isActive && "font-medium text-primary")
              }
              onClick={(event) => {
                // Modified and non-primary clicks mean "open elsewhere"
                // (new tab/window): keep the native link behavior instead of
                // intercepting it. Only a plain primary click is an
                // Exam-controlled in-app exit.
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                void exit(routes.exam.list);
              }}
            >
              {t("examLayout.myExams")}
            </NavLink>
          </Button>
          <NotificationBell />
          {/* The display name is the only unbounded-width header item; below
              sm it collapses into the avatar (trigger keeps its aria-label). */}
          <span className="mx-2 hidden h-4 w-px bg-border sm:block" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("examLayout.accountMenu")}
                className="flex items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-sm sm:inline">{user.name}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => void exit(routes.exam.settings)}
              >
                {t("examLayout.accountSettings")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
                onSelect={() => {
                  void (async () => {
                    // Logging out IS leaving the page: the save guard runs
                    // first, then the authoritative logout command performs
                    // its own navigation to /login.
                    if (await exitGuard()) await logout();
                  })();
                }}
              >
                {t("examLayout.logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {/* The take-exam runtime page owns its gutter and full-bleed chrome and
          neutralizes this main's padding (see the shell-level OWNERSHIP note). */}
      <main className="p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * Shell layout for candidate-facing exam pages. Renders a top header
 * with branding, exam list link, user info, and logout.
 * Redirects non-candidate users to /login.
 *
 * OWNERSHIP: the shell owns the main gutter (p-4 sm:p-6);
 * page width is declared by each page through <PageContainer role="…">. The
 * take-exam runtime page is the documented exception (page-owned gutter
 * and full-bleed sticky chrome).
 */
export function ExamLayout() {
  return (
    <LeaveGuardProvider>
      <ExamLayoutContent />
    </LeaveGuardProvider>
  );
}
