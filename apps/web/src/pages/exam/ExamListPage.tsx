import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api, ApiError } from "@/lib/api";
import { routes } from "@/lib/routes";
import { trackExamEvent } from "@/lib/examTelemetry";
import { AppIcon } from "@/components/shared/AppIcon";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/shared/PageContainer";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  ClipboardList,
  Clock,
  Trophy,
  Play,
  RotateCcw,
  Eye,
} from "lucide-react";
import type { CandidateExamSummary } from "@exam/contracts";

/** Maps an exam availability status to its i18n key (under `availability.`).
 * The Chinese text is resolved at render via `t()`; no hardcoded copy here. */
function availabilityLabelKey(
  status: CandidateExamSummary["availabilityStatus"],
): string {
  return `availability.${status}`;
}

/** Returns the shadcn Badge variant for a given exam availability status. */
function statusBadgeVariant(
  status: CandidateExamSummary["availabilityStatus"],
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "available":
    case "in_progress":
    case "resumable":
      return "default";
    case "graded":
    case "max_attempts_exhausted":
    case "expired":
      return "secondary";
    case "submitted_pending_grade":
      return "outline";
    default:
      return "destructive";
  }
}

/** Renders a single exam summary card with metadata, status badge, and a primary action button. */
function ExamCard({
  exam,
  onStart,
  onResult,
}: {
  exam: CandidateExamSummary;
  onStart: (examId: string) => void;
  onResult: (attemptId: string) => void;
}) {
  const { t } = useTranslation();
  const { formatDateTimeMinute } = useProductDateTime();
  // A retake card's primary action is start; the published prior result must
  // stay viewable from the same card. bestScore is only projected by the API
  // when the canonical result-visibility authority says the result is
  // visible, so this entry never exists on hidden results — and the result
  // page re-applies the same authority server-side.
  const viewableResultAttemptId =
    exam.primaryAction === "start" && exam.bestScore != null
      ? exam.latestAttemptId
      : undefined;
  const actionLabel = (() => {
    switch (exam.primaryAction) {
      case "start":
        return t("examList.actions.start");
      case "resume":
        return t("examList.actions.resume");
      case "view_result":
        return t("examList.actions.viewResult");
      case "view_history":
        return t("examList.actions.viewHistory");
      default:
        return undefined;
    }
  })();

  const actionIcon = (() => {
    switch (exam.primaryAction) {
      case "start":
        return <AppIcon icon={Play} size="badge" className="mr-1" />;
      case "resume":
        return <AppIcon icon={RotateCcw} size="badge" className="mr-1" />;
      case "view_result":
      case "view_history":
        return <AppIcon icon={Eye} size="badge" className="mr-1" />;
      default:
        return undefined;
    }
  })();

  /** Dispatches navigation to the start or result page based on the primary action. */
  function handleAction() {
    if (exam.primaryAction === "start" || exam.primaryAction === "resume") {
      onStart(exam.examId);
    } else if (
      (exam.primaryAction === "view_result" ||
        exam.primaryAction === "view_history") &&
      exam.latestAttemptId
    ) {
      onResult(exam.latestAttemptId);
    }
  }

  return (
    <Card data-testid={`exam-card-${exam.examId}`}>
      <CardHeader className="pb-3">
        {/* WHY (#932): flex-wrap lets the badge pair drop under the title on
            the smallest supported viewport instead of squeezing the exam name
            into a narrow column; desktop/tablet keep the side-by-side layout
            (wrap is mobile-only via sm:flex-nowrap). */}
        <div className="flex flex-wrap items-start justify-between gap-2 sm:flex-nowrap">
          <CardTitle className="min-w-0 break-words text-lg">
            {exam.title}
          </CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            {exam.bestScore != null && (
              // The score is data, not an achievement (#932): the label
              // states it is the historical best, the passing threshold
              // (server-projected passingScore) decides the tone, and the
              // trophy icon renders only on a genuine pass so a zero /
              // below-passing score never carries achievement imagery.
              <Badge
                variant={
                  exam.passingScore != null &&
                  exam.bestScore >= exam.passingScore
                    ? "default"
                    : "secondary"
                }
                data-testid="exam-best-score"
              >
                {exam.passingScore != null &&
                  exam.bestScore >= exam.passingScore && (
                    <AppIcon icon={Trophy} size="badge" className="mr-1" />
                  )}
                {t("examList.meta.bestScore", { score: exam.bestScore })}
              </Badge>
            )}
            <Badge variant={statusBadgeVariant(exam.availabilityStatus)}>
              {/* Key is built from a closed availability enum; all 9 values
               * exist in the catalog. `as never` bridges the runtime-built
               * string to i18next's literal-key type (dynamic keys can't be
               * statically narrowed). */}
              {t(availabilityLabelKey(exam.availabilityStatus) as never)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 type-secondary">
          <span className="flex items-center gap-1">
            <AppIcon icon={Clock} size="badge" />
            {exam.timingMode === "untimed"
              ? t("examList.meta.noDuration")
              : exam.timingMode === "timed_window" &&
                  exam.durationMinutes !== null
                ? t("examList.meta.duration", {
                    minutes: exam.durationMinutes,
                  })
                : t("examList.meta.deadline")}
          </span>
          <span>
            {t("examList.meta.passingScore", {
              score: exam.passingScore,
              total: exam.totalScore,
            })}
          </span>
          <span>
            {t("examList.meta.questionCount", { count: exam.totalQuestions })}
          </span>
          {/* Attempts copy keys on the server-projected retake policy — the
           * authored maxAttempts number is only a real cap under
           * max_attempts and must never render as one under unlimited. */}
          <span>
            {exam.retakePolicy === "unlimited"
              ? t("examList.meta.attemptsUnlimited")
              : exam.retakePolicy === "pass_then_stop"
                ? t("examList.meta.attemptsUntilPass", {
                    used: exam.attemptsUsed,
                  })
                : t("examList.meta.attempts", {
                    used: exam.attemptsUsed,
                    max: exam.maxAttempts,
                  })}
          </span>
        </div>
        {/* Exam windows carry no per-second exam-rule meaning on the list
            card; minute precision halves the string so 390 no longer wraps.
            Exact-second rendering stays on proctor/audit surfaces. */}
        <div className="type-secondary">
          {formatDateTimeMinute(exam.windowStartAt)} —{" "}
          {exam.windowEndAt === null
            ? t("examList.meta.noEnd")
            : formatDateTimeMinute(exam.windowEndAt)}
        </div>
        {/* DESIGN.md mobile direct-touch contract: card action buttons are
            size="sm" (36px desktop standard) and must reach 44px on mobile.
            Page-local min-height via the PageHeader actions-slot idiom — the
            Button size vocabulary stays untouched. */}
        <div className="flex justify-end gap-2 [&_button]:min-h-11 sm:[&_button]:min-h-9">
          {viewableResultAttemptId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onResult(viewableResultAttemptId)}
              data-testid="exam-view-result"
            >
              <AppIcon icon={Eye} size="badge" className="mr-1" />
              {t("examList.actions.viewResult")}
            </Button>
          )}
          {actionLabel && (
            <Button
              size="sm"
              onClick={handleAction}
              disabled={exam.primaryAction === "none"}
              data-testid="exam-primary-action"
              data-action={exam.primaryAction}
            >
              {actionIcon}
              {actionLabel}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Candidate-facing page that lists all assigned exams grouped by availability status. */
export function ExamListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [exams, setExams] = useState<CandidateExamSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fetches the list of exams assigned to the current candidate from the API. */
  const loadExams = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<CandidateExamSummary[]>(
        "/api/candidate/exams",
      );
      setExams(data.filter(Boolean));
    } catch (err) {
      // Candidate entry-point load failure: record one warn with the stable
      // error code (#800), same pattern as StartExamPage.
      trackExamEvent(
        "exam_list_load_failed",
        { errorCode: err instanceof ApiError ? err.code : "UNKNOWN" },
        { level: "warn" },
      );
      setError(t("examList.errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  /** Navigates to the pre-exam start page for the given exam. */
  function handleStart(examId: string) {
    navigate(routes.exam.start(examId));
  }

  /** Navigates to the result page for the given attempt. */
  function handleResult(attemptId: string) {
    navigate(routes.exam.result(attemptId));
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadExams} />;

  const canTake = exams.filter(
    (e) => e.primaryAction === "start" || e.primaryAction === "resume",
  );
  const upcoming = exams.filter(
    (e) => e.availabilityStatus === "not_started_yet",
  );
  const others = exams.filter(
    (e) =>
      e.primaryAction !== "start" &&
      e.primaryAction !== "resume" &&
      e.availabilityStatus !== "not_started_yet",
  );

  return (
    <PageContainer role="candidate" className="flex flex-col gap-6">
      {/* WHY (#932): the candidate shell had no page h1 (unlike settings /
          start / result, which all show a visible title under the same
          top-bar nav link). A visible title — rather than a visually-hidden
          heading — keeps the shell's consistent scannable page anchor, and
          its vertical cost stays inside the first screen even at 320x700. */}
      <PageHeader title={t("examList.pageTitle")} />
      {canTake.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="type-section-title">
            {t("examList.sections.canTake")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {canTake.map((exam) => (
              <ExamCard
                key={exam.examId}
                exam={exam}
                onStart={handleStart}
                onResult={handleResult}
              />
            ))}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="type-section-title">
            {t("examList.sections.history")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {others.map((exam) => (
              <ExamCard
                key={exam.examId}
                exam={exam}
                onStart={handleStart}
                onResult={handleResult}
              />
            ))}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="type-section-title">
            {t("examList.sections.upcoming")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {upcoming.map((exam) => (
              <ExamCard
                key={exam.examId}
                exam={exam}
                onStart={handleStart}
                onResult={handleResult}
              />
            ))}
          </div>
        </section>
      )}

      {exams.length === 0 && (
        <EmptyState
          icon={<AppIcon icon={ClipboardList} size="state" />}
          title={t("examList.empty.title")}
          description={t("examList.empty.description")}
        />
      )}
    </PageContainer>
  );
}
