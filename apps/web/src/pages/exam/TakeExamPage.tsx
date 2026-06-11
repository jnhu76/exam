import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { LoadingState } from "@/components/shared/LoadingState";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Flag } from "lucide-react";
import { routes } from "@/lib/routes";
import { Separator } from "@/components/ui/separator";
import { QuestionNav } from "@/components/exam/QuestionNav";
import { ExamTimer } from "@/components/exam/ExamTimer";
import { SaveIndicator } from "@/components/exam/SaveIndicator";
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
    } catch {
      navigate(routes.exam.list);
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
        } else {
          setSaveState("error");
        }
      } catch {
        setSaveState("error");
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
    } catch {
      // heartbeat failure is non-critical
    }
  }, [attemptId]);

  useEffect(() => {
    const interval = setInterval(() => void handleHeartbeat(), 30000);
    return () => clearInterval(interval);
  }, [handleHeartbeat]);

  if (isLoading || !attempt || !currentQuestion) return <LoadingState />;

  const unansweredCount = questionStates.filter(
    (s) => s === "unanswered",
  ).length;
  const flaggedCount = questionStates.filter((s) => s === "flagged").length;
  const answeredCount = questionStates.filter(
    (s) => s === "answered" || s === "flagged",
  ).length;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <span className="text-lg font-semibold">
          {attempt.questionSnapshot.length}题
        </span>
        <div className="flex items-center gap-4">
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
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-20 overflow-y-auto border-r p-2">
          <QuestionNav
            questions={attempt.questionSnapshot.map((q) => ({
              id: q.originalQuestionId,
            }))}
            states={questionStates}
            currentIndex={currentIndex}
            onSelect={setCurrentIndex}
          />
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl">
            <div className="mb-4 text-sm text-muted-foreground">
              第 {currentIndex + 1} 题 / 共 {attempt.questionSnapshot.length} 题
              （{currentQuestion.score}分）
            </div>
            <div className="mb-6 text-lg">{currentQuestion.content}</div>
            <QuestionRenderer
              question={currentQuestion}
              answer={currentAnswer}
              onChange={(answer) =>
                saveAnswer(currentQuestion.originalQuestionId, answer)
              }
            />
          </div>
        </main>
      </div>

      <Separator />
      <footer className="flex items-center justify-between px-4 py-2">
        <div className="text-sm text-muted-foreground">
          已答 {answeredCount} / 未答 {unansweredCount} / 标记 {flaggedCount} /
          共 {attempt.questionSnapshot.length}
        </div>
        <div className="flex gap-2">
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
