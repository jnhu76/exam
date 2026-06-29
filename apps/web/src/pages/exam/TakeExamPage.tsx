import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  Lock,
  TimerOff,
  WifiOff,
} from "lucide-react";
import { routes } from "@/lib/routes";
import { Separator } from "@/components/ui/separator";
import { QuestionNavigator } from "@/components/exam/QuestionNavigator";
import { ExamTimer } from "@/components/exam/ExamTimer";
import { SaveIndicator } from "@/components/exam/SaveIndicator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuestionRenderer } from "@/components/exam/QuestionRenderer";
import type { SaveState } from "@/components/exam/SaveIndicator";
import type {
  LoadAttemptResponse,
  SaveAnswerResponseDTO,
} from "@exam/contracts";

type SaveRejection = Extract<SaveAnswerResponseDTO, { accepted: false }>;
import type { CandidateQuestionSnapshot } from "@/lib/examTypes";
import { useSubmitFlush, type FlushResult } from "@/hooks/useSubmitFlush";
import { trackExamEvent, clearPendingForAttempt } from "@/lib/examTelemetry";

type SaveRejectionDisplay = {
  Icon: typeof TimerOff;
  titleKey: string;
  descriptionKey: string;
};

/** Maps a save-rejection reason to its display icon and i18n keys. */
function getSaveRejectionDisplay(
  rejection: SaveRejection,
): SaveRejectionDisplay {
  switch (rejection.reason) {
    case "DEADLINE_EXCEEDED":
      return {
        Icon: TimerOff,
        titleKey: "candidateRuntime.deadline.passed",
        descriptionKey: "candidateRuntime.deadline.passedDescription",
      };
    case "ATTEMPT_ALREADY_SUBMITTED":
      return {
        Icon: Lock,
        titleKey: "candidateRuntime.status.ended",
        descriptionKey: "candidateRuntime.deadline.endedSubmitted",
      };
    case "ATTEMPT_CLOSED":
      return {
        Icon: Lock,
        titleKey: "candidateRuntime.status.ended",
        descriptionKey: "candidateRuntime.deadline.closed",
      };
    default:
      return {
        Icon: Lock,
        titleKey: "candidateRuntime.saveRejection.title",
        descriptionKey: "candidateRuntime.saveRejection.defaultDescription",
      };
  }
}

type AttemptData = Omit<
  LoadAttemptResponse,
  "questionSnapshot" | "deadlineAt"
> & {
  questionSnapshot: CandidateQuestionSnapshot[];
  deadlineAt: string;
};

type QuestionState = "unanswered" | "answered" | "flagged";

/** Active exam-taking page with question navigation, answer saving, and timed submission. */
export function TakeExamPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState<AttemptData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [saveRejection, setSaveRejection] = useState<SaveRejection | null>(
    null,
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [questionStates, setQuestionStates] = useState<QuestionState[]>([]);
  const [answers, setAnswers] = useState<Map<string, unknown>>(new Map());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [flushResult, setFlushResult] = useState<FlushResult | null>(null);
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  const [autoSubmitFailed, setAutoSubmitFailed] = useState(false);
  const versionsRef = useRef(new Map<string, number>());
  const clientSeqsRef = useRef(new Map<string, number>());
  const submittingRef = useRef(false);
  const deadlineHandledRef = useRef(false);
  const serverOffsetRef = useRef(0);
  // Heartbeat consecutive-failure tracking for telemetry. The heartbeat
  // network call itself is unchanged; these only decide when to emit
  // heartbeat_failed / heartbeat_restored so the table is not written on
  // every successful beat.
  const heartbeatFailureRef = useRef(0);
  const heartbeatFailureReportedRef = useRef(false);
  const { scheduleSave, flush } = useSubmitFlush();

  /** Returns the current time adjusted by the server clock offset. */
  const nowByServerClock = useCallback(
    () => Date.now() + serverOffsetRef.current,
    [],
  );

  /** Loads the in-progress attempt data and initializes answer/state maps. */
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
      if (data.serverNow) {
        serverOffsetRef.current =
          new Date(data.serverNow).getTime() - Date.now();
      }
      setAttempt(data);
      trackExamEvent(
        "exam_page_loaded",
        { status: data.status },
        {
          attemptId,
          examId: data.examId,
        },
      );

      const answerMap = new Map<string, unknown>();
      const versionMap = new Map<string, number>();
      const clientSeqMap = new Map<string, number>();
      for (const a of data.answers) {
        answerMap.set(a.questionId, a.answer);
        versionMap.set(a.questionId, a.version);
        // Restore clientSeq counter so the next save for this question
        // uses a fresh clientSeq (>= current version) and is not treated
        // as an idempotent replay by the server.
        clientSeqMap.set(a.questionId, a.version);
      }
      setAnswers(answerMap);
      versionsRef.current = versionMap;
      clientSeqsRef.current = clientSeqMap;

      const states: QuestionState[] = data.questionSnapshot.map((q) => {
        if (answerMap.has(q.originalQuestionId)) return "answered";
        return "unanswered";
      });
      setQuestionStates(states);
      setIsDisconnected(false);
    } catch {
      trackExamEvent(
        "exam_page_loaded",
        { outcome: "failed" },
        { attemptId, level: "warn" },
      );
      setLoadError(t("candidateRuntime.errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [attemptId, navigate]);

  useEffect(() => {
    loadAttempt();
  }, [loadAttempt]);

  // exam_page_unloaded: best-effort telemetry on unmount. attemptId is captured
  // in the ref so the cleanup closure records the id even after it changes.
  const unloadedAttemptRef = useRef<string | undefined>(attemptId);
  unloadedAttemptRef.current = attemptId;
  useEffect(
    () => () => {
      trackExamEvent(
        "exam_page_unloaded",
        {},
        { attemptId: unloadedAttemptRef.current },
      );
      // Discard any in-flight coalesced events for this attempt so their
      // deferred timers do not fire (and leak) after the page unmounts.
      if (unloadedAttemptRef.current) {
        clearPendingForAttempt(unloadedAttemptRef.current);
      }
    },
    [],
  );

  const currentQuestion = attempt?.questionSnapshot[currentIndex];
  const currentAnswer = currentQuestion
    ? answers.get(currentQuestion.originalQuestionId)
    : undefined;

  // question_viewed: fire on question change. Throttled in examTelemetry so
  // rapid back-and-forth navigation does not flood events. Records only
  // structural info (id/index/total/type) — never the question content.
  useEffect(() => {
    if (!attempt || !currentQuestion || !attemptId) return;
    trackExamEvent(
      "question_viewed",
      {
        index: currentIndex + 1,
        total: attempt.questionSnapshot.length,
        type: currentQuestion.type,
      },
      {
        attemptId,
        examId: attempt.examId,
        questionId: currentQuestion.originalQuestionId,
      },
    );
  }, [attempt, currentIndex, currentQuestion, attemptId]);

  /** Updates local answer state and schedules a versioned save to the server via the Answer Save Protocol. */
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

    setSaveState("saving");

    scheduleSave(questionId, async () => {
      const saveStartedAt = Date.now();
      trackExamEvent("answer_autosave_started", {}, { attemptId, questionId });
      const baseVersion = versionsRef.current.get(questionId) ?? 0;
      const clientSeq = (clientSeqsRef.current.get(questionId) ?? 0) + 1;
      clientSeqsRef.current.set(questionId, clientSeq);
      let rejected = false;

      try {
        const result = await api.post<SaveAnswerResponseDTO>(
          `/api/attempts/${attemptId}/answers/${questionId}`,
          {
            attemptId,
            questionId,
            answer,
            clientSeq,
            clientSavedAt: new Date().toISOString(),
            baseVersion,
          },
        );

        if (result.accepted) {
          versionsRef.current.set(questionId, result.serverVersion);
          setSaveState("saved");
          setIsDisconnected(false);
          setSaveRejection(null);
          trackExamEvent(
            "answer_autosave_success",
            { durationMs: Date.now() - saveStartedAt, saveMode: "autosave" },
            { attemptId, questionId },
          );
          return;
        }

        if (
          !result.accepted &&
          result.reason === "STALE_VERSION" &&
          result.details &&
          typeof result.details === "object" &&
          "serverAnswer" in result.details
        ) {
          versionsRef.current.set(questionId, result.serverVersion);
          setAnswers((prev) => {
            const next = new Map(prev);
            next.set(questionId, result.details!.serverAnswer);
            return next;
          });
          setSaveState("saved");
          setIsDisconnected(false);
          setSaveRejection(null);
          trackExamEvent(
            "answer_autosave_success",
            {
              durationMs: Date.now() - saveStartedAt,
              saveMode: "stale_reconcile",
            },
            { attemptId, questionId },
          );
          return;
        }

        rejected = true;
        setSaveState("error");
        setSaveRejection(result);
        trackExamEvent(
          "answer_autosave_failed",
          {
            saveMode: "autosave",
            durationMs: Date.now() - saveStartedAt,
            errorCode: result.reason,
          },
          { attemptId, questionId, level: "warn" },
        );
        throw new Error("save rejected by server");
      } catch (err) {
        setSaveState("error");
        if (!rejected) {
          setIsDisconnected(true);
          trackExamEvent(
            "answer_autosave_failed",
            {
              saveMode: "autosave",
              durationMs: Date.now() - saveStartedAt,
              errorCode: "NETWORK",
            },
            { attemptId, questionId, level: "warn" },
          );
        }
        throw err;
      }
    });
  }

  /** Submits the attempt to the server and navigates to the result page. */
  const handleSubmit = useCallback(async () => {
    if (!attemptId || submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    trackExamEvent("submit_requested", {}, { attemptId });
    try {
      await api.post(`/api/attempts/${attemptId}/submit`);
      trackExamEvent("submit_success", {}, { attemptId });
      navigate(routes.exam.result(attemptId));
    } catch (err) {
      submittingRef.current = false;
      setIsSubmitting(false);
      trackExamEvent(
        "submit_failed",
        { errorCode: err instanceof Error ? "SUBMIT_ERROR" : "UNKNOWN" },
        { attemptId, level: "error" },
      );
      toast.error(t("candidateRuntime.errors.submitFailed"));
      throw err;
    }
  }, [attemptId, navigate]);

  /** Flushes all pending answer saves and records the flush result. */
  const runSubmitFlush = useCallback(async () => {
    setIsFlushing(true);
    setFlushResult(null);
    try {
      setFlushResult(await flush());
    } finally {
      setIsFlushing(false);
    }
  }, [flush]);

  /** Opens the submit confirmation dialog and triggers a pending-save flush. */
  const openSubmitDialog = useCallback(async () => {
    if (!attemptId) return;
    trackExamEvent("submit_clicked", {}, { attemptId });
    setShowSubmitDialog(true);
    trackExamEvent("submit_confirm_opened", {}, { attemptId });
    await runSubmitFlush();
  }, [runSubmitFlush, attemptId]);

  /** Cancels the submit confirmation dialog (继续答题 button). */
  const cancelSubmitDialog = useCallback(() => {
    if (!attemptId) return;
    trackExamEvent("submit_confirm_cancelled", {}, { attemptId });
    setShowSubmitDialog(false);
  }, [attemptId]);

  /** Handles exam timer expiry by flushing saves then auto-submitting. */
  const handleTimeout = useCallback(async () => {
    try {
      await flush();
    } finally {
      void handleSubmit();
    }
  }, [flush, handleSubmit]);

  /** Controls the submit dialog open/close state, preventing close while flushing. */
  const handleSubmitDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open && isFlushing) return;
      setShowSubmitDialog(open);
    },
    [isFlushing],
  );

  /** Toggles the flagged/unanswered/answered state of the current question. */
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

  /** Navigates to the previous question. */
  function handlePrev() {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  }

  /** Navigates to the next question. */
  function handleNext() {
    if (attempt && currentIndex < attempt.questionSnapshot.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }

  /** Sends a heartbeat to the server to keep the attempt alive and update connectivity status. */
  const handleHeartbeat = useCallback(async () => {
    if (!attemptId) return;
    try {
      const result = await api.post<{
        ok: true;
        serverNow: string;
      }>(`/api/attempts/${attemptId}/heartbeat`);
      if (result.serverNow) {
        serverOffsetRef.current =
          new Date(result.serverNow).getTime() - Date.now();
      }
      setIsDisconnected(false);
      // Recovery: if we had been reporting failures, emit a restored event.
      if (heartbeatFailureReportedRef.current) {
        trackExamEvent(
          "heartbeat_restored",
          { failedCount: heartbeatFailureRef.current },
          { attemptId },
        );
      }
      heartbeatFailureRef.current = 0;
      heartbeatFailureReportedRef.current = false;
    } catch {
      setIsDisconnected(true);
      heartbeatFailureRef.current += 1;
      // Only report once per outage, after 3 consecutive failures, to avoid
      // writing a client_event on every failed beat.
      if (
        heartbeatFailureRef.current >= 3 &&
        !heartbeatFailureReportedRef.current
      ) {
        heartbeatFailureReportedRef.current = true;
        trackExamEvent(
          "heartbeat_failed",
          { failedCount: heartbeatFailureRef.current },
          { attemptId, level: "warn" },
        );
      }
    }
  }, [attemptId]);

  useEffect(() => {
    const interval = setInterval(() => void handleHeartbeat(), 30000);
    return () => clearInterval(interval);
  }, [handleHeartbeat]);

  // Browser connectivity + visibility telemetry. Pure flow records — no
  // cheating detection. Listeners register on mount and are removed on
  // unmount. Visibility transitions record a hidden duration.
  useEffect(() => {
    if (typeof window === "undefined" || !attemptId) return;
    const ctxAttemptId = attemptId;

    const onOffline = () =>
      trackExamEvent("browser_offline", {}, { attemptId: ctxAttemptId });
    const onOnline = () =>
      trackExamEvent("browser_online", {}, { attemptId: ctxAttemptId });

    let hiddenSince: number | null = null;
    const onVisibilityChange = () => {
      const hidden = document.visibilityState === "hidden";
      if (hidden) {
        if (hiddenSince === null) hiddenSince = Date.now();
        trackExamEvent("visibility_lost", {}, { attemptId: ctxAttemptId });
      } else if (hiddenSince !== null) {
        const durationMs = Date.now() - hiddenSince;
        hiddenSince = null;
        trackExamEvent(
          "visibility_restored",
          { durationMs },
          { attemptId: ctxAttemptId },
        );
      }
    };

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [attemptId]);

  useEffect(() => {
    if (!attempt?.deadlineAt) return;

    if (nowByServerClock() < new Date(attempt.deadlineAt).getTime()) {
      deadlineHandledRef.current = false;
      setDeadlinePassed(false);
      setAutoSubmitFailed(false);
    }

    if (deadlineHandledRef.current) return;

    const checkDeadline = () => {
      if (deadlineHandledRef.current) return;
      if (nowByServerClock() >= new Date(attempt.deadlineAt).getTime()) {
        deadlineHandledRef.current = true;
        setDeadlinePassed(true);
        void (async () => {
          trackExamEvent("deadline_auto_submit_started", {}, { attemptId });
          try {
            await flush();
          } catch {
            trackExamEvent(
              "deadline_auto_submit_failed",
              { stage: "flush", errorCode: "FLUSH_ERROR" },
              { attemptId, level: "error" },
            );
            toast.error(t("candidateRuntime.errors.saveError"));
          } finally {
            try {
              await handleSubmit();
              trackExamEvent("deadline_auto_submit_success", {}, { attemptId });
            } catch {
              trackExamEvent(
                "deadline_auto_submit_failed",
                { stage: "submit", errorCode: "SUBMIT_ERROR" },
                { attemptId, level: "error" },
              );
              setAutoSubmitFailed(true);
              toast.error(t("candidateRuntime.errors.autoSubmitFailed"));
            }
          }
        })();
      }
    };

    checkDeadline();
    const interval = setInterval(checkDeadline, 1000);
    return () => clearInterval(interval);
  }, [attempt?.deadlineAt, flush, handleSubmit, nowByServerClock]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState label={t("candidateRuntime.loading.attempt")} />
      </div>
    );
  }

  if (loadError || !attempt || !currentQuestion) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <ErrorState
          message={loadError ?? t("candidateRuntime.errors.loadUnavailable")}
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
  const failedSaveCount = flushResult?.failedQuestionIds.length ?? 0;
  const unsavedCount = flushResult
    ? flushResult.pendingCount + failedSaveCount
    : 0;
  const flushTimedOut = flushResult?.timedOut ?? false;
  const requiresSubmitOverride = failedSaveCount > 0 || flushTimedOut;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-lg font-semibold">
              {deadlinePassed
                ? t("candidateRuntime.status.ended")
                : t("candidateRuntime.status.inProgress")}
            </div>
            <div className="text-sm text-muted-foreground">
              {t("candidateRuntime.navigator.questionOf", {
                current: currentIndex + 1,
                total: attempt.questionSnapshot.length,
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SaveIndicator state={saveState} />
            {!deadlinePassed && (
              <ExamTimer
                deadlineAt={attempt.deadlineAt}
                onTimeout={handleTimeout}
                serverOffsetMs={serverOffsetRef.current}
              />
            )}
            {!deadlinePassed && (
              <Button
                variant="default"
                size="sm"
                onClick={() => void openSubmitDialog()}
                data-testid="take-submit-btn"
              >
                {t("candidateRuntime.actions.submit")}
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-4 xl:flex-row xl:items-start">
        <aside className="rounded-lg border bg-card p-3 xl:sticky xl:top-24 xl:max-h-[calc(100vh-8rem)] xl:w-24 xl:overflow-y-auto">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground xl:block">
            <span>{t("candidateRuntime.navigator.questionId")}</span>
            <span className="xl:hidden">
              {t("candidateRuntime.navigator.progress", {
                answered: answeredCount,
                unanswered: unansweredCount,
              })}
            </span>
          </div>
          <div className="overflow-x-auto xl:overflow-visible">
            <QuestionNavigator
              items={attempt.questionSnapshot.map((q, i) => ({
                id: q.originalQuestionId,
                number: i + 1,
                state: questionStates[i] ?? "unanswered",
              }))}
              currentId={
                attempt.questionSnapshot[currentIndex]?.originalQuestionId ?? ""
              }
              onSelect={(id) => {
                const idx = attempt.questionSnapshot.findIndex(
                  (q) => q.originalQuestionId === id,
                );
                if (idx >= 0) setCurrentIndex(idx);
              }}
            />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {saveRejection &&
              !isDisconnected &&
              (() => {
                const display = getSaveRejectionDisplay(saveRejection);
                return (
                  <Alert
                    variant="destructive"
                    className="border-destructive/30 bg-destructive/10"
                    data-testid="save-rejection-alert"
                  >
                    <display.Icon aria-hidden="true" />
                    <AlertTitle>{t(display.titleKey as never)}</AlertTitle>
                    <AlertDescription>
                      {t(display.descriptionKey as never)}
                    </AlertDescription>
                  </Alert>
                );
              })()}

            {isDisconnected && !deadlinePassed && (
              <Alert
                variant="destructive"
                className="border-destructive/30 bg-destructive/10"
              >
                <WifiOff aria-hidden="true" />
                <AlertTitle>
                  {t("candidateRuntime.connection.abnormal")}
                </AlertTitle>
                <AlertDescription>
                  {t("candidateRuntime.connection.restoreHint")}
                </AlertDescription>
              </Alert>
            )}

            <section
              className="relative rounded-lg border bg-card p-5 shadow-sm md:p-8"
              data-testid="take-question-section"
            >
              {deadlinePassed && (
                <div
                  className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm"
                  data-testid="deadline-overlay"
                >
                  <div className="flex flex-col items-center gap-3 text-center">
                    <TimerOff
                      className="size-12 text-destructive"
                      aria-hidden="true"
                    />
                    <div className="text-lg font-semibold text-foreground">
                      {autoSubmitFailed
                        ? t("candidateRuntime.deadline.autoSubmitTitle")
                        : t("candidateRuntime.deadline.timeUp")}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {autoSubmitFailed
                        ? t("candidateRuntime.deadline.retryHint")
                        : t("candidateRuntime.deadline.autoSubmitting")}
                    </div>
                    {autoSubmitFailed && (
                      <Button
                        onClick={() => void handleSubmit()}
                        data-testid="retry-submit-btn"
                      >
                        {t("candidateRuntime.actions.retrySubmit")}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <div>
                  <div className="text-sm text-muted-foreground">
                    {t("candidateRuntime.navigator.questionOf", {
                      current: currentIndex + 1,
                      total: attempt.questionSnapshot.length,
                    })}
                  </div>
                  <div className="text-sm font-medium text-muted-foreground">
                    {t("candidateRuntime.question.score", {
                      score: currentQuestion.score,
                    })}
                  </div>
                </div>
                {!deadlinePassed && (
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
                      ? t("candidateRuntime.actions.unflag")
                      : t("candidateRuntime.actions.flag")}
                  </Button>
                )}
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
                disabled={deadlinePassed}
              />
            </section>
          </div>
        </main>
      </div>

      <Separator />
      <footer className="sticky bottom-0 z-20 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">
            {t("candidateRuntime.navigator.progressFull", {
              answered: answeredCount,
              unanswered: unansweredCount,
              flagged: flaggedCount,
              total: attempt.questionSnapshot.length,
            })}
          </div>
          {!deadlinePassed && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrev}
                disabled={currentIndex === 0}
              >
                <ChevronLeft data-icon="inline-start" />
                {t("candidateRuntime.actions.previous")}
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
                {questionStates[currentIndex] === "flagged"
                  ? t("candidateRuntime.actions.unflag")
                  : t("candidateRuntime.actions.flag")}
              </Button>
              {currentIndex === attempt.questionSnapshot.length - 1 ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => void openSubmitDialog()}
                >
                  {t("candidateRuntime.actions.submitExam")}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={handleNext}>
                  {t("candidateRuntime.actions.next")}
                  <ChevronRight data-icon="inline-end" />
                </Button>
              )}
            </div>
          )}
        </div>
      </footer>

      <Dialog
        open={showSubmitDialog}
        onOpenChange={handleSubmitDialogOpenChange}
      >
        <DialogContent showCloseButton={!isFlushing}>
          <DialogHeader>
            <DialogTitle>
              {t("candidateRuntime.submitDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("candidateRuntime.submitDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-sm">
            {isFlushing && <p>{t("candidateRuntime.submitDialog.flushing")}</p>}
            {flushResult && (
              <>
                <p>
                  {t("candidateRuntime.submitDialog.unansweredLabel", {
                    count: unansweredCount,
                  })}
                </p>
                <p>
                  {t("candidateRuntime.submitDialog.unsavedLabel", {
                    count: unsavedCount,
                  })}
                </p>
                <p>
                  {t("candidateRuntime.submitDialog.saveFailedLabel", {
                    count: failedSaveCount,
                  })}
                </p>
              </>
            )}
            {failedSaveCount > 0 && (
              <p className="text-destructive">
                {t("candidateRuntime.submitDialog.saveFailedWarning")}
              </p>
            )}
            {flushTimedOut && (
              <p className="text-destructive">
                {t("candidateRuntime.submitDialog.saveTimeoutWarning")}
              </p>
            )}
            {flaggedCount > 0 && (
              <p>
                {t("candidateRuntime.submitDialog.flaggedWarning", {
                  count: flaggedCount,
                })}
              </p>
            )}
            <p className="text-destructive">
              {t("candidateRuntime.submitDialog.noModify")}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={cancelSubmitDialog}
              disabled={isFlushing}
            >
              {t("candidateRuntime.submitDialog.continueAnswering")}
            </Button>
            {flushTimedOut && (
              <Button
                variant="outline"
                onClick={() => void runSubmitFlush()}
                disabled={isSubmitting || isFlushing}
              >
                {t("candidateRuntime.actions.retry")}
              </Button>
            )}
            <Button
              onClick={() => void handleSubmit()}
              disabled={isSubmitting || isFlushing || requiresSubmitOverride}
              data-testid="confirm-submit-btn"
            >
              {isSubmitting
                ? t("candidateRuntime.submitDialog.submitting")
                : t("candidateRuntime.submitDialog.confirmSubmit")}
            </Button>
            {requiresSubmitOverride && (
              <Button
                variant="destructive"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting || isFlushing}
              >
                {isSubmitting
                  ? t("candidateRuntime.submitDialog.submitting")
                  : t("candidateRuntime.submitDialog.submitAnyway")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
