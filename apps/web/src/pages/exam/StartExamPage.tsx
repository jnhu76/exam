import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { routes } from "@/lib/routes";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
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
      setError("加载考试信息失败");
    } finally {
      setIsLoading(false);
    }
  }, [examId]);

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
      let message = "无法开始考试，请稍后重试";
      if (err instanceof ApiError) {
        switch (err.code) {
          case "MAX_ATTEMPTS_REACHED":
            message = "已达到最大考试次数，无法再次开始考试。";
            break;
          case "EXAM_ALREADY_PASSED":
            message = "本场考试已通过，无需再次参加。";
            break;
          case "EXAM_NOT_OPEN":
            message = "考试当前不在开放时间内。";
            break;
          default:
            if (err.message) message = err.message;
            break;
        }
      }
      setError(message);
      toast.error(message);
      setIsStarting(false);
    }
  }, [examId, navigate]);

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
    return <ErrorState message={error ?? "考试不存在"} onRetry={loadExam} />;
  }

  const hasActiveAttempt = Boolean(exam.activeAttemptId);
  const actionLabel = (() => {
    switch (exam.primaryAction) {
      case "resume":
        return "继续考试";
      case "start":
        return exam.currentAttempts > 0 ? "再次考试" : "开始考试";
      case "view_result":
        return "查看成绩";
      default:
        return "开始考试";
    }
  })();

  const inlineMessage = hasActiveAttempt
    ? "检测到未完成的考试记录，将继续上次进度。"
    : exam.availabilityStatus === "max_attempts_exhausted"
      ? "已达到最大考试次数，无法再次开始考试。"
      : exam.availabilityStatus === "graded" && exam.primaryAction === "start"
        ? "可重考，当前最高成绩将保留。"
        : error;

  return (
    <div className="mx-auto max-w-2xl flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{exam.title}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">考试信息</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="size-4" />
              <span>考试时长</span>
            </div>
            <span className="font-medium">{exam.durationMinutes}分钟</span>

            <div className="flex items-center gap-2 text-muted-foreground">
              <FileText className="size-4" />
              <span>题目数量</span>
            </div>
            <span className="font-medium">{exam.questionCount}题</span>

            <div className="flex items-center gap-2 text-muted-foreground">
              <Shield className="size-4" />
              <span>及格分数</span>
            </div>
            <span className="font-medium">
              {exam.passingScore}/{exam.totalScore}
            </span>
          </div>

          {exam.controlFlags.detectTabSwitch && (
            <Alert
              variant="default"
              className="border-warning/20 bg-warning/10 text-warning"
            >
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertDescription>考试期间将检测切屏行为</AlertDescription>
            </Alert>
          )}

          {exam.controlFlags.disableCopyPaste && (
            <Alert
              variant="default"
              className="border-warning/20 bg-warning/10 text-warning"
            >
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertDescription>考试期间禁止复制粘贴</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Alert
        variant="default"
        className="border-warning/20 bg-warning/10 text-warning"
      >
        <AlertTriangle className="size-4" aria-hidden="true" />
        <AlertDescription>开始后倒计时立即启动，中途不可暂停</AlertDescription>
      </Alert>

      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        <span>
          已考 {exam.currentAttempts}/{exam.maxAttempts} 次
        </span>
        {exam.bestScore != null && (
          <span>
            最高成绩: {exam.bestScore}/{exam.totalScore}
            {exam.bestScorePercent != null && (
              <span className="ml-1">({exam.bestScorePercent}%)</span>
            )}
          </span>
        )}
      </div>

      {inlineMessage && (
        <Alert
          variant="default"
          className={
            hasActiveAttempt ||
            (exam.availabilityStatus === "graded" &&
              exam.primaryAction === "start")
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }
        >
          <AlertDescription>{inlineMessage}</AlertDescription>
        </Alert>
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
            <LoaderCircle
              data-icon="inline-start"
              className="animate-spin"
              aria-hidden="true"
            />
          )}
          {isStarting ? "正在进入..." : actionLabel}
        </Button>
      </div>
    </div>
  );
}
