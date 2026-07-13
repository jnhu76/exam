import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { AppSidebar, SidebarContent } from "./AppSidebar";
import { BrandHeader } from "./BrandHeader";
import { AppIcon } from "@/components/shared/AppIcon";
import { useAuth } from "@/hooks/useAuth";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { getPageTitle } from "@/lib/pageMeta";
import { PageContainer } from "@/components/shared/PageContainer";

/**
 * Three-state responsive admin shell (DESIGN.md §9):
 *
 *   <lg            mobile/tablet — sidebar removed from flow (CSS hidden),
 *                 navigation in a left Sheet drawer; menu trigger in topbar.
 *   lg … <xl       compact desktop — persistent 56px icon rail (collapsed).
 *   >=xl           full desktop — persistent 232px sidebar; the user-controlled
 *                 collapse (232→56) is available only here.
 *
 * Width is driven by the existing AppSidebar `collapsed` prop (w-14 vs
 * w-[232px]); visibility below lg is CSS (`hidden lg:flex`). The shell always
 * renders <AppSidebar> (test-visible) and selects `collapsed` from the xl
 * breakpoint. The mobile drawer reuses the same SidebarContent authority.
 * Redirects unauthenticated or candidate-role users to /login.
 */
export function AdminLayout() {
  const { t } = useTranslation();
  const { user, logout, isLoading } = useAuth();
  // User-controlled collapse only applies at xl+ (full-desktop band). Below xl
  // the sidebar is the compact rail by design, so userCollapsed is ignored.
  const [userCollapsed, setUserCollapsed] = useState(false);
  const isXl = useMediaQuery("(min-width: 80rem)");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // In the compact band (lg … <xl) the sidebar is always the 56px rail.
  // At xl+ it reflects the user's collapse preference.
  const sidebarCollapsed = isXl ? userCollapsed : true;

  // Close the mobile drawer after route navigation.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // Restore focus to the menu trigger when the drawer closes. Radix Dialog
  // restores focus to the element that opened it, but only when the opener is
  // a Dialog/Sheet Trigger; this shell uses a controlled Sheet driven by an
  // external button, so we restore focus explicitly on the open→close
  // transition only (not on initial mount) to satisfy the focus-return
  // contract (DESIGN.md §9 / WAI-ARIA dialog pattern).
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !mobileNavOpen && triggerRef.current) {
      triggerRef.current.focus();
    }
    wasOpenRef.current = mobileNavOpen;
  }, [mobileNavOpen]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen bg-background">
        <div className="hidden w-56 shrink-0 flex-col border-r bg-card lg:flex">
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
  const containerRole =
    location.pathname === "/admin/system"
      ? "admin-wide"
      : location.pathname === "/admin/users"
        ? "admin-sparse"
        : /^\/admin\/(settings|candidate-fields|questions\/(new|import|[^/]+\/edit)|exams\/(new|[^/]+\/edit))$/.test(
              location.pathname,
            )
          ? "form"
          : "admin-standard";

  return (
    <div
      data-testid="admin-layout"
      className="flex min-h-screen bg-background text-sm"
    >
      <AppSidebar
        user={user}
        collapsed={sidebarCollapsed}
        onCollapse={
          isXl ? () => setUserCollapsed((value) => !value) : undefined
        }
        onLogout={() => void logout()}
      />
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center gap-3 border-b bg-card px-4 lg:px-6">
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            size="icon-lg"
            className="lg:hidden"
            data-testid="mobile-nav-trigger"
            aria-label={t("nav.actions.openMenu")}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-nav-drawer"
            aria-haspopup="dialog"
            onClick={() => setMobileNavOpen(true)}
          >
            <AppIcon icon={Menu} size="metric" />
          </Button>
          <div className="min-w-0 text-sm font-medium text-foreground">
            {topbarTitle}
          </div>
        </header>
        <main className="p-4 lg:p-8">
          <PageContainer role={containerRole}>
            <Outlet />
          </PageContainer>
        </main>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          id="mobile-nav-drawer"
          data-testid="mobile-nav-drawer"
          side="left"
          showCloseButton={false}
          className="flex w-[18rem] max-w-[calc(100vw-3rem)] flex-col gap-0 border-sidebar-border bg-sidebar p-0 sm:max-w-[calc(100vw-3rem)]"
        >
          <div className="flex min-h-14 items-center justify-between gap-2 border-b border-sidebar-border px-2">
            <BrandHeader textClassName="text-sidebar-foreground" />
            <SheetTitle className="sr-only">
              {t("nav.actions.menuTitle")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("nav.actions.menuDescription")}
            </SheetDescription>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground"
              aria-label={t("nav.actions.closeMenu")}
              onClick={() => setMobileNavOpen(false)}
            >
              <AppIcon icon={X} size="metric" />
            </Button>
          </div>
          <Separator className="bg-sidebar-border" />
          <SidebarContent
            user={user}
            collapsed={false}
            onLogout={() => void logout()}
            onNavigate={() => setMobileNavOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
