import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
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
 * Validates a manual grading score against the question's max score.
 * Error messages resolve from `admin.gradingDetail.validation.*` via the
 * default i18n instance so the exported helper stays usable outside React.
 * Returns null when the score is valid.
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
  const [scores, setScores] = useState<Record<string, number>>({});
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
      const initialScores: Record<string, number> = {};
      const initialComments: Record<string, string> = {};
      for (const q of result.questions) {
        initialScores[q.questionId] = q.entry?.score ?? 0;
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
      const score = scores[questionId] ?? 0;
      const err = validateScore(score, maxScore);
      if (err) {
        setValidationErrors((prev) => ({ ...prev, [questionId]: err }));
        return;
      }
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
            <ArrowLeft className="mr-2 size-4" />
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
                    [q.questionId]: Number(e.target.value),
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
