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

/** Sidebar navigation group definitions (overview, question bank, exams). */
const groups = [
  {
    label: "概览",
    items: [
      { label: "仪表盘", to: routes.admin.dashboard, icon: LayoutDashboard },
    ],
  },
  {
    label: "题库",
    items: [
      { label: "课程管理", to: routes.admin.courses, icon: GraduationCap },
      {
        label: "题目管理",
        to: routes.admin.questions,
        icon: BookOpen,
        end: true,
      },
      { label: "题目导入", to: routes.admin.questionsImport, icon: FileUp },
    ],
  },
  {
    label: "考试",
    items: [
      {
        label: "考试管理",
        to: routes.admin.exams,
        icon: ClipboardList,
        end: true,
      },
      { label: "待评分", to: routes.admin.gradingQueue, icon: ClipboardCheck },
      { label: "成绩查询", to: routes.admin.results, icon: Gauge },
    ],
  },
];

/** Sidebar navigation items visible only to Admin-role users. */
const managementItems = [
  { label: "用户管理", to: routes.admin.users, icon: UserRoundCog },
  { label: "考生管理", to: routes.admin.candidates, icon: Users },
  { label: "导入日志", to: routes.admin.importLogs, icon: Upload },
  { label: "审计日志", to: routes.admin.auditLogs, icon: ScrollText },
  { label: "平台设置", to: routes.admin.settings, icon: Settings },
  { label: "考生字段", to: routes.admin.candidateFields, icon: Tags },
  { label: "系统监控", to: routes.admin.system, icon: Monitor },
];

/** A single navigation link in the sidebar with icon and active state styling. */
function SidebarLink({
  collapsed,
  item,
}: {
  collapsed: boolean;
  item: { label: string; to: string; icon: typeof BookOpen; end?: boolean };
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          "flex min-h-10 items-center gap-3 rounded-[var(--admin-radius)] px-3 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground",
          isActive &&
            "bg-sidebar-active-soft font-medium text-sidebar-foreground",
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {!collapsed && <span>{item.label}</span>}
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
            aria-label="折叠侧栏"
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
            aria-label="展开侧栏"
            onClick={onCollapse}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      <nav className="flex-1 flex flex-col gap-1 overflow-y-auto px-2 py-2">
        {groups.map((group, gi) => (
          <section key={group.label} className="flex flex-col gap-0.5">
            {!collapsed && (
              <p className="px-3 pb-1 pt-2 text-xs uppercase tracking-wider text-sidebar-muted">
                {group.label}
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
              <p className="px-3 pb-1 pt-2 text-xs uppercase tracking-wider text-sidebar-muted">
                管理
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
          aria-label="退出登录"
          onClick={onLogout}
        >
          <LogOut className="size-4" aria-hidden="true" />
          {!collapsed && <span className="ml-2">退出</span>}
        </Button>
      </div>
    </aside>
  );
}
