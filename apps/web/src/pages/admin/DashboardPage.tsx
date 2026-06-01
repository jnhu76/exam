import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import type { DashboardResponse } from "@exam/contracts";
import { api } from "@/lib/api";
import { StatsCard } from "@/components/shared/StatsCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
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
import { ClipboardList, Eye } from "lucide-react";

const statusLabels: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  open: "进行中",
  closed: "已结束",
  archived: "已归档",
};

const statusVariant: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  published: "default",
  open: "default",
  closed: "secondary",
  archived: "outline",
};

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
        <h1 className="text-2xl font-bold">仪表盘</h1>
        <p className="text-sm text-destructive">{error}</p>
        <Button onClick={loadDashboard} variant="outline">
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">仪表盘</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="题目总数" value={data?.totalQuestions ?? 0} />
        <StatsCard label="考试进行中" value={data?.activeExams ?? 0} />
        <StatsCard label="考生总数" value={data?.totalCandidates ?? 0} />
        <StatsCard label="今日考试" value={data?.todayExams ?? 0} />
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">近期考试</h2>
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
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentExams.map((exam) => (
                <TableRow key={exam.id}>
                  <TableCell className="font-medium">{exam.title}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[exam.status] ?? "outline"}>
                      {statusLabels[exam.status] ?? exam.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{exam.participantCount}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
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
      </div>
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
