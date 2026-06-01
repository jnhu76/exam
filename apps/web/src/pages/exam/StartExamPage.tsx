import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  Clock,
  FileText,
  Shield,
  LoaderCircle,
} from "lucide-react";

interface ExamDetail {
  id: string;
  title: string;
  durationMinutes: number;
  passingScore: number;
  totalScore: number;
  questionCount: number;
  controlFlags: {
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    detectTabSwitch: boolean;
    disableCopyPaste: boolean;
    showResultImmediately: boolean;
    requireQueue: boolean;
    batchSize: number;
    batchInterval: number;
  };
  maxAttempts: number;
  currentAttempts: number;
}

interface AttemptResponse {
  id: string;
  status: string;
  examId: string;
}

interface QueueStatus {
  examId: string;
  status: "waiting" | "ready";
  position: number;
  waitCount: number;
  estimatedWaitSeconds: number;
}

export function StartExamPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);

  const loadExam = useCallback(async () => {
    if (!examId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<ExamDetail>(`/api/candidate/exams/${examId}`);
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

  const enterExam = useCallback(async () => {
    if (!examId) return;
    setIsStarting(true);
    try {
      const attempt = await api.post<AttemptResponse>(
        `/api/attempts/${examId}/start`,
      );
      navigate(routes.exam.take(attempt.id));
    } catch {
      setIsStarting(false);
    }
  }, [examId, navigate]);

  const pollQueue = useCallback(async () => {
    if (!examId) return;
    const status = await api.post<QueueStatus>(`/api/attempts/${examId}/queue`);
    setQueueStatus(status);
    if (status.status === "ready") {
      await enterExam();
    }
  }, [enterExam, examId]);

  useEffect(() => {
    if (queueStatus?.status !== "waiting") return;
    const interval = setInterval(() => void pollQueue(), 1000);
    return () => clearInterval(interval);
  }, [pollQueue, queueStatus?.status]);

  async function handleStart() {
    if (exam?.controlFlags.requireQueue) {
      setIsStarting(true);
      try {
        await pollQueue();
      } catch {
        setIsStarting(false);
      }
      return;
    }
    await enterExam();
  }

  if (isLoading) return <LoadingState />;
  if (error || !exam) {
    return <ErrorState message={error ?? "考试不存在"} onRetry={loadExam} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">{exam.title}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">考试信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
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
            <div className="flex items-center gap-2 rounded-md bg-yellow-50 p-2 text-yellow-800">
              <AlertTriangle className="size-4 shrink-0" />
              <span>考试期间将检测切屏行为</span>
            </div>
          )}

          {exam.controlFlags.disableCopyPaste && (
            <div className="flex items-center gap-2 rounded-md bg-yellow-50 p-2 text-yellow-800">
              <AlertTriangle className="size-4 shrink-0" />
              <span>考试期间禁止复制粘贴</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
        <AlertTriangle className="mr-2 inline size-4" />
        开始后倒计时立即启动，中途不可暂停
      </div>

      <div className="text-sm text-muted-foreground">
        已考 {exam.currentAttempts}/{exam.maxAttempts} 次
      </div>

      {queueStatus?.status === "waiting" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">正在排队</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>前方等待人数：{queueStatus.waitCount}</p>
            <p>预计等待：{queueStatus.estimatedWaitSeconds}秒</p>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={Math.max(10, 100 / queueStatus.position)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: `${Math.max(10, 100 / queueStatus.position)}%`,
                }}
              />
            </div>
            <p className="text-muted-foreground">请勿关闭此页面</p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={() => void handleStart()}
          disabled={isStarting}
        >
          {isStarting && (
            <LoaderCircle
              className="mr-2 size-4 animate-spin"
              aria-hidden="true"
            />
          )}
          {isStarting ? "正在进入..." : "开始考试"}
        </Button>
      </div>
    </div>
  );
}
