import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { AppIcon } from "@/components/shared/AppIcon";
import { ErrorState } from "@/components/shared/ErrorState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/shared/FieldError";
import { ArrowLeft } from "lucide-react";

/**
 * Validates a parsed manual grading score against the question's max score.
 * Error messages resolve from `admin.gradingDetail.validation.*` via the
 * default i18n instance so the exported helper stays usable outside React.
 * Returns null when the score is valid.
 *
 * Note: a score of `0` is valid here. The "no input yet" state is represented
 * by an empty input string and rejected by {@link parseScoreInput} before this
 * function is ever called, so an explicit zero is never conflated with "not
 * graded".
 */
export function validateScore(score: number, maxScore: number): string | null {
  if (score < 0)
    return i18n.t("admin.gradingDetail.validation.scoreNegative" as never);
  if (score > maxScore)
    return i18n.t("admin.gradingDetail.validation.scoreExceedsMax", {
      max: maxScore,
    });
  return null;
}

/**
 * Parses a raw score input string into a numeric score, enforcing that the
 * operator has entered an explicit value. The input is the single source of
 * truth for "graded or not":
 *
 *   - empty string  → "not graded yet" (rejected as scoreRequired)
 *   - "0"           → an explicit zero score (valid)
 *   - positive int  → valid
 *   - non-finite    → rejected (e.g. "abc" → NaN, or "-5" caught by validateScore)
 *
 * Returns `{ score }` on success, or `{ error }` with an i18n message. This is
 * deliberately separate from {@link validateScore} because parse-failure and
 * range-failure are different states and the empty-input case must NOT be
 * collapsed into `0` (the original `q.entry?.score ?? 0` bug).
 */
export function parseScoreInput(
  raw: string,
  maxScore: number,
): { score: number } | { error: string } {
  if (raw.trim() === "") {
    return {
      error: i18n.t("admin.gradingDetail.validation.scoreRequired" as never),
    };
  }
  const score = Number(raw);
  if (!Number.isFinite(score)) {
    return {
      error: i18n.t("admin.gradingDetail.validation.scoreRequired" as never),
    };
  }
  const rangeError = validateScore(score, maxScore);
  if (rangeError) return { error: rangeError };
  return { score };
}

function formatAnswer(answer: unknown): string {
  if (answer === undefined || answer === null || answer === "")
    return i18n.t("admin.gradingDetail.format.unanswered" as never);
  if (typeof answer === "string") return answer;
  if (typeof answer === "boolean")
    return answer
      ? i18n.t("admin.gradingDetail.format.correct" as never)
      : i18n.t("admin.gradingDetail.format.incorrect" as never);
  if (Array.isArray(answer)) return answer.join("、");
  if (typeof answer === "object") {
    return Object.values(answer as Record<string, unknown>)
      .map(formatAnswer)
      .join("、");
  }
  return String(answer);
}

/**
 * Formats the frozen standardAnswer for the grader. A null/empty reference
 * answer renders as "未设置" (not set) — distinct from the candidate's
 * "未作答" (unanswered) label, because a missing reference answer is a
 * question-authoring state, not a candidate omission.
 *
 * standardAnswer is typed `unknown` on the wire (z.unknown()). Production
 * objective types are flat primitives/arrays of option-id strings, but the
 * schema admits arbitrary structures, so a non-primitive is serialized to
 * readable JSON rather than left to `String()` (which would render
 * `[object Object]`).
 */
function formatStandardAnswer(answer: unknown): string {
  if (answer === undefined || answer === null || answer === "")
    return i18n.t("admin.gradingDetail.format.notSet" as never);
  if (typeof answer === "object") {
    try {
      return JSON.stringify(answer, null, 2);
    } catch {
      return String(answer);
    }
  }
  return formatAnswer(answer);
}

interface GradingEntry {
  score: number;
  comment: string;
  gradedBy: string;
  gradedAt: string;
}

interface GradingQuestion {
  questionId: string;
  type: string;
  content: string;
  maxScore: number;
  standardAnswer: unknown;
  rubric: string | null;
  candidateAnswer: unknown;
  entry: GradingEntry | null;
}

interface GradingDetailData {
  attemptId: string;
  examId: string;
  examTitle: string;
  candidateId: string;
  candidateName: string;
  gradingStatus: string;
  questions: GradingQuestion[];
}

interface GradeQuestionResponse {
  attemptId: string;
  gradingStatus: string;
  questionId: string;
  score: number;
  fullyGraded: boolean;
}

export function GradingDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<GradingDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Scores are kept as raw input strings so that "not graded yet" (empty) is
  // distinct from "explicitly scored 0". An already-completed entry renders its
  // stored numeric score as a string; a pending entry renders "".
  const [scores, setScores] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.get<GradingDetailData>(
        `/api/admin/attempts/${id}/grading-details`,
      );
      setData(result);
      const initialScores: Record<string, string> = {};
      const initialComments: Record<string, string> = {};
      for (const q of result.questions) {
        // Pending question → empty input (NOT 0). Completed question → the
        // submitted score, including an explicit 0, rendered as a string.
        initialScores[q.questionId] =
          q.entry != null ? String(q.entry.score) : "";
        initialComments[q.questionId] = q.entry?.comment ?? "";
      }
      setScores(initialScores);
      setComments(initialComments);
    } catch {
      setError(t("admin.gradingDetail.errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const handleSave = useCallback(
    async (questionId: string, maxScore: number) => {
      const parsed = parseScoreInput(scores[questionId] ?? "", maxScore);
      if ("error" in parsed) {
        setValidationErrors((prev) => ({
          ...prev,
          [questionId]: parsed.error,
        }));
        return;
      }
      const { score } = parsed;
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
      setSaving((prev) => ({ ...prev, [questionId]: true }));
      try {
        const result = await api.post<GradeQuestionResponse>(
          `/api/admin/attempts/${id}/grade-question`,
          {
            questionId,
            score,
            comment: comments[questionId] ?? "",
          },
        );
        setData((prev) =>
          prev ? { ...prev, gradingStatus: result.gradingStatus } : prev,
        );
        if (result.fullyGraded) {
          toast.success(t("admin.gradingDetail.toast.fullyGraded"));
        } else {
          toast.success(t("admin.gradingDetail.toast.saved"));
        }
      } catch {
        toast.error(t("admin.gradingDetail.errors.saveFailed"));
      } finally {
        setSaving((prev) => ({ ...prev, [questionId]: false }));
      }
    },
    [id, scores, comments, t],
  );

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadDetail} />;
  if (!data)
    return (
      <ErrorState
        message={t("admin.gradingDetail.errors.dataLoadFailed")}
        onRetry={loadDetail}
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.gradingDetail.title")}
        description={`${data.examTitle} — ${data.candidateName}`}
        actions={
          <Button
            variant="ghost"
            onClick={() => navigate("/admin/grading-queue")}
          >
            <AppIcon icon={ArrowLeft} size="inline" className="mr-2" />
            {t("admin.gradingDetail.actions.backToQueue")}
          </Button>
        }
        status={<StatusBadge status={data.gradingStatus} />}
      />
      {data.questions.map((q) => (
        <Card key={q.questionId}>
          <CardHeader>
            <CardTitle className="text-base">{q.content}</CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                {t("admin.gradingDetail.question.maxScore", {
                  score: q.maxScore,
                })}
              </span>
              <span>·</span>
              <span>{t("admin.gradingDetail.question.subjective")}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("admin.gradingDetail.question.candidateAnswer")}</Label>
              <div
                data-testid={`grading-candidate-answer-${q.questionId}`}
                className="type-long-response min-h-16 rounded-md border bg-muted/30 p-3"
              >
                {formatAnswer(q.candidateAnswer)}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("admin.gradingDetail.question.standardAnswer")}</Label>
              <div
                data-testid={`grading-standard-answer-${q.questionId}`}
                className="min-h-12 rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap"
              >
                {formatStandardAnswer(q.standardAnswer)}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("admin.gradingDetail.question.rubric")}</Label>
              <div
                data-testid={`grading-rubric-${q.questionId}`}
                className="min-h-12 rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap"
              >
                {q.rubric ||
                  i18n.t("admin.gradingDetail.format.notSet" as never)}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`score-${q.questionId}`}>
                {t("admin.gradingDetail.question.scoreLabel")}
              </Label>
              <Input
                id={`score-${q.questionId}`}
                data-testid={`grading-score-input-${q.questionId}`}
                type="number"
                min={0}
                max={q.maxScore}
                value={scores[q.questionId] ?? ""}
                onChange={(e) =>
                  setScores((prev) => ({
                    ...prev,
                    [q.questionId]: e.target.value,
                  }))
                }
              />
              <FieldError>{validationErrors[q.questionId]}</FieldError>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`comment-${q.questionId}`}>
                {t("admin.gradingDetail.question.commentLabel")}
              </Label>
              <Textarea
                id={`comment-${q.questionId}`}
                data-testid={`grading-comment-input-${q.questionId}`}
                value={comments[q.questionId] ?? ""}
                onChange={(e) =>
                  setComments((prev) => ({
                    ...prev,
                    [q.questionId]: e.target.value,
                  }))
                }
                placeholder={t(
                  "admin.gradingDetail.question.commentPlaceholder",
                )}
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                data-testid={`grading-save-btn-${q.questionId}`}
                onClick={() => handleSave(q.questionId, q.maxScore)}
                disabled={saving[q.questionId]}
              >
                {saving[q.questionId]
                  ? t("admin.gradingDetail.question.saving")
                  : t("admin.gradingDetail.question.save")}
              </Button>
              {q.entry && (
                <span className="text-sm text-muted-foreground">
                  {t("admin.gradingDetail.question.gradedLabel", {
                    score: q.entry.score,
                  })}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
