import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import type { DashboardResponse } from "@exam/contracts";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatsCard } from "@/components/shared/StatsCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
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

/** Admin dashboard page displaying stats cards, quick actions, and recent exams. */
/**
 * Admin dashboard page showing summary statistics (question count, active exams,
 * candidate count, today's exams), quick-action buttons, and a table of recent exams.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fetches dashboard summary data from the system API. */
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
      <div className="flex flex-col gap-6">
        <PageHeader title="仪表盘" />
        <ErrorState message={error} onRetry={loadDashboard} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="仪表盘" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          label="题目总数"
          value={data?.totalQuestions ?? 0}
          icon={<BookOpen className="size-5" />}
        />
        <StatsCard
          label="考试进行中"
          value={data?.activeExams ?? 0}
          icon={<Activity className="size-5" />}
        />
        <StatsCard
          label="考生总数"
          value={data?.totalCandidates ?? 0}
          icon={<Users className="size-5" />}
        />
        <StatsCard
          label="今日考试"
          value={data?.todayExams ?? 0}
          icon={<CalendarCheck className="size-5" />}
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

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">近期考试</CardTitle>
        </CardHeader>
        <CardContent>
          {!data?.recentExams || data.recentExams.length === 0 ? (
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
                      <StatusBadge status={exam.status} />
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
        </CardContent>
      </Card>
    </div>
  );
}

/** Skeleton placeholder shown while the dashboard data is loading. */
/** Placeholder skeleton shown while the dashboard data is loading. */
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
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
    </div>
  );
}
