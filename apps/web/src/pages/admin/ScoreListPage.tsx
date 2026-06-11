import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { FileText } from "lucide-react";

interface ScoreListStats {
  averageScore: number;
  maxScore: number;
  minScore: number;
  passRate: number;
  totalGraded: number;
}

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

interface ScoreListResponse {
  items: ScoreListItem[];
  stats: ScoreListStats;
  total: number;
  page: number;
  pageSize: number;
}

export function ScoreListPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [scores, setScores] = useState<ScoreListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const page = parseInt(searchParams.get("page") || "1", 10);
  const passFilter = (searchParams.get("passFilter") || "all") as
    | "all"
    | "passed"
    | "failed";

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
  if (!scores) return null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${scores.items[0]?.examTitle || "考试"} - 成绩管理`}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                // Download CSV
                const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
                const url = `${baseUrl}/api/exams/${id}/export/scores`;
                const a = document.createElement("a");
                a.href = url;
                a.target = "_blank";
                a.click();
              }}
            >
              导出CSV
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
            <div className="w-full md:w-64">
              <Input placeholder="搜索考生..." />
            </div>
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
                        <Badge
                          className={
                            item.passed
                              ? "bg-success/10 text-success hover:bg-success/20"
                              : "bg-destructive/10 text-destructive hover:bg-destructive/20"
                          }
                        >
                          {item.passed ? "及格" : "不及格"}
                        </Badge>
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
