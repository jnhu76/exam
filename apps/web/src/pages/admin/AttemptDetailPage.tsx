import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
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
      if (data.showResultImmediately) {
        setResult(data);
      } else {
        setError("该尝试尚未完成评分或结果不可见");
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${result.examTitle} - 答卷详情`}
        actions={
          <Button variant="outline" onClick={() => void navigate(-1)}>
            返回
          </Button>
        }
      />

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">成绩概览</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">总分</p>
              <p className="text-3xl font-bold">{result.totalScore}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">得分</p>
              <p
                className={`text-3xl font-bold ${result.passed ? "text-green-600" : "text-red-600"}`}
              >
                {result.totalScore}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">及格线</p>
              <p className="text-3xl font-bold">{result.passingScore}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">状态</p>
              <Badge
                variant={result.passed ? "default" : "destructive"}
                className="text-sm mt-1"
              >
                {result.passed ? "及格" : "不及格"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Answers */}
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
              {result.questionResults
                .sort((a, b) => a.order - b.order)
                .map((q) => (
                  <TableRow key={q.questionId}>
                    <TableCell className="font-medium">{q.order}</TableCell>
                    <TableCell className="max-w-md truncate" title={q.content}>
                      {q.content}
                    </TableCell>
                    <TableCell>
                      {q.type === "single_choice"
                        ? "单选题"
                        : q.type === "multiple_choice"
                          ? "多选题"
                          : q.type === "fill_blank"
                            ? "填空题"
                            : q.type === "true_false"
                              ? "判断题"
                              : q.type}
                    </TableCell>
                    <TableCell>
                      <Badge variant={q.correct ? "default" : "destructive"}>
                        {typeof q.candidateAnswer === "string"
                          ? q.candidateAnswer
                          : Array.isArray(q.candidateAnswer)
                            ? q.candidateAnswer.join(", ")
                            : String(q.candidateAnswer)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {typeof q.standardAnswer === "string"
                        ? q.standardAnswer
                        : Array.isArray(q.standardAnswer)
                          ? q.standardAnswer.join(", ")
                          : String(q.standardAnswer)}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {q.score}
                    </TableCell>
                    <TableCell className="text-right">{q.maxScore}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
