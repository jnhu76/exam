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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useProductDateTime } from "@/contexts/DateTimeContext";
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
  const { formatDateTime } = useProductDateTime();
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
  // Confirmation dialog target: holds the validated question awaiting the
  // operator's explicit "confirm submit". The dialog is the gate before any
  // irrevocable POST — see handleSubmitClick / submitScore.
  const [confirmTarget, setConfirmTarget] = useState<{
    questionId: string;
    score: number;
    maxScore: number;
  } | null>(null);

  /**
   * Re-fetches the authoritative grading-details and replaces ALL local state
   * (data, scores, comments) from the server response. Used both for the
   * initial load and for the post-POST reconciliation, so the page never shows
   * a client-fabricated gradedBy/gradedAt/terminal state — it always reflects
   * what the server committed.
   */
  const refreshFromServer =
    useCallback(async (): Promise<GradingDetailData | null> => {
      if (!id) return null;
      const result = await api.get<GradingDetailData>(
        `/api/admin/attempts/${id}/grading-details`,
      );
      setData(result);
      const nextScores: Record<string, string> = {};
      const nextComments: Record<string, string> = {};
      for (const q of result.questions) {
        nextScores[q.questionId] = q.entry != null ? String(q.entry.score) : "";
        nextComments[q.questionId] = q.entry?.comment ?? "";
      }
      setScores(nextScores);
      setComments(nextComments);
      return result;
    }, [id]);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      await refreshFromServer();
    } catch {
      setError(t("admin.gradingDetail.errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [id, t, refreshFromServer]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  /**
   * Click handler for the "提交评分" button. Validates the raw score input and,
   * on success, opens the confirmation dialog instead of POSTing directly. The
   * dialog's confirm action runs {@link submitScore}. On a validation error the
   * field-level error is set and no dialog/POST happens.
   */
  const handleSubmitClick = useCallback(
    (questionId: string, maxScore: number) => {
      const parsed = parseScoreInput(scores[questionId] ?? "", maxScore);
      if ("error" in parsed) {
        setValidationErrors((prev) => ({
          ...prev,
          [questionId]: parsed.error,
        }));
        return;
      }
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
      setConfirmTarget({
        questionId,
        score: parsed.score,
        maxScore,
      });
    },
    [scores],
  );

  /**
   * Performs the irrevocable POST, then refreshes local state from the
   * authoritative GET so the submitted question immediately reflects the
   * server-committed entry (score, comment, gradedBy, gradedAt, read-only
   * state). The page must NOT fabricate gradedBy/gradedAt client-side.
   */
  const submitScore = useCallback(
    async (questionId: string, score: number, maxScore: number) => {
      setConfirmTarget(null);
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
        // Authoritative reconciliation: replace local state from the server so
        // the just-graded question becomes read-only with the real gradedBy /
        // gradedAt, and the top-level gradingStatus reflects the committed
        // terminal projection.
        const refreshed = await refreshFromServer();
        if (refreshed && result.fullyGraded) {
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
    [id, comments, t, refreshFromServer],
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

  const isFullyGraded = data.gradingStatus === "fully_graded";

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
      {isFullyGraded ? (
        <div
          role="status"
          data-testid="grading-fully-graded-notice"
          className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
        >
          {t("admin.gradingDetail.fullyGradedNotice")}
        </div>
      ) : (
        <div
          role="note"
          data-testid="grading-irrevocable-notice"
          className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
        >
          {t("admin.gradingDetail.irrevocableNotice")}
        </div>
      )}
      {data.questions.map((q) => {
        // A question is read-only once its entry is completed_manual, OR once
        // the whole attempt has reached the terminal fully_graded state (every
        // question is then committed). Either way: no submit button, inputs
        // disabled, and the committed entry metadata is shown.
        const completed = q.entry !== null || isFullyGraded;
        return (
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
                <Label>
                  {t("admin.gradingDetail.question.candidateAnswer")}
                </Label>
                <div
                  data-testid={`grading-candidate-answer-${q.questionId}`}
                  className="type-long-response min-h-16 rounded-md border bg-muted/30 p-3"
                >
                  {formatAnswer(q.candidateAnswer)}
                </div>
              </div>
              <div className="space-y-2">
                <Label>
                  {t("admin.gradingDetail.question.standardAnswer")}
                </Label>
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
                  disabled={completed}
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
                  disabled={completed}
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
              {completed ? (
                <div
                  className="space-y-1 text-sm text-muted-foreground"
                  data-testid={`grading-submitted-meta-${q.questionId}`}
                >
                  <div className="font-medium text-foreground">
                    {t("admin.gradingDetail.question.submittedLabel")}
                  </div>
                  <div>
                    {t("admin.gradingDetail.question.gradedLabel", {
                      score: q.entry?.score ?? 0,
                    })}
                  </div>
                  {q.entry?.comment ? (
                    <div
                      data-testid={`grading-submitted-comment-${q.questionId}`}
                    >
                      {q.entry.comment}
                    </div>
                  ) : null}
                  {/* gradedBy may currently be only an actor id; show the value
                      the server committed without fabricating a display name. */}
                  <div data-testid={`grading-submitted-grader-${q.questionId}`}>
                    {t("admin.gradingDetail.question.gradedBy", {
                      grader: q.entry?.gradedBy ?? "",
                    })}
                  </div>
                  {q.entry?.gradedAt ? (
                    <div data-testid={`grading-submitted-time-${q.questionId}`}>
                      {t("admin.gradingDetail.question.gradedAt", {
                        time: formatDateTime(q.entry.gradedAt),
                      })}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    data-testid={`grading-submit-btn-${q.questionId}`}
                    onClick={() => handleSubmitClick(q.questionId, q.maxScore)}
                    disabled={saving[q.questionId]}
                  >
                    {saving[q.questionId]
                      ? t("admin.gradingDetail.question.submitting")
                      : t("admin.gradingDetail.question.submit")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      {/* Single controlled confirmation dialog. Opened by handleSubmitClick once
          the score validates; the confirm action runs the irrevocable POST. */}
      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.gradingDetail.confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.gradingDetail.confirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                {t("admin.gradingDetail.confirm.score", {
                  score: confirmTarget?.score ?? 0,
                })}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                {t("admin.gradingDetail.confirm.maxScore", {
                  score: confirmTarget?.maxScore ?? 0,
                })}
              </span>
            </div>
            <div className="text-muted-foreground">
              {t("admin.gradingDetail.confirm.irrevocable")}
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("admin.gradingDetail.confirm.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!confirmTarget}
              onClick={() => {
                if (confirmTarget) {
                  void submitScore(
                    confirmTarget.questionId,
                    confirmTarget.score,
                    confirmTarget.maxScore,
                  );
                }
              }}
            >
              {t("admin.gradingDetail.confirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
