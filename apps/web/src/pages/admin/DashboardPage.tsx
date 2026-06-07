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
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";

const statusLabels: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  open: "进行中",
  closed: "已结束",
  archived: "已归档",
};

function StatusBadge({ status }: { status: string }) {
  const label = statusLabels[status] ?? status;
  if (status === "open")
    return (
      <Badge className="bg-success/10 text-success hover:bg-success/20">
        {label}
      </Badge>
    );
  if (status === "published")
    return (
      <Badge className="bg-primary/10 text-primary hover:bg-primary/20">
        {label}
      </Badge>
    );
  if (status === "closed") return <Badge variant="secondary">{label}</Badge>;
  if (status === "archived") return <Badge variant="outline">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}

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
      <div className="space-y-6">
        <PageHeader title="仪表盘" />
        <ErrorState message={error} onRetry={loadDashboard} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
                        <Eye className="size-4" />
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

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-32" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-lg border p-6">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
      <div className="space-y-4">
        <Skeleton className="h-6 w-24" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
