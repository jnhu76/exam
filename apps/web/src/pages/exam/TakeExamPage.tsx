import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Flag, WifiOff } from "lucide-react";
import { routes } from "@/lib/routes";
import { Separator } from "@/components/ui/separator";
import { QuestionNav } from "@/components/exam/QuestionNav";
import { ExamTimer } from "@/components/exam/ExamTimer";
import { SaveIndicator } from "@/components/exam/SaveIndicator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuestionRenderer } from "@/components/exam/QuestionRenderer";
import type { SaveState } from "@/components/exam/SaveIndicator";
import type { LoadAttemptResponse } from "@exam/contracts";
import type { CandidateQuestionSnapshot } from "@/lib/examTypes";

type AttemptData = Omit<
  LoadAttemptResponse,
  "questionSnapshot" | "deadlineAt"
> & {
  questionSnapshot: CandidateQuestionSnapshot[];
  deadlineAt: string;
};

type QuestionState = "unanswered" | "answered" | "flagged";

export function TakeExamPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState<AttemptData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [questionStates, setQuestionStates] = useState<QuestionState[]>([]);
  const [answers, setAnswers] = useState<Map<string, unknown>>(new Map());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const saveTimerRefs = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const versionsRef = useRef(new Map<string, number>());
  const clientSeqsRef = useRef(new Map<string, number>());

  const loadAttempt = useCallback(async () => {
    if (!attemptId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<AttemptData>(`/api/attempts/${attemptId}`);
      if (data.status !== "in_progress") {
        navigate(routes.exam.result(attemptId));
        return;
      }
      setAttempt(data);

      const answerMap = new Map<string, unknown>();
      const versionMap = new Map<string, number>();
      for (const a of data.answers) {
        answerMap.set(a.questionId, a.answer);
        versionMap.set(a.questionId, a.version);
      }
      setAnswers(answerMap);
      versionsRef.current = versionMap;

      const states: QuestionState[] = data.questionSnapshot.map((q) => {
        if (answerMap.has(q.originalQuestionId)) return "answered";
        return "unanswered";
      });
      setQuestionStates(states);
      setIsDisconnected(false);
    } catch {
      setLoadError("无法加载答题记录，请检查连接后重试");
    } finally {
      setIsLoading(false);
    }
  }, [attemptId, navigate]);

  useEffect(() => {
    loadAttempt();
  }, [loadAttempt]);

  const currentQuestion = attempt?.questionSnapshot[currentIndex];
  const currentAnswer = currentQuestion
    ? answers.get(currentQuestion.originalQuestionId)
    : undefined;

  async function saveAnswer(questionId: string, answer: unknown) {
    if (!attemptId) return;

    setAnswers((prev) => new Map(prev).set(questionId, answer));
    setQuestionStates((prev) =>
      prev.map((state, index) =>
        attempt?.questionSnapshot[index]?.originalQuestionId === questionId &&
        state !== "flagged"
          ? "answered"
          : state,
      ),
    );

    const existingTimer = saveTimerRefs.current.get(questionId);
    if (existingTimer) clearTimeout(existingTimer);

    setSaveState("saving");
    const timer = setTimeout(async () => {
      const baseVersion = versionsRef.current.get(questionId) ?? 0;
      const clientSeq = (clientSeqsRef.current.get(questionId) ?? 0) + 1;
      clientSeqsRef.current.set(questionId, clientSeq);

      try {
        const result = await api.post<{
          accepted: boolean;
          serverVersion: number;
          conflict?: { reason: string };
        }>(`/api/attempts/${attemptId}/answers/${questionId}`, {
          attemptId,
          questionId,
          answer,
          clientSeq,
          clientSavedAt: new Date().toISOString(),
          baseVersion,
        });

        if (result.accepted) {
          versionsRef.current.set(questionId, result.serverVersion);
          setSaveState("saved");
          setIsDisconnected(false);
        } else {
          setSaveState("error");
        }
      } catch {
        setSaveState("error");
        setIsDisconnected(true);
      }
    }, 1500);
    saveTimerRefs.current.set(questionId, timer);
  }

  useEffect(() => {
    const timers = saveTimerRefs.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!attemptId) return;
    setIsSubmitting(true);
    try {
      await api.post(`/api/attempts/${attemptId}/submit`);
      navigate(routes.exam.result(attemptId));
    } catch {
      setIsSubmitting(false);
      toast.error("提交失败，请重试");
    }
  }, [attemptId, navigate]);
  const handleTimeout = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  function toggleFlag() {
    setQuestionStates((prev) => {
      const next = [...prev];
      next[currentIndex] =
        next[currentIndex] === "flagged"
          ? currentQuestion && answers.has(currentQuestion.originalQuestionId)
            ? "answered"
            : "unanswered"
          : "flagged";
      return next;
    });
  }

  function handlePrev() {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  }

  function handleNext() {
    if (attempt && currentIndex < attempt.questionSnapshot.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }

  const handleHeartbeat = useCallback(async () => {
    if (!attemptId) return;
    try {
      await api.post(`/api/attempts/${attemptId}/heartbeat`);
      setIsDisconnected(false);
    } catch {
      setIsDisconnected(true);
    }
  }, [attemptId]);

  useEffect(() => {
    const interval = setInterval(() => void handleHeartbeat(), 30000);
    return () => clearInterval(interval);
  }, [handleHeartbeat]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState label="正在加载答题记录..." />
      </div>
    );
  }

  if (loadError || !attempt || !currentQuestion) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <ErrorState
          message={loadError ?? "答题记录不可用"}
          onRetry={loadAttempt}
        />
      </div>
    );
  }

  const unansweredCount = questionStates.filter(
    (s) => s === "unanswered",
  ).length;
  const flaggedCount = questionStates.filter((s) => s === "flagged").length;
  const answeredCount = questionStates.filter(
    (s) => s === "answered" || s === "flagged",
  ).length;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-lg font-semibold">答题中</div>
            <div className="text-sm text-muted-foreground">
              第 {currentIndex + 1} 题 / 共 {attempt.questionSnapshot.length} 题
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SaveIndicator state={saveState} />
            <ExamTimer
              deadlineAt={attempt.deadlineAt}
              onTimeout={handleTimeout}
            />
            <Button
              variant="default"
              size="sm"
              onClick={() => setShowSubmitDialog(true)}
            >
              交卷
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-4 xl:flex-row xl:items-start">
        <aside className="rounded-lg border bg-card p-3 xl:sticky xl:top-24 xl:max-h-[calc(100vh-8rem)] xl:w-24 xl:overflow-y-auto">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground xl:block">
            <span>题号</span>
            <span className="xl:hidden">
              已答 {answeredCount} / 未答 {unansweredCount}
            </span>
          </div>
          <div className="overflow-x-auto xl:overflow-visible">
            <QuestionNav
              questions={attempt.questionSnapshot.map((q) => ({
                id: q.originalQuestionId,
              }))}
              states={questionStates}
              currentIndex={currentIndex}
              onSelect={setCurrentIndex}
            />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {isDisconnected && (
              <Alert
                variant="destructive"
                className="border-destructive/30 bg-destructive/10"
              >
                <WifiOff aria-hidden="true" />
                <AlertTitle>连接异常</AlertTitle>
                <AlertDescription>
                  系统会在连接恢复后继续保存，请不要关闭页面
                </AlertDescription>
              </Alert>
            )}

            <section className="rounded-lg border bg-card p-5 shadow-sm md:p-8">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <div>
                  <div className="text-sm text-muted-foreground">
                    第 {currentIndex + 1} 题 / 共{" "}
                    {attempt.questionSnapshot.length} 题
                  </div>
                  <div className="text-sm font-medium text-muted-foreground">
                    {currentQuestion.score} 分
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={toggleFlag}>
                  <Flag
                    data-icon="inline-start"
                    fill={
                      questionStates[currentIndex] === "flagged"
                        ? "currentColor"
                        : "none"
                    }
                  />
                  {questionStates[currentIndex] === "flagged"
                    ? "取消标记"
                    : "标记"}
                </Button>
              </div>
              <div className="mb-8 text-xl font-medium leading-8 text-foreground">
                {currentQuestion.content}
              </div>
              <QuestionRenderer
                question={currentQuestion}
                answer={currentAnswer}
                onChange={(answer) =>
                  saveAnswer(currentQuestion.originalQuestionId, answer)
                }
              />
            </section>
          </div>
        </main>
      </div>

      <Separator />
      <footer className="sticky bottom-0 z-20 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">
            已答 {answeredCount} / 未答 {unansweredCount} / 标记 {flaggedCount}{" "}
            / 共 {attempt.questionSnapshot.length}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrev}
              disabled={currentIndex === 0}
            >
              <ChevronLeft data-icon="inline-start" />
              上一题
            </Button>
            <Button variant="outline" size="sm" onClick={toggleFlag}>
              <Flag
                data-icon="inline-start"
                fill={
                  questionStates[currentIndex] === "flagged"
                    ? "currentColor"
                    : "none"
                }
              />
              {questionStates[currentIndex] === "flagged" ? "取消标记" : "标记"}
            </Button>
            {currentIndex === attempt.questionSnapshot.length - 1 ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowSubmitDialog(true)}
              >
                提交考试
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={handleNext}>
                下一题
                <ChevronRight data-icon="inline-end" />
              </Button>
            )}
          </div>
        </div>
      </footer>

      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认交卷</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-sm">
            {unansweredCount > 0 && (
              <p>
                还有 <strong>{unansweredCount}</strong> 题未作答
              </p>
            )}
            {flaggedCount > 0 && (
              <p>
                有 <strong>{flaggedCount}</strong> 题已标记待检查
              </p>
            )}
            <p className="text-destructive">交卷后不可修改</p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSubmitDialog(false)}
            >
              继续答题
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={isSubmitting}>
              {isSubmitting ? "提交中..." : "确认交卷"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
