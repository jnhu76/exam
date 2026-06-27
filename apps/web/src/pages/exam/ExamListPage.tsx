import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminStatusTag } from "@/components/admin";
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
  const actionLabel = (() => {
    switch (exam.primaryAction) {
      case "start":
        return "开始考试";
      case "resume":
        return "继续考试";
      case "view_result":
        return "查看成绩";
      case "view_history":
        return "查看记录";
      default:
        return undefined;
    }
  })();

  const actionIcon = (() => {
    switch (exam.primaryAction) {
      case "start":
        return <Play data-icon="inline-start" />;
      case "resume":
        return <RotateCcw data-icon="inline-start" />;
      case "view_result":
      case "view_history":
        return <Eye data-icon="inline-start" />;
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
    <Card
      className="flex flex-col rounded-[var(--admin-radius)] border-admin-border shadow-none transition-shadow hover:shadow-md"
      data-testid={`exam-card-${exam.examId}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">{exam.title}</CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            {exam.bestScore != null && (
              <Badge variant="default" data-testid="exam-best-score">
                <Trophy data-icon="inline-start" />
                {exam.bestScore}
              </Badge>
            )}
            <AdminStatusTag status={exam.availabilityStatus} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock data-icon="inline-start" />
            {exam.durationMinutes}分钟
          </span>
          <span>
            及格分: {exam.passingScore}/{exam.totalScore}
          </span>
          <span>题目数: {exam.totalQuestions}</span>
          <span>
            已考: {exam.attemptsUsed}/{exam.maxAttempts}次
          </span>
        </div>
        <div className="text-sm text-muted-foreground">
          {formatTime(exam.windowStartAt)} — {formatTime(exam.windowEndAt)}
        </div>
        <div className="mt-auto flex justify-end pt-2">
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
      setError("加载考试列表失败");
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
          <h2 className="text-lg font-semibold">可参加的考试</h2>
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
          <h2 className="text-lg font-semibold">历史考试</h2>
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
          <h2 className="text-lg font-semibold">即将开始</h2>
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
          icon={<ClipboardList className="size-8" />}
          title="暂无可参加的考试"
          description="当前没有可用的考试。"
        />
      )}
    </div>
  );
}
