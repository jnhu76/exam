import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { AppSidebar } from "./AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";

const routeTitles: Record<string, string> = {
  "/admin/dashboard": "仪表盘",
  "/admin/courses": "课程管理",
  "/admin/questions": "题目管理",
  "/admin/questions/import": "题目导入",
  "/admin/questions/new": "新建题目",
  "/admin/exams": "考试管理",
  "/admin/exams/new": "新建考试",
  "/admin/results": "成绩查询",
  "/admin/users": "用户管理",
  "/admin/candidates": "考生管理",
  "/admin/settings": "平台设置",
  "/admin/candidate-fields": "考生字段",
  "/admin/system": "系统健康",
  "/admin/organizations": "机构管理",
};
// TODO: sync routeTitles with App.tsx route definitions when routes change

function getTopbarTitle(pathname: string): string {
  if (routeTitles[pathname]) return routeTitles[pathname];
  if (pathname.startsWith("/admin/questions/")) return "编辑题目";
  if (pathname.startsWith("/admin/exams/")) return "考试详情";
  if (pathname.startsWith("/admin/attempts/")) return "答题详情";
  return "";
}

export function AdminLayout() {
  const { user, logout, isLoading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen bg-background">
        <div className="flex w-56 shrink-0 flex-col border-r bg-card">
          <div className="p-2">
            <Skeleton className="h-5 w-16" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <header className="flex h-14 items-center border-b bg-card px-6">
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

  const topbarTitle = getTopbarTitle(location.pathname);

  return (
    <div data-testid="admin-layout" className="flex min-h-screen bg-background">
      <AppSidebar
        user={user}
        collapsed={collapsed}
        onCollapse={() => setCollapsed((value) => !value)}
        onLogout={() => void logout()}
      />
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center border-b bg-card px-6">
          <h2 className="text-sm font-medium text-muted-foreground">
            {topbarTitle}
          </h2>
        </header>
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
