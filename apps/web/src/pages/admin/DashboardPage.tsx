import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import type { DashboardResponse } from "@exam/contracts";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AdminStatusTag } from "@/components/admin/AdminStatusTag";
import {
  AdminShell,
  AdminShellHeader,
  AdminPageCard,
  AdminTableShell,
  MetricCard,
} from "@/components/admin";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ClipboardList,
  Eye,
  BookOpen,
  Users,
  CalendarCheck,
  Activity,
  PlusCircle,
  Upload,
} from "lucide-react";

export function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.get<DashboardResponse>("/api/system/dashboard");
      setData(result);
    } catch {
      setError("加载仪表盘数据失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <AdminShell>
        <AdminShellHeader title="仪表盘" />
        <ErrorState message={error} onRetry={loadDashboard} />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <AdminShellHeader title="仪表盘" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="题目总数"
          value={data?.totalQuestions ?? 0}
          icon={BookOpen}
          iconBg="bg-[rgba(91,143,249,0.12)]"
          iconColor="text-[#5b8ff9]"
        />
        <MetricCard
          label="考试进行中"
          value={data?.activeExams ?? 0}
          icon={Activity}
          iconBg="bg-[rgba(250,173,20,0.14)]"
          iconColor="text-[#faad14]"
        />
        <MetricCard
          label="考生总数"
          value={data?.totalCandidates ?? 0}
          icon={Users}
          iconBg="bg-[rgba(146,112,202,0.12)]"
          iconColor="text-[#9270ca]"
        />
        <MetricCard
          label="今日考试"
          value={data?.todayExams ?? 0}
          icon={CalendarCheck}
          iconBg="bg-[rgba(90,216,166,0.14)]"
          iconColor="text-[#5ad8a6]"
        />
      </div>

      <div className="flex gap-3">
        <Button onClick={() => navigate("/admin/exams/new")}>
          <PlusCircle data-icon="inline-start" />
          创建考试
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate("/admin/questions/import")}
        >
          <Upload data-icon="inline-start" />
          导入题目
        </Button>
      </div>

      <AdminPageCard title="近期考试">
        <AdminTableShell>
          {!data?.recentExams || data.recentExams.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<ClipboardList className="size-10" />}
                title="暂无考试"
                description="还没有创建任何考试"
                action={
                  <Button onClick={() => navigate("/admin/exams/new")}>
                    创建考试
                  </Button>
                }
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>考试名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>参加人数</TableHead>
                  <TableHead className="w-16">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentExams.map((exam) => (
                  <TableRow key={exam.id}>
                    <TableCell className="font-medium">{exam.title}</TableCell>
                    <TableCell>
                      <AdminStatusTag status={exam.status} />
                    </TableCell>
                    <TableCell>{exam.participantCount}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`查看考试 ${exam.title}`}
                        onClick={() => navigate(`/admin/exams/${exam.id}`)}
                      >
                        <Eye />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AdminTableShell>
      </AdminPageCard>
    </AdminShell>
  );
}

function DashboardSkeleton() {
  return (
    <AdminShell>
      <Skeleton className="h-8 w-32" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border p-6">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-24" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </AdminShell>
  );
}
