import { useMemo } from "react";
import type { MeResponse } from "@exam/contracts";
import { Role } from "@exam/domain";
import {
  BookOpen,
  Building2,
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
import { Button } from "@/components/ui/button";
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
      { label: "题目管理", to: "/admin/questions", icon: BookOpen },
      { label: "题目导入", to: "/admin/questions/import", icon: FileUp },
    ],
  },
  {
    label: "考试",
    items: [
      { label: "考试管理", to: "/admin/exams", icon: ClipboardList },
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
  item: { label: string; to: string; icon: typeof BookOpen };
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm hover:bg-accent",
          isActive && "bg-accent font-medium",
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
  const showManagement =
    user.role === Role.Admin || user.role === Role.SuperAdmin;
  const management = useMemo(
    () => [
      ...(user.role === Role.SuperAdmin
        ? [{ label: "机构管理", to: "/admin/organizations", icon: Building2 }]
        : []),
      ...managementItems,
    ],
    [user.role],
  );

  return (
    <aside
      data-testid="app-sidebar"
      className={cn(
        "flex min-h-screen shrink-0 flex-col border-r bg-card p-2 transition-[width]",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div className="flex min-h-12 items-center justify-between px-2">
        <BrandHeader compact={collapsed} />
        {onCollapse && !collapsed && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="折叠侧栏"
            onClick={onCollapse}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
        )}
      </div>

      {collapsed && onCollapse && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="展开侧栏"
          onClick={onCollapse}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      )}

      <nav className="flex-1 space-y-4 py-4">
        {groups.map((group) => (
          <section key={group.label}>
            {!collapsed && (
              <p className="px-3 pb-1 text-xs text-muted-foreground">
                {group.label}
              </p>
            )}
            {group.items.map((item) => (
              <SidebarLink key={item.to} collapsed={collapsed} item={item} />
            ))}
          </section>
        ))}
        {showManagement && (
          <section>
            {!collapsed && (
              <p className="px-3 pb-1 text-xs text-muted-foreground">管理</p>
            )}
            {management.map((item) => (
              <SidebarLink key={item.to} collapsed={collapsed} item={item} />
            ))}
          </section>
        )}
      </nav>

      <div className="border-t pt-2">
        {!collapsed && (
          <p className="truncate px-3 py-2 text-sm">{user.name}</p>
        )}
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start"
          aria-label="退出登录"
          onClick={onLogout}
        >
          <LogOut aria-hidden="true" />
          {!collapsed && <span>退出</span>}
        </Button>
      </div>
    </aside>
  );
}
