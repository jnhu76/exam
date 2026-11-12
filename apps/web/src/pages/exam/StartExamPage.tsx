import { useState, useEffect, useCallback, useRef } from "react";
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
import type {
  CandidateExamDetailResponse,
  QueueStatusResponse,
} from "@exam/contracts";
import { trackExamEvent } from "@/lib/examTelemetry";

interface AttemptResponse {
  id: string;
  status: string;
  examId: string;
}

/** Client-side pacing between admission-queue polls; admission truth is
 * re-derived server-side on every poll. */
const QUEUE_POLL_INTERVAL_MS = 2_000;

/** Pre-exam page that displays exam details and initiates or resumes an attempt. */
export function StartExamPage() {
  const { t } = useTranslation();
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<CandidateExamDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Durable admission queue flow (issue 292): joining → waiting → admitted.
  const [queueStatus, setQueueStatus] = useState<QueueStatusResponse | null>(
    null,
  );
  // Start-entry operation ownership: at most one live entry operation per
  // page lifecycle and exam id. Each enterExam invocation claims this slot
  // with its own identity object; unmount or an examId param change nulls
  // it, instantly superseding the in-flight operation. Every await boundary
  // re-checks ownership, so a dead operation can neither fire the start
  // command, mutate the start/queue UI, nor navigate to an attempt the user
  // is no longer entering.
  const entryOperationRef = useRef<{ examId: string } | null>(null);
  // Exam-detail request ownership: each loadExam invocation claims this slot
  // with its own identity object; an examId param change or unmount nulls it.
  // A superseded request must not write exam, error, loading, or telemetry —
  // its detail belongs to a route the page no longer shows.
  const detailRequestRef = useRef<{ examId: string } | null>(null);

  /** Fetches the candidate exam detail from the API. */
  const loadExam = useCallback(async () => {
    if (!examId) return;
    const request = { examId };
    detailRequestRef.current = request;
    const ownsRequest = () => detailRequestRef.current === request;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<CandidateExamDetailResponse>(
        `/api/candidate/exams/${examId}`,
      );
      // Ownership boundary: the detail returned, but the route may have moved
      // to another exam while the request was on the wire.
      if (!ownsRequest()) return;
      setExam(data);
    } catch (err) {
      // A superseded request's failure belongs to nobody: it must not
      // overwrite the current exam's error state or telemetry.
      if (!ownsRequest()) return;
      // Candidate entry-point load failure: the toast/error state is
      // ephemeral, so record one warn with the stable error code (#800).
      trackExamEvent(
        "exam_detail_load_failed",
        { errorCode: err instanceof ApiError ? err.code : "UNKNOWN" },
        { examId, level: "warn" },
      );
      setError(t("startExam.errors.loadFailed"));
    } finally {
      // Ownership boundary: the request settled. A superseded request must
      // not end the newer request's loading window.
      if (ownsRequest()) setIsLoading(false);
    }
  }, [examId, t]);

  useEffect(() => {
    loadExam();
    // The request claimed by this examId's load dies with the param value:
    // a param change or unmount supersedes it before the next load claims.
    return () => {
      detailRequestRef.current = null;
    };
  }, [loadExam]);

  /**
   * Creates a new attempt via the API and navigates to the exam-taking page.
   * requireQueue exams join the durable admission queue first (issue 292): the
   * queue panel polls the same command endpoint until the server materializes
   * admission, then starts. The client owns no admission truth — every poll
   * re-derives readiness server-side.
   */
  const enterExam = useCallback(async () => {
    if (!examId) return;
    // Entry decisions key on the route's current exam detail. A detail for a
    // different exam (a route change whose new detail has not arrived) must
    // neither choose the queue path nor fire the start command.
    if (exam?.id !== examId) return;
    // Single-flight entry: a click landing while an entry operation is
    // already running (the double-click race, before the disabled state
    // commits) must not spawn a second competing queue/start flow.
    if (entryOperationRef.current !== null) return;
    const operation = { examId };
    entryOperationRef.current = operation;
    const ownsEntry = () => entryOperationRef.current === operation;
    setIsStarting(true);
    setError(null);
    try {
      if (exam?.controlFlags.requireQueue) {
        let status = await api.post<QueueStatusResponse>(
          `/api/attempts/${examId}/queue`,
        );
        // Ownership boundary: the join returned, but the operation may have
        // been superseded while the request was on the wire.
        if (!ownsEntry()) return;
        while (status.status !== "ready") {
          setQueueStatus(status);
          await new Promise((resolve) =>
            setTimeout(resolve, QUEUE_POLL_INTERVAL_MS),
          );
          // Ownership boundary: the poll sleep ended.
          if (!ownsEntry()) return;
          status = await api.post<QueueStatusResponse>(
            `/api/attempts/${examId}/queue`,
          );
          // Ownership boundary: the poll returned.
          if (!ownsEntry()) return;
        }
        setQueueStatus(status);
      }
      // Ownership boundary: admission is ready — only the owning operation
      // may issue the start command.
      if (!ownsEntry()) return;
      const attempt = await api.post<AttemptResponse>(
        `/api/attempts/${examId}/start`,
      );
      // Ownership boundary: the start POST returned. The command may already
      // have committed server-side — a superseded operation neither undoes
      // it (no cancel, no re-start) nor claims the result: no navigation,
      // no UI update.
      if (!ownsEntry()) return;
      setQueueStatus(null);
      trackExamEvent("exam_started", {}, { examId, attemptId: attempt.id });
      navigate(routes.exam.take(attempt.id));
    } catch (err) {
      // A superseded operation's failure belongs to nobody: it must not
      // overwrite the error state or end the current loading window.
      if (!ownsEntry()) return;
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
      setQueueStatus(null);
      setIsStarting(false);
    } finally {
      // Release the entry slot only when this operation still owns it — a
      // superseded operation must not free the newer operation's slot.
      if (ownsEntry()) {
        entryOperationRef.current = null;
        setIsStarting(false);
      }
    }
  }, [examId, exam, navigate, t]);

  // Exam-scoped lifecycle (INVARIANT: no orphan poll loops, no cross-exam
  // operation or detail leakage). An examId param change re-uses this mounted
  // page for a different exam: the previous exam's entry operation is dead,
  // and its queue/starting UI and detail must not leak into the new exam's
  // view. The cleanup supersedes the operation on unmount.
  useEffect(() => {
    entryOperationRef.current = null;
    setIsStarting(false);
    setQueueStatus(null);
    // The route now names a different exam: the old detail is no longer this
    // page's data, even for the render before the new request settles.
    setExam(null);
    return () => {
      entryOperationRef.current = null;
    };
  }, [examId]);

  /** Handles the primary action: start a new attempt, resume an active one, or view results. */
  async function handleStart() {
    // The action may only derive from the detail of the route's current exam.
    if (!exam || exam.id !== examId) return;
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

  // Only the detail whose id matches the route's examId may render. A stale
  // detail (route changed, new detail in flight) is transitional: keep
  // loading rather than show another exam's title, status, or primary action.
  if (isLoading || (exam !== null && exam.id !== examId)) {
    return <LoadingState />;
  }
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
            {t("startExam.info.passingScoreValue", {
              score: exam.passingScore,
              total: exam.totalScore,
            })}
          </span>
        </div>
      </PageSection>

      <div className="rounded-md border border-warning/20 bg-warning/10 p-4 text-sm text-warning">
        <AppIcon icon={TriangleAlert} size="inline" className="mr-2 inline" />
        {t("startExam.notice")}
      </div>

      <div className="type-secondary flex flex-col gap-1">
        {/* Attempts copy keys on the server-projected retake policy — the
         * authored maxAttempts number is only a real cap under
         * max_attempts and must never render as one under unlimited. */}
        <span>
          {exam.retakePolicy === "unlimited"
            ? t("startExam.attemptsUnlimited")
            : exam.retakePolicy === "pass_then_stop"
              ? t("startExam.attemptsUntilPass", {
                  used: exam.currentAttempts,
                })
              : t("startExam.attempts", {
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

      {/* Durable queue waiting truth (issue 292) while the poll loop runs. */}
      {queueStatus && queueStatus.status !== "ready" && (
        <PageSection
          title={t("startExam.queue.title")}
          contentClassName="flex flex-col gap-1 text-sm"
        >
          <div data-testid="exam-queue-panel" className="flex flex-col gap-1">
            <span className="type-body">{t("startExam.queue.waiting")}</span>
            <span className="type-secondary">
              {t("startExam.queue.position", {
                position: queueStatus.position,
              })}
            </span>
            {queueStatus.waitCount > 0 && (
              <span className="type-secondary">
                {t("startExam.queue.ahead", { count: queueStatus.waitCount })}
              </span>
            )}
            {queueStatus.estimatedWaitSeconds > 0 && (
              <span className="type-secondary">
                {t("startExam.queue.estimated", {
                  seconds: queueStatus.estimatedWaitSeconds,
                })}
              </span>
            )}
          </div>
        </PageSection>
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
          {isStarting
            ? queueStatus && queueStatus.status !== "ready"
              ? t("startExam.queue.joining")
              : t("startExam.actions.entering")
            : actionLabel}
        </Button>
      </div>
    </PageContainer>
  );
}
