import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { api } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { FileText } from "lucide-react";

/** Aggregate score statistics for an exam. */
interface ScoreListStats {
  averageScore: number;
  maxScore: number;
  minScore: number;
  passRate: number;
  totalGraded: number;
}

/** A single candidate's score record for an exam attempt. */
interface ScoreListItem {
  attemptId: string;
  candidateId: string;
  candidateName: string;
  candidateFields: Record<string, unknown>;
  examId: string;
  examTitle: string;
  score: number;
  passed: boolean;
  attemptNo: number;
  submittedAt?: string;
}

/** Paginated response containing score items and aggregate stats. */
interface ScoreListResponse {
  items: ScoreListItem[];
  stats: ScoreListStats;
  total: number;
  page: number;
  pageSize: number;
}

/** Admin page for viewing per-candidate scores, stats, and pass/fail filters for a specific exam. */
export function ScoreListPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [scores, setScores] = useState<ScoreListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const page = parseInt(searchParams.get("page") || "1", 10);
  const passFilter = (searchParams.get("passFilter") || "all") as
    | "all"
    | "passed"
    | "failed";

  /** Fetches the score list for the current exam with pagination and pass filter. */
  const loadScores = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("passFilter", passFilter);
      const data = await api.get<ScoreListResponse>(
        `/api/exams/${id}/scores?${params.toString()}`,
      );
      setScores(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载成绩列表失败";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [id, page, passFilter]);

  /** Downloads the scores CSV via the authenticated blob helper (cookie auth). */
  const exportScores = useCallback(async () => {
    if (!id || exporting) return;
    setExporting(true);
    try {
      await downloadFile(
        `/api/exams/${id}/export/scores`,
        `scores-exam-${id}.csv`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? `导出失败：${err.message}`
          : "导出失败，请稍后重试",
      );
    } finally {
      setExporting(false);
    }
  }, [id, exporting]);

  useEffect(() => {
    loadScores();
  }, [loadScores]);

  if (isLoading) return <LoadingState />;
  if (error)
    return (
      <ErrorState
        message={error}
        onRetry={loadScores}
        extraAction={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void navigate("/admin/results")}
          >
            返回成绩查询
          </Button>
        }
      />
    );
  if (!scores)
    return (
      <ErrorState message="成绩数据加载异常，请重试" onRetry={loadScores} />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${scores.items[0]?.examTitle || "考试"} - 成绩管理`}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void exportScores()}
              disabled={exporting}
            >
              {exporting ? "导出中..." : "导出CSV"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void navigate(`/admin/exams/${id}`)}
            >
              返回考试详情
            </Button>
          </div>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              平均分
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {scores.stats.averageScore.toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              最高分
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{scores.stats.maxScore}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              最低分
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{scores.stats.minScore}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              及格率
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {(scores.stats.passRate * 100).toFixed(1)}%
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              已评分
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{scores.stats.totalGraded}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <Tabs
              defaultValue={passFilter}
              onValueChange={(v) => {
                const newParams = new URLSearchParams(searchParams);
                newParams.set("passFilter", v);
                newParams.delete("page");
                setSearchParams(newParams);
              }}
            >
              <TabsList>
                <TabsTrigger value="all">全部</TabsTrigger>
                <TabsTrigger value="passed">及格</TabsTrigger>
                <TabsTrigger value="failed">不及格</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* Scores Table */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">成绩列表</CardTitle>
        </CardHeader>
        <CardContent>
          {scores.items.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-12" />}
              title="暂无成绩"
              description="该考试暂未有已评分的答卷"
            />
          ) : (
            <div className="flex flex-col gap-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>考生姓名</TableHead>
                    <TableHead>考生信息</TableHead>
                    <TableHead>成绩</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>提交时间</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scores.items.map((item) => (
                    <TableRow key={item.attemptId}>
                      <TableCell className="font-medium">
                        {item.candidateName}
                      </TableCell>
                      <TableCell>
                        {Object.values(item.candidateFields)
                          .map(String)
                          .join(" / ") || "-"}
                      </TableCell>
                      <TableCell className="font-bold">{item.score}</TableCell>
                      <TableCell>
                        <StatusBadge
                          status={item.passed ? "passed" : "not_passed"}
                        />
                      </TableCell>
                      <TableCell>
                        {item.submittedAt
                          ? new Date(item.submittedAt).toLocaleString()
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void navigate(`/admin/attempts/${item.attemptId}`)
                          }
                        >
                          查看详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {scores.total > scores.pageSize && (
                <Pagination>
                  <PaginationContent>
                    {page > 1 && (
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => {
                            const newParams = new URLSearchParams(searchParams);
                            newParams.set("page", String(page - 1));
                            setSearchParams(newParams);
                          }}
                        />
                      </PaginationItem>
                    )}
                    {Array.from(
                      { length: Math.ceil(scores.total / scores.pageSize) },
                      (_, i) => i + 1,
                    ).map((p) => (
                      <PaginationItem key={p}>
                        <PaginationLink
                          isActive={p === page}
                          onClick={() => {
                            const newParams = new URLSearchParams(searchParams);
                            newParams.set("page", String(p));
                            setSearchParams(newParams);
                          }}
                        >
                          {p}
                        </PaginationLink>
                      </PaginationItem>
                    ))}
                    {page < Math.ceil(scores.total / scores.pageSize) && (
                      <PaginationItem>
                        <PaginationNext
                          onClick={() => {
                            const newParams = new URLSearchParams(searchParams);
                            newParams.set("page", String(page + 1));
                            setSearchParams(newParams);
                          }}
                        />
                      </PaginationItem>
                    )}
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
