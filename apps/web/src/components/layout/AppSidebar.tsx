import type { MeResponse } from "@exam/contracts";
import {
  canImportQuestions,
  canSeeCourses,
  canSeeDashboard,
  canSeeExams,
  canSeeGradingQueue,
  canSeeManagement,
  canSeeQuestions,
  canSeeResults,
} from "@/lib/capabilities";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileUp,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Monitor,
  ScrollText,
  Settings,
  Tags,
  Upload,
  UserRoundCheck,
  Users,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AppIcon } from "@/components/shared/AppIcon";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";
import { BrandHeader } from "./BrandHeader";

/** Props for the AppSidebar component. */
interface AppSidebarProps {
  user: MeResponse;
  collapsed: boolean;
  onCollapse?: () => void;
  onLogout: () => void;
}

/** A navigation item: route + icon + the i18n key for its label.
 *  `visible?` is a UX-only capability gate (see lib/capabilities.ts); it hides
 *  the entry for roles that lack the permission. Backend remains authoritative. */
interface NavItem {
  labelKey: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
  visible?: (user: Pick<MeResponse, "role">) => boolean;
}

/** A navigation group: the i18n key for its heading + its items. */
interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

/** Sidebar navigation group definitions (overview, question bank, exams).
 * Labels are i18n keys resolved at render via `t()`; no hardcoded copy.
 * Shared by the desktop sidebar and the mobile navigation drawer. */
const groups: NavGroup[] = [
  {
    labelKey: "nav.groups.overview",
    items: [
      {
        labelKey: "nav.items.dashboard",
        to: routes.admin.dashboard,
        icon: LayoutDashboard,
        visible: canSeeDashboard,
      },
    ],
  },
  {
    labelKey: "nav.groups.questionBank",
    items: [
      {
        labelKey: "nav.items.courses",
        to: routes.admin.courses,
        icon: GraduationCap,
        visible: canSeeCourses,
      },
      {
        labelKey: "nav.items.questions",
        to: routes.admin.questions,
        icon: BookOpen,
        end: true,
        visible: canSeeQuestions,
      },
      {
        labelKey: "nav.items.questionsImport",
        to: routes.admin.questionsImport,
        icon: FileUp,
        visible: canImportQuestions,
      },
    ],
  },
  {
    labelKey: "nav.groups.exams",
    items: [
      {
        labelKey: "nav.items.exams",
        to: routes.admin.exams,
        icon: ClipboardList,
        end: true,
        visible: canSeeExams,
      },
      {
        labelKey: "nav.items.gradingQueue",
        to: routes.admin.gradingQueue,
        icon: ListChecks,
        visible: canSeeGradingQueue,
      },
      {
        labelKey: "nav.items.results",
        to: routes.admin.results,
        icon: Gauge,
        visible: canSeeResults,
      },
    ],
  },
];

/** Sidebar navigation items visible only to Admin-role users.
 * Labels are i18n keys resolved at render via `t()`.
 * Shared by the desktop sidebar and the mobile navigation drawer. */
const managementItems: NavItem[] = [
  {
    labelKey: "nav.items.users",
    to: routes.admin.users,
    icon: UsersRound,
  },
  {
    labelKey: "nav.items.candidates",
    to: routes.admin.candidates,
    icon: UserRoundCheck,
  },
  {
    labelKey: "nav.items.importLogs",
    to: routes.admin.importLogs,
    icon: Upload,
  },
  {
    labelKey: "nav.items.auditLogs",
    to: routes.admin.auditLogs,
    icon: ScrollText,
  },
  {
    labelKey: "nav.items.settings",
    to: routes.admin.settings,
    icon: Settings,
  },
  {
    labelKey: "nav.items.candidateFields",
    to: routes.admin.candidateFields,
    icon: Tags,
  },
  {
    labelKey: "nav.items.system",
    to: routes.admin.system,
    icon: Monitor,
  },
];

/** A single navigation link with icon and active state styling.
 * Shared by the desktop sidebar and the mobile navigation drawer. */
function SidebarLink({
  collapsed,
  item,
  onNavigate,
}: {
  collapsed: boolean;
  item: NavItem;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const label = t(item.labelKey as never);
  return (
    <NavLink
      data-slot="sidebar-nav-item"
      to={item.to}
      end={item.end}
      title={collapsed ? label : undefined}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex min-h-10 items-center gap-3 rounded-md px-3 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground",
          isActive && "bg-sidebar-accent font-medium text-sidebar-foreground",
        )
      }
    >
      <AppIcon icon={Icon} size="nav" />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
}

/** Shared navigation content: brand, nav groups, role-gated management items,
 * user identity, and logout. Rendered inside BOTH the desktop sidebar aside
 * (with the collapse control) and the mobile navigation drawer. This is the
 * single navigation authority — desktop and mobile must not maintain separate
 * nav arrays (DESIGN.md §9 Shared navigation authority). */
export function SidebarContent({
  user,
  collapsed,
  onLogout,
  onNavigate,
}: {
  user: MeResponse;
  collapsed: boolean;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const showManagement = canSeeManagement(user);
  const management = managementItems;
  const initials = user.name.slice(0, 2);

  // UX-only capability filter (lib/capabilities.ts). Hides nav entries the
  // role's preset does not grant; backend remains authoritative.
  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => !item.visible || item.visible(user)),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
        {visibleGroups.map((group, gi) => (
          <section key={group.labelKey} className="flex flex-col gap-0.5">
            {!collapsed && (
              <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-sidebar-muted">
                {t(group.labelKey as never)}
              </p>
            )}
            {gi > 0 && collapsed && <Separator className="my-2" />}
            {group.items.map((item) => (
              <SidebarLink
                key={item.to}
                collapsed={collapsed}
                item={item}
                onNavigate={onNavigate}
              />
            ))}
          </section>
        ))}
        {showManagement && (
          <section className="flex flex-col gap-0.5">
            {!collapsed && (
              <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-sidebar-muted">
                {t("nav.groups.management")}
              </p>
            )}
            {collapsed && <Separator className="my-2" />}
            {management.map((item) => (
              <SidebarLink
                key={item.to}
                collapsed={collapsed}
                item={item}
                onNavigate={onNavigate}
              />
            ))}
          </section>
        )}
      </nav>

      <Separator className="bg-sidebar-border" />

      <div className="p-2">
        <div
          className={cn(
            "flex items-center gap-2",
            collapsed ? "justify-center" : "px-1",
          )}
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-sidebar-accent text-xs text-sidebar-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <span className="flex-1 truncate text-sm text-sidebar-text">
              {user.name}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-center text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground"
          aria-label={t("nav.actions.logout")}
          onClick={onLogout}
        >
          <AppIcon icon={LogOut} size="nav" />
          {!collapsed && (
            <span className="ml-2">{t("nav.actions.logoutShort")}</span>
          )}
        </Button>
      </div>
    </>
  );
}

/**
 * Collapsible admin sidebar with grouped navigation links,
 * user avatar, and logout button. Shows management items only for Admin role.
 * Rendered only at the `lg` breakpoint and above (persistent desktop sidebar);
 * below `lg` the same navigation authority is surfaced through the mobile
 * navigation drawer in AdminLayout.
 */
export function AppSidebar({
  user,
  collapsed,
  onCollapse,
  onLogout,
}: AppSidebarProps) {
  const { t } = useTranslation();

  return (
    <aside
      data-testid="app-sidebar"
      className={cn(
        "hidden min-h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] lg:flex",
        collapsed ? "w-14" : "w-[232px]",
      )}
    >
      <div
        className={cn(
          "border-b border-sidebar-border px-2",
          collapsed
            ? "flex min-h-24 flex-col items-center justify-center gap-2 py-2"
            : "flex min-h-14 items-center gap-2",
        )}
      >
        <BrandHeader
          compact={collapsed}
          className={cn(!collapsed && "flex-1")}
          textClassName="text-sidebar-foreground"
        />
        {onCollapse && !collapsed && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground"
            data-testid="sidebar-collapse-button"
            aria-label={t("nav.actions.collapse")}
            onClick={onCollapse}
          >
            <AppIcon icon={ChevronLeft} size="nav" />
          </Button>
        )}
        {onCollapse && collapsed && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground"
            data-testid="sidebar-collapse-button"
            aria-label={t("nav.actions.expand")}
            onClick={onCollapse}
          >
            <AppIcon icon={ChevronRight} size="nav" />
          </Button>
        )}
      </div>

      <SidebarContent user={user} collapsed={collapsed} onLogout={onLogout} />
    </aside>
  );
}
