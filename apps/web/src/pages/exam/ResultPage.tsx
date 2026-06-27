import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import type { AttemptResultResponse } from "@exam/contracts";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Formats an answer value into a human-readable Chinese string. */
function formatAnswer(answer: unknown): string {
  if (answer === undefined || answer === null || answer === "") return "未作答";
  if (typeof answer === "string") return answer;
  if (typeof answer === "boolean") return answer ? "正确" : "错误";
  if (Array.isArray(answer)) return answer.join("、");
  if (typeof answer === "object") {
    return Object.values(answer as Record<string, unknown>)
      .map(formatAnswer)
      .join("、");
  }
  return String(answer);
}

/** Maps a question type key to its Chinese display label. */
function formatQuestionType(type: string): string {
  const labels: Record<string, string> = {
    single_choice: "单选题",
    multiple_choice: "多选题",
    true_false: "判断题",
    fill_blank: "填空题",
  };
  return labels[type] ?? type;
}

/** Renders an answer value as text, with optional truncation for long fill-blank answers. */
function AnswerText({
  answer,
  truncate,
}: {
  answer: unknown;
  truncate?: boolean;
}) {
  const text = formatAnswer(answer);
  return (
    <span className={truncate ? "block max-w-48 truncate" : ""} title={text}>
      {text}
    </span>
  );
}

/** Displays the scored result of a single exam attempt, including per-question breakdown or a pending-status message. */
export function ResultPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<AttemptResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Fetches the attempt result from the scores API. */
  const loadResult = useCallback(async () => {
    if (!attemptId) return;
    setError(null);
    try {
      setResult(
        await api.get<AttemptResultResponse>(
          `/api/scores/attempts/${attemptId}`,
        ),
      );
    } catch {
      setError("加载成绩失败");
    }
  }, [attemptId]);

  useEffect(() => {
    void loadResult();
  }, [loadResult]);

  if (error) return <ErrorState message={error} onRetry={loadResult} />;
  if (!result) return <LoadingState />;

  return (
    <div className="mx-auto max-w-5xl flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{result.examTitle}</h1>

      {result.showResultImmediately ? (
        <>
          <Card className="rounded-[var(--admin-radius)] border-admin-border shadow-none">
            <CardHeader>
              <CardTitle>考试成绩</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-center">
              <p
                className="text-5xl font-bold"
                data-testid="result-total-score"
              >
                {result.totalScore}
              </p>
              <p className="text-sm text-muted-foreground">
                及格线：{result.passingScore}
              </p>
              <p
                className={
                  result.passed
                    ? "font-medium text-success"
                    : "font-medium text-destructive"
                }
              >
                {result.passed ? "已通过" : "未通过"}
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-[var(--admin-radius)] border-admin-border shadow-none">
            <CardHeader>
              <CardTitle>答题明细</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>题号</TableHead>
                    <TableHead>题目</TableHead>
                    <TableHead>题型</TableHead>
                    <TableHead>你的答案</TableHead>
                    <TableHead>正确答案</TableHead>
                    <TableHead>得分</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.questionResults.map((question) => {
                    const isManual = question.standardAnswer == null;
                    return (
                      <TableRow key={question.questionId}>
                        <TableCell>{question.order + 1}</TableCell>
                        <TableCell>{question.content}</TableCell>
                        <TableCell>
                          {formatQuestionType(question.type)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {question.correct ? (
                              <CheckCircle2
                                aria-label="回答正确"
                                className="size-4 text-success"
                              />
                            ) : (
                              <XCircle
                                aria-label="回答错误"
                                className="size-4 text-destructive"
                              />
                            )}
                            <AnswerText
                              answer={question.candidateAnswer}
                              truncate={question.type === "fill_blank"}
                            />
                          </div>
                        </TableCell>
                        <TableCell
                          data-testid={
                            isManual
                              ? `result-question-manual-${question.questionId}`
                              : undefined
                          }
                        >
                          {isManual ? (
                            <span className="text-muted-foreground">
                              主观题
                            </span>
                          ) : (
                            <AnswerText
                              answer={question.standardAnswer}
                              truncate={question.type === "fill_blank"}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {question.score}/{question.maxScore}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : (
        <Alert variant="default" className="py-10 text-center border-0">
          <CheckCircle2
            className="mx-auto mb-3 size-10 text-success"
            aria-hidden="true"
          />
          <AlertDescription
            className="text-lg font-medium"
            data-testid="result-status-message"
          >
            {(() => {
              const reason = result.hiddenReason;
              if (reason === "pending_publish")
                return "成绩正在审核中，将在公布后可见";
              if (reason === "not_graded") return "考试尚未完成评分，请等待";
              if (reason === "not_started") return "考试尚未开始，暂无成绩";
              if (result.status === "submitted") return "已提交，等待评分";
              if (result.status === "grading") return "正在评分";
              if (result.status === "graded") return "成绩尚未公布";
              if (result.status === "disrupted")
                return "答题中断，请联系管理员或重新进入";
              return "已交卷，等待成绩公布";
            })()}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button onClick={() => navigate(routes.exam.list)}>返回考试列表</Button>
      </div>
    </div>
  );
}
