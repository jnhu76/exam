import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Gauge, Eye } from "lucide-react";

/** Exam row shape as returned by the exams list API, including score-view permissions. */
interface ExamRow {
  id: string;
  title: string;
  status: string;
  openAt: string;
  closeAt: string;
  passingScore: number;
  totalScore: number;
  gradedAttemptCount: number;
  canViewScores: boolean;
  scoreViewDisabledReason: string | null;
}

/** Admin page for browsing published/closed exams and navigating to their score lists. */
export function ResultsOverviewPage() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fetches exams and filters to those whose scores may be viewable. */
  const loadExams = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<{ items: ExamRow[] }>("/api/exams");
      const visible = data.items.filter(
        (e) =>
          e.status === "published" ||
          e.status === "open" ||
          e.status === "closed" ||
          e.status === "archived",
      );
      setExams(visible);
    } catch {
      setError("加载考试列表失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadExams();
  }, [loadExams]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadExams} />;

  /** Returns whether the admin can view scores for the given exam. */
  function gradable(exam: ExamRow) {
    return exam.canViewScores;
  }

  /** Returns the reason why scores cannot be viewed, or empty string if allowed. */
  function gradableReason(exam: ExamRow) {
    return exam.scoreViewDisabledReason ?? "";
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        <PageHeader title="成绩查询" />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">成绩管理</CardTitle>
          </CardHeader>
          <CardContent>
            {exams.length === 0 ? (
              <EmptyState
                icon={<Gauge className="size-12" />}
                title="暂无相关考试"
                description="已结束、已归档或进行中的考试将显示在此处"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>考试名称</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>考试时间</TableHead>
                    <TableHead>已评分</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exams.map((exam) => {
                    const canView = gradable(exam);
                    const reason = gradableReason(exam);
                    const viewButton = (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canView}
                        onClick={() =>
                          void navigate(routes.admin.examScores(exam.id))
                        }
                      >
                        <Eye data-icon="inline-start" />
                        查看成绩
                      </Button>
                    );
                    return (
                      <TableRow key={exam.id}>
                        <TableCell className="font-medium">
                          {exam.title}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={exam.status} />
                        </TableCell>
                        <TableCell>
                          {exam.openAt
                            ? new Date(exam.openAt).toLocaleString()
                            : "-"}
                        </TableCell>
                        <TableCell>{exam.gradedAttemptCount ?? 0}</TableCell>
                        <TableCell>
                          {canView ? (
                            viewButton
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span tabIndex={0}>{viewButton}</span>
                              </TooltipTrigger>
                              <TooltipContent>{reason}</TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
