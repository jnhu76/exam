import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { AppIcon } from "@/components/shared/AppIcon";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardList,
  Clock,
  Trophy,
  Play,
  RotateCcw,
  Eye,
} from "lucide-react";
import type { CandidateExamSummary } from "@exam/contracts";

/** Formats an ISO datetime string to a localized zh-CN short date-time display. */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">{exam.title}</CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            {exam.bestScore != null && (
              <Badge variant="default" data-testid="exam-best-score">
                <AppIcon icon={Trophy} size="badge" className="mr-1" />
                {exam.bestScore}
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
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <AppIcon icon={Clock} size="badge" />
            {t("examList.meta.duration", { minutes: exam.durationMinutes })}
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
          <span>
            {t("examList.meta.attempts", {
              used: exam.attemptsUsed,
              max: exam.maxAttempts,
            })}
          </span>
        </div>
        <div className="text-sm text-muted-foreground">
          {formatTime(exam.windowStartAt)} — {formatTime(exam.windowEndAt)}
        </div>
        <div className="flex justify-end">
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
    } catch {
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
    <div className="mx-auto max-w-4xl flex flex-col gap-6 p-6">
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
    </div>
  );
}
