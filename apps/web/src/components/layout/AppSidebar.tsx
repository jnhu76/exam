import type { MeResponse } from "@exam/contracts";
import { Role } from "@exam/domain";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FileUp,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Monitor,
  ScrollText,
  Settings,
  Tags,
  Upload,
  UserRoundCog,
  Users,
} from "lucide-react";
import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

/** A navigation item: route + icon + the i18n key for its label. */
interface NavItem {
  labelKey: string;
  to: string;
  icon: typeof BookOpen;
  end?: boolean;
}

/** A navigation group: the i18n key for its heading + its items. */
interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

/** Sidebar navigation group definitions (overview, question bank, exams).
 * Labels are i18n keys resolved at render via `t()`; no hardcoded copy. */
const groups: NavGroup[] = [
  {
    labelKey: "nav.groups.overview",
    items: [
      {
        labelKey: "nav.items.dashboard",
        to: routes.admin.dashboard,
        icon: LayoutDashboard,
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
      },
      {
        labelKey: "nav.items.questions",
        to: routes.admin.questions,
        icon: BookOpen,
        end: true,
      },
      {
        labelKey: "nav.items.questionsImport",
        to: routes.admin.questionsImport,
        icon: FileUp,
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
      },
      {
        labelKey: "nav.items.gradingQueue",
        to: routes.admin.gradingQueue,
        icon: ClipboardCheck,
      },
      {
        labelKey: "nav.items.results",
        to: routes.admin.results,
        icon: Gauge,
      },
    ],
  },
];

/** Sidebar navigation items visible only to Admin-role users.
 * Labels are i18n keys resolved at render via `t()`. */
const managementItems: NavItem[] = [
  {
    labelKey: "nav.items.users",
    to: routes.admin.users,
    icon: UserRoundCog,
  },
  {
    labelKey: "nav.items.candidates",
    to: routes.admin.candidates,
    icon: Users,
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

/** A single navigation link in the sidebar with icon and active state styling. */
function SidebarLink({
  collapsed,
  item,
}: {
  collapsed: boolean;
  item: NavItem;
}) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const label = t(item.labelKey as never);
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground",
          isActive && "bg-sidebar-accent font-medium text-sidebar-foreground",
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
}

/**
 * Collapsible admin sidebar with grouped navigation links,
 * user avatar, and logout button. Shows management items only for Admin role.
 */
export function AppSidebar({
  user,
  collapsed,
  onCollapse,
  onLogout,
}: AppSidebarProps) {
  const { t } = useTranslation();
  const showManagement = user.role === Role.Admin;
  const management = managementItems;

  const initials = user.name.slice(0, 2);

  return (
    <aside
      data-testid="app-sidebar"
      className={cn(
        "flex min-h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width]",
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
            <ChevronLeft className="size-4" aria-hidden="true" />
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
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      <nav className="flex-1 flex flex-col gap-1 overflow-y-auto px-2 py-2">
        {groups.map((group, gi) => (
          <section key={group.labelKey} className="flex flex-col gap-0.5">
            {!collapsed && (
              <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-sidebar-muted">
                {t(group.labelKey as never)}
              </p>
            )}
            {gi > 0 && collapsed && <Separator className="my-2" />}
            {group.items.map((item) => (
              <SidebarLink key={item.to} collapsed={collapsed} item={item} />
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
              <SidebarLink key={item.to} collapsed={collapsed} item={item} />
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
          <LogOut className="size-4" aria-hidden="true" />
          {!collapsed && (
            <span className="ml-2">{t("nav.actions.logoutShort")}</span>
          )}
        </Button>
      </div>
    </aside>
  );
}
