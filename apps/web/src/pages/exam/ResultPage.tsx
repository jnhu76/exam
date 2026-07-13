import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck, CircleX } from "lucide-react";
import { AppIcon } from "@/components/shared/AppIcon";
import { useNavigate, useParams } from "react-router";
import type { AttemptResultResponse } from "@exam/contracts";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
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

/** Formats an answer value into a human-readable string via i18n. */
function formatAnswer(answer: unknown, t: (key: string) => string): string {
  if (answer === undefined || answer === null || answer === "")
    return t("candidateResult.answer.unanswered");
  if (typeof answer === "string") return answer;
  if (typeof answer === "boolean")
    return answer
      ? t("candidateResult.answer.correct")
      : t("candidateResult.answer.incorrect");
  if (Array.isArray(answer)) return answer.join("、");
  if (typeof answer === "object") {
    return Object.values(answer as Record<string, unknown>)
      .map((v) => formatAnswer(v, t))
      .join("、");
  }
  return String(answer);
}

/** Maps a question type key to its i18n display label. */
function formatQuestionType(type: string, t: (key: string) => string): string {
  const key = `candidateResult.questionTypes.${type}`;
  const label = t(key);
  return label === key ? type : label;
}

/** Renders an answer value as text, with optional truncation for long fill-blank answers. */
function AnswerText({
  answer,
  truncate,
  t,
}: {
  answer: unknown;
  truncate?: boolean;
  t: (key: string) => string;
}) {
  const text = formatAnswer(answer, t);
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
  const { t } = useTranslation();
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
      setError(t("candidateResult.error.loadFailed"));
    }
  }, [attemptId, t]);

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
          <Card>
            <CardHeader>
              <CardTitle>{t("candidateResult.title")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-center">
              <p
                className="text-5xl font-bold"
                data-testid="result-total-score"
              >
                {result.totalScore}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("candidateResult.summary.passingScore", {
                  score: result.passingScore,
                })}
              </p>
              <p
                className={
                  result.passed
                    ? "font-medium text-success"
                    : "font-medium text-destructive"
                }
              >
                {result.passed
                  ? t("candidateResult.summary.passed")
                  : t("candidateResult.summary.failed")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("candidateResult.detail.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("candidateResult.table.questionNumber")}
                    </TableHead>
                    <TableHead>
                      {t("candidateResult.table.questionContent")}
                    </TableHead>
                    <TableHead>
                      {t("candidateResult.table.questionType")}
                    </TableHead>
                    <TableHead>
                      {t("candidateResult.table.yourAnswer")}
                    </TableHead>
                    <TableHead>
                      {t("candidateResult.table.correctAnswer")}
                    </TableHead>
                    <TableHead>{t("candidateResult.table.score")}</TableHead>
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
                          {formatQuestionType(
                            question.type,
                            t as (key: string) => string,
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {question.correct ? (
                              <AppIcon
                                icon={CircleCheck}
                                decorative={false}
                                label={t("candidateResult.aria.correct")}
                                size="inline"
                                className="text-success"
                              />
                            ) : (
                              <AppIcon
                                icon={CircleX}
                                decorative={false}
                                label={t("candidateResult.aria.incorrect")}
                                size="inline"
                                className="text-destructive"
                              />
                            )}
                            <AnswerText
                              answer={question.candidateAnswer}
                              truncate={question.type === "fill_blank"}
                              t={t as (key: string) => string}
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
                              {t("candidateResult.answer.manual")}
                            </span>
                          ) : (
                            <AnswerText
                              answer={question.standardAnswer}
                              truncate={question.type === "fill_blank"}
                              t={t as (key: string) => string}
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
        <Card>
          <CardContent className="py-10 text-center">
            <AppIcon
              icon={CircleCheck}
              size="state"
              className="mx-auto mb-3 text-success"
            />
            <p
              className="text-lg font-medium"
              data-testid="result-status-message"
            >
              {(() => {
                const reason = result.hiddenReason;
                if (reason === "pending_publish")
                  return t("candidateResult.status.pending_publish");
                if (reason === "not_graded")
                  return t("candidateResult.status.not_graded");
                if (reason === "not_started")
                  return t("candidateResult.status.not_started");
                if (result.status === "submitted")
                  return t("candidateResult.status.submitted");
                if (result.status === "grading")
                  return t("candidateResult.status.grading");
                if (result.status === "graded")
                  return t("candidateResult.status.graded");
                if (result.status === "disrupted")
                  return t("candidateResult.status.disrupted");
                return t("candidateResult.status.default");
              })()}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={() => navigate(routes.exam.list)}>
          {t("candidateResult.actions.backToList")}
        </Button>
      </div>
    </div>
  );
}
