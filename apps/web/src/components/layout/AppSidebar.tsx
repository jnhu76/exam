import type { MeResponse } from "@exam/contracts";
import { Role } from "@exam/domain";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileUp,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Monitor,
  Settings,
  Tags,
  UserRoundCog,
  Users,
} from "lucide-react";
import { NavLink } from "react-router";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { BrandHeader } from "./BrandHeader";

interface AppSidebarProps {
  user: MeResponse;
  collapsed: boolean;
  onCollapse?: () => void;
  onLogout: () => void;
}

const groups = [
  {
    label: "概览",
    items: [{ label: "仪表盘", to: "/admin/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "题库",
    items: [
      { label: "课程管理", to: "/admin/courses", icon: GraduationCap },
      { label: "题目管理", to: "/admin/questions", icon: BookOpen, end: true },
      { label: "题目导入", to: "/admin/questions/import", icon: FileUp },
    ],
  },
  {
    label: "考试",
    items: [
      { label: "考试管理", to: "/admin/exams", icon: ClipboardList, end: true },
      { label: "成绩查询", to: "/admin/results", icon: Gauge },
    ],
  },
];

const managementItems = [
  { label: "用户管理", to: "/admin/users", icon: UserRoundCog },
  { label: "考生管理", to: "/admin/candidates", icon: Users },
  { label: "平台设置", to: "/admin/settings", icon: Settings },
  { label: "考生字段", to: "/admin/candidate-fields", icon: Tags },
  { label: "系统健康", to: "/admin/system", icon: Monitor },
];

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
          "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-muted transition-colors hover:bg-white/8 hover:text-white",
          isActive && "bg-sidebar-accent font-medium text-white",
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  );
}

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
          textClassName="text-white"
        />
        {onCollapse && !collapsed && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-sidebar-muted hover:bg-white/8 hover:text-white"
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
            className="text-sidebar-muted hover:bg-white/8 hover:text-white"
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
          <section key={group.label}>
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
          <section>
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
            <AvatarFallback className="bg-white/10 text-xs text-white">
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
          className="mt-1 w-full justify-center text-sidebar-muted hover:bg-white/8 hover:text-white"
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
