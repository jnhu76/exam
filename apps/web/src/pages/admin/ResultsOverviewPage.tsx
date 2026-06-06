import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Gauge, Eye } from "lucide-react";

interface ExamRow {
  id: string;
  title: string;
  status: string;
  openAt: string;
  closeAt: string;
  passingScore: number;
  totalScore: number;
  attemptCount: number;
}

export function ResultsOverviewPage() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadExams = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<{ items: ExamRow[] }>("/api/exams");
      const gradable = data.items.filter(
        (e) =>
          e.status === "published" ||
          e.status === "closed" ||
          e.status === "archived",
      );
      setExams(gradable);
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

  return (
    <div className="space-y-6">
      <PageHeader title="成绩查询" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">可查询成绩的考试</CardTitle>
        </CardHeader>
        <CardContent>
          {exams.length === 0 ? (
            <EmptyState
              icon={<Gauge className="size-12" />}
              title="暂无可查询的考试"
              description="已发布或已结束的考试将显示在此处"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>考试名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>考试时间</TableHead>
                  <TableHead>考试人次</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exams.map((exam) => (
                  <TableRow key={exam.id}>
                    <TableCell className="font-medium">{exam.title}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          exam.status === "published" ? "default" : "secondary"
                        }
                      >
                        {exam.status === "published"
                          ? "进行中"
                          : exam.status === "closed"
                            ? "已结束"
                            : "已归档"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {exam.openAt
                        ? new Date(exam.openAt).toLocaleString()
                        : "-"}
                    </TableCell>
                    <TableCell>{exam.attemptCount ?? 0}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void navigate(routes.admin.examScores(exam.id))
                        }
                      >
                        <Eye className="size-4 mr-1" />
                        查看成绩
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
