import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { routes } from "@/lib/routes";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { PageSection } from "@/components/shared/PageSection";
import { AppIcon } from "@/components/shared/AppIcon";
import { PageContainer } from "@/components/shared/PageContainer";
import {
  TriangleAlert,
  Clock,
  FileText,
  Shield,
  LoaderCircle,
} from "lucide-react";
import type { CandidateExamDetailResponse } from "@exam/contracts";
import { trackExamEvent } from "@/lib/examTelemetry";

interface AttemptResponse {
  id: string;
  status: string;
  examId: string;
}

/** Pre-exam page that displays exam details and initiates or resumes an attempt. */
export function StartExamPage() {
  const { t } = useTranslation();
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<CandidateExamDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Fetches the candidate exam detail from the API. */
  const loadExam = useCallback(async () => {
    if (!examId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<CandidateExamDetailResponse>(
        `/api/candidate/exams/${examId}`,
      );
      setExam(data);
    } catch {
      setError(t("startExam.errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [examId, t]);

  useEffect(() => {
    loadExam();
  }, [loadExam]);

  /** Creates a new attempt via the API and navigates to the exam-taking page. */
  const enterExam = useCallback(async () => {
    if (!examId) return;
    setIsStarting(true);
    setError(null);
    try {
      const attempt = await api.post<AttemptResponse>(
        `/api/attempts/${examId}/start`,
      );
      trackExamEvent("exam_started", {}, { examId, attemptId: attempt.id });
      navigate(routes.exam.take(attempt.id));
    } catch (err) {
      trackExamEvent(
        "exam_start_failed",
        { errorCode: err instanceof ApiError ? err.code : "UNKNOWN" },
        { examId, level: "warn" },
      );
      let message: string = t("startExam.errors.startFailed");
      if (err instanceof ApiError) {
        switch (err.code) {
          case "MAX_ATTEMPTS_REACHED":
            message = t("startExam.errors.maxAttemptsReached");
            break;
          case "EXAM_ALREADY_PASSED":
            message = t("startExam.errors.alreadyPassed");
            break;
          case "EXAM_NOT_OPEN":
            message = t("startExam.errors.notOpen");
            break;
          default:
            message = getApiErrorMessage(err, t, message);
            break;
        }
      }
      setError(message);
      toast.error(message);
      setIsStarting(false);
    }
  }, [examId, navigate, t]);

  /** Handles the primary action: start a new attempt, resume an active one, or view results. */
  async function handleStart() {
    if (!exam) return;
    switch (exam.primaryAction) {
      case "resume":
        if (exam.activeAttemptId) {
          trackExamEvent(
            "attempt_resume_requested",
            {},
            {
              examId,
              attemptId: exam.activeAttemptId,
            },
          );
          navigate(routes.exam.take(exam.activeAttemptId));
        } else {
          await enterExam();
        }
        return;
      case "start":
        await enterExam();
        return;
      case "view_result":
        return;
      case "none":
      default:
        return;
    }
  }

  if (isLoading) return <LoadingState />;
  if (!exam) {
    return (
      <ErrorState
        message={error ?? t("startExam.errors.notFound")}
        onRetry={loadExam}
      />
    );
  }

  const hasActiveAttempt = Boolean(exam.activeAttemptId);
  const actionLabel = (() => {
    switch (exam.primaryAction) {
      case "resume":
        return t("startExam.actions.resume");
      case "start":
        return exam.currentAttempts > 0
          ? t("startExam.actions.retake")
          : t("startExam.actions.start");
      case "view_result":
        return t("startExam.actions.viewResult");
      default:
        return t("startExam.actions.start");
    }
  })();

  const inlineMessage = hasActiveAttempt
    ? t("startExam.inline.activeAttempt")
    : exam.availabilityStatus === "max_attempts_exhausted"
      ? t("startExam.inline.maxAttemptsExhausted")
      : exam.availabilityStatus === "graded" && exam.primaryAction === "start"
        ? t("startExam.inline.retakeAvailable")
        : error;

  return (
    <PageContainer role="candidate" className="flex flex-col gap-6">
      <h1 className="type-page-title">{exam.title}</h1>

      <PageSection
        title={t("startExam.info.title")}
        contentClassName="flex flex-col gap-3 text-sm"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="type-secondary flex items-center gap-2">
            <AppIcon icon={Clock} size="inline" />
            <span>{t("startExam.info.duration")}</span>
          </div>
          <span className="type-body">
            {/* Projection keys on the canonical timingMode — null duration is
             * real for deadline/untimed and must never be rendered as a
             * fabricated duration (same narrowing as ExamListPage). */}
            {exam.timingMode === "untimed"
              ? t("startExam.info.noDuration")
              : exam.timingMode === "deadline"
                ? t("startExam.info.deadlineMode")
                : exam.durationMinutes !== null
                  ? t("startExam.info.durationValue", {
                      minutes: exam.durationMinutes,
                    })
                  : t("startExam.info.deadlineMode")}
          </span>

          <div className="type-secondary flex items-center gap-2">
            <AppIcon icon={FileText} size="inline" />
            <span>{t("startExam.info.questionCount")}</span>
          </div>
          <span className="type-body">
            {t("startExam.info.questionCountValue", {
              count: exam.questionCount,
            })}
          </span>

          <div className="type-secondary flex items-center gap-2">
            <AppIcon icon={Shield} size="inline" />
            <span>{t("startExam.info.passingScore")}</span>
          </div>
          <span className="type-body">
            {exam.passingScore}/{exam.totalScore}
          </span>
        </div>

        {exam.controlFlags.detectTabSwitch && (
          <div className="flex items-center gap-2 rounded-md bg-warning/10 p-2 text-warning">
            <AppIcon icon={TriangleAlert} size="inline" className="shrink-0" />
            <span>{t("startExam.info.tabSwitchWarning")}</span>
          </div>
        )}

        {exam.controlFlags.disableCopyPaste && (
          <div className="flex items-center gap-2 rounded-md bg-warning/10 p-2 text-warning">
            <AppIcon icon={TriangleAlert} size="inline" className="shrink-0" />
            <span>{t("startExam.info.copyPasteWarning")}</span>
          </div>
        )}
      </PageSection>

      <div className="rounded-md border border-warning/20 bg-warning/10 p-4 text-sm text-warning">
        <AppIcon icon={TriangleAlert} size="inline" className="mr-2 inline" />
        {t("startExam.notice")}
      </div>

      <div className="type-secondary flex flex-col gap-1">
        <span>
          {t("startExam.attempts", {
            used: exam.currentAttempts,
            max: exam.maxAttempts,
          })}
        </span>
        {exam.bestScore != null && (
          <span>
            {t("startExam.bestScore", {
              score: exam.bestScore,
              total: exam.totalScore,
            })}
            {exam.bestScorePercent != null && (
              <span className="ml-1">
                {t("startExam.bestScorePercent", {
                  percent: exam.bestScorePercent,
                })}
              </span>
            )}
          </span>
        )}
      </div>

      {inlineMessage && (
        <div
          className={`rounded-md border p-3 text-sm ${
            hasActiveAttempt
              ? "border-primary/30 bg-primary/10 text-primary"
              : exam.availabilityStatus === "graded" &&
                  exam.primaryAction === "start"
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {inlineMessage}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={() => void handleStart()}
          disabled={
            isStarting ||
            (!hasActiveAttempt &&
              exam.primaryAction !== "start" &&
              exam.primaryAction !== "resume")
          }
          data-testid="exam-start-btn"
        >
          {isStarting && (
            <AppIcon
              icon={LoaderCircle}
              size="inline"
              className="animate-spin"
            />
          )}
          {isStarting ? t("startExam.actions.entering") : actionLabel}
        </Button>
      </div>
    </PageContainer>
  );
}
