import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { TYPE_LABELS } from "@/lib/constants";

interface QuestionResult {
  questionId: string;
  score: number;
  maxScore: number;
  correct: boolean;
  candidateAnswer: unknown;
  standardAnswer: unknown;
  type: string;
  content: string;
  order: number;
}

interface VisibleAttemptResult {
  attemptId: string;
  status: "graded";
  showResultImmediately: true;
  examTitle: string;
  passingScore: number;
  totalScore: number;
  passed: boolean;
  gradedAt: string;
  questionResults: QuestionResult[];
}

type AttemptResultResponse =
  | VisibleAttemptResult
  | {
      attemptId: string;
      status: string;
      showResultImmediately: false;
      examTitle: string;
    };

function formatAnswer(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function AttemptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<VisibleAttemptResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadResult = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<AttemptResultResponse>(
        `/api/scores/attempts/${id}`,
      );
      if (data.showResultImmediately === true) {
        setResult(data);
      } else {
        setError(
          data.status === "submitted"
            ? "该尝试已提交，等待评分"
            : data.status === "grading"
              ? "该尝试正在评分中"
              : data.status === "graded"
                ? "该尝试已评分，但成绩尚未公布"
                : data.status === "disrupted"
                  ? "该尝试答题中断，尚未提交"
                  : "该尝试尚未完成评分或结果不可见",
        );
      }
    } catch {
      setError("加载尝试详情失败");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadResult();
  }, [loadResult]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadResult} />;
  if (!result) return null;

  const sortedQuestions = [...result.questionResults].sort(
    (a, b) => a.order - b.order,
  );
  const earnedScore = sortedQuestions.reduce((sum, q) => sum + q.score, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${result.examTitle} - 答卷详情`}
        actions={
          <Button variant="outline" onClick={() => void navigate(-1)}>
            返回
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">成绩概览</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-sm text-muted-foreground">总分</p>
              <p className="text-3xl font-bold tabular-nums">
                {result.totalScore}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">得分</p>
              <p
                data-testid="earned-score"
                className={`text-3xl font-bold tabular-nums ${result.passed ? "text-success" : "text-destructive"}`}
              >
                {earnedScore}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">及格线</p>
              <p className="text-3xl font-bold tabular-nums">
                {result.passingScore}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">状态</p>
              <StatusBadge
                status={result.passed ? "passed" : "not_passed"}
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">答题详情</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">题号</TableHead>
                <TableHead>题目</TableHead>
                <TableHead>题型</TableHead>
                <TableHead>考生答案</TableHead>
                <TableHead>标准答案</TableHead>
                <TableHead className="text-right">得分</TableHead>
                <TableHead className="text-right">满分</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedQuestions.map((q) => (
                <TableRow key={q.questionId}>
                  <TableCell className="font-medium">{q.order}</TableCell>
                  <TableCell className="max-w-md truncate" title={q.content}>
                    {q.content}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {TYPE_LABELS[q.type] ?? q.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={q.correct ? "default" : "destructive"}>
                      {formatAnswer(q.candidateAnswer)}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatAnswer(q.standardAnswer)}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {q.score}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {q.maxScore}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
