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
import {
  ClipboardList,
  Clock,
  Trophy,
  Play,
  RotateCcw,
  Eye,
} from "lucide-react";
import type { CandidateExamSummary } from "@exam/contracts";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(
  status: CandidateExamSummary["availabilityStatus"],
): string {
  switch (status) {
    case "available":
      return "可参加";
    case "in_progress":
      return "进行中";
    case "resumable":
      return "可恢复";
    case "submitted_pending_grade":
      return "待评分";
    case "graded":
      return "已评分";
    case "max_attempts_exhausted":
      return "次数已用完";
    case "not_started_yet":
      return "未开放";
    case "expired":
      return "已过期";
    case "unavailable":
      return "不可用";
  }
}

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
        return <Play className="mr-1 size-3" />;
      case "resume":
        return <RotateCcw className="mr-1 size-3" />;
      case "view_result":
      case "view_history":
        return <Eye className="mr-1 size-3" />;
      default:
        return undefined;
    }
  })();

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
    <Card className="shadow-sm" data-testid={`exam-card-${exam.examId}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">{exam.title}</CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            {exam.bestScore != null && (
              <Badge variant="default">
                <Trophy className="mr-1 size-3" />
                {exam.bestScore}
              </Badge>
            )}
            <Badge variant={statusBadgeVariant(exam.availabilityStatus)}>
              {statusLabel(exam.availabilityStatus)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
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
        <div className="flex justify-end">
          {actionLabel && (
            <Button
              size="sm"
              onClick={handleAction}
              disabled={exam.primaryAction === "none"}
              data-testid="exam-action-btn"
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

export function ExamListPage() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<CandidateExamSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  function handleStart(examId: string) {
    navigate(routes.exam.start(examId));
  }

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
