import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { ContentRenderer } from "@/components/shared/content/ContentRenderer";
import { toast } from "sonner";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  Lock,
  RotateCcw,
  LoaderCircle,
  TimerOff,
  WifiOff,
} from "lucide-react";
import { routes } from "@/lib/routes";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { Separator } from "@/components/ui/separator";
import { AppIcon } from "@/components/shared/AppIcon";
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
  CandidateTakeSnapshot,
  SaveAnswerResponseDTO,
} from "@exam/contracts";
// REC-I3: explicit disrupted-attempt direct restore (ADR-012). The hook owns
// only the restore UI state; CandidateTakeSnapshot remains the page authority.
import { useAttemptRestore } from "@/exam/useAttemptRestore";

type SaveRejection = Extract<SaveAnswerResponseDTO, { accepted: false }>;
import { useSubmitFlush, type FlushResult } from "@/hooks/useSubmitFlush";
// P3-FSM-0: transient UI state reducer is the single source of truth for the
// saving/submitting lifecycle. The backend CandidateTakeSnapshot remains the
// business truth source; this reducer only owns UI phases (L0 §7.3).
import { transientReducer, type TransientState } from "@/exam/transientReducer";
// P3-FSM-0: deriveTakeExamView drives every business-derived UI decision from
// the authoritative CandidateTakeSnapshot returned by the P3-PROTO-2 endpoint.
// No frontend reconstruction of isEditable / canSave / answerSource / lock
// state is permitted.
import { deriveTakeExamView } from "@/exam/deriveTakeExamView";
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

type QuestionState = "unanswered" | "answered" | "flagged";

/**
 * REC-I3 restore-failed recovery surface.
 *
 * Accessibility: the nested <Alert variant="destructive"> already carries
 * role="alert" (see apps/web/src/components/ui/alert.tsx), so this wrapper
 * does NOT duplicate role/aria-live on the outer div — a duplicate role would
 * cause some screen readers to announce the same alert region twice. The
 * retry button is auto-focused on mount so keyboard users land directly on
 * the primary recovery action without an extra Tab through "返回考试列表".
 */
function RestoreFailedSurface({
  onRetry,
  onBackToList,
}: {
  onRetry: () => void;
  onBackToList: () => void;
}) {
  const { t } = useTranslation();
  const retryBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    retryBtnRef.current?.focus();
  }, []);
  return (
    <div
      className="mx-auto flex min-h-screen max-w-xl flex-col items-stretch justify-center gap-4 bg-background p-6"
      data-testid="restore-failed-surface"
    >
      <Alert variant="destructive">
        <AppIcon icon={WifiOff} size="inline" />
        <AlertTitle>{t("candidateRuntime.restore.failedTitle")}</AlertTitle>
        <AlertDescription>
          {t("candidateRuntime.restore.failedDescription")}
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          onClick={onBackToList}
          data-testid="restore-back-to-list"
        >
          {t("candidateRuntime.restore.backToList")}
        </Button>
        <Button
          ref={retryBtnRef}
          onClick={onRetry}
          data-testid="restore-retry-btn"
        >
          <AppIcon icon={RotateCcw} size="inline" />
          {t("candidateRuntime.restore.retryRestore")}
        </Button>
      </div>
    </div>
  );
}

/** Active exam-taking page. Reads the authoritative CandidateTakeSnapshot. */
export function TakeExamPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { formatDateTime } = useProductDateTime();
  const [snapshot, setSnapshot] = useState<CandidateTakeSnapshot | null>(null);
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
  // P3-FSM-0: submit/save UI lifecycle now flows through transientReducer.
  // `isSubmitting` is derived from transientState; `submittingRef` still
  // guards against re-entrant submit handlers within the same tick (the
  // reducer state update is async, so the ref is the synchronous guard).
  const [transientState, setTransientState] = useState<TransientState>("idle");
  const isSubmitting = transientState === "submitting";
  const [isFlushing, setIsFlushing] = useState(false);
  const [flushResult, setFlushResult] = useState<FlushResult | null>(null);
  const [autoSubmitFailed, setAutoSubmitFailed] = useState(false);
  const versionsRef = useRef(new Map<string, number>());
  const clientSeqsRef = useRef(new Map<string, number>());
  const submittingRef = useRef(false);
  const deadlineHandledRef = useRef(false);
  const serverOffsetRef = useRef(0);
  // Latest view, kept in a ref so async save callbacks can read the current
  // authority (canSave) at execution time without stale-closure races.
  const viewRef = useRef<ReturnType<typeof deriveTakeExamView> | null>(null);
  // Heartbeat consecutive-failure tracking for telemetry. The heartbeat
  // network call itself is unchanged; these only decide when to emit
  // heartbeat_failed / heartbeat_restored so the table is not written on
  // every successful beat.
  const heartbeatFailureRef = useRef(0);
  const heartbeatFailureReportedRef = useRef(false);
  // Load generation token — the page-level guard against a stale GET
  // overwriting newer state. Bumped on EVERY loadSnapshot call (so two
  // concurrent loads of the SAME attempt cannot reorder: latest wins) AND on
  // a real route change (so a late GET from att-old cannot apply its snapshot
  // or write loadError/isLoading over the att-new page). The restore hook
  // already has its own generation guard; this one closes the page's own
  // loader (initial load, retry, post-submit reload) and any concurrent GET.
  const loadGenerationRef = useRef(0);
  const currentAttemptIdRef = useRef<string | undefined>(attemptId);
  const { scheduleSave, flush, getScopeGeneration } = useSubmitFlush(attemptId);

  /** Returns the current time adjusted by the server clock offset. */
  const nowByServerClock = useCallback(
    () => Date.now() + serverOffsetRef.current,
    [],
  );

  /**
   * Fetches the authoritative CandidateTakeSnapshot from
   * GET /api/candidate/attempts/:attemptId/take (P3-PROTO-2).
   *
   * This is the THROWING primitive. It is shared by the page's own loader
   * (which catches and sets `loadError`) and by the restore hook (which MUST
   * observe real failures so it can surface a recovery state). Splitting
   * fetch from apply is required because the previous monolithic loader
   * swallowed its own error, making the hook's reload-failure branch
   * unreachable (PR 219 review finding 4).
   */
  const fetchSnapshot = useCallback(
    (id: string): Promise<CandidateTakeSnapshot> =>
      api.get<CandidateTakeSnapshot>(`/api/candidate/attempts/${id}/take`),
    [],
  );

  /**
   * Applies an authoritative snapshot to page state. Pure state mutation —
   * no network. Factored out so both the page loader and the restore hook
   * route the authoritative snapshot through the SAME apply seam.
   */
  const applySnapshot = useCallback((data: CandidateTakeSnapshot) => {
    if (data.serverNow) {
      serverOffsetRef.current = new Date(data.serverNow).getTime() - Date.now();
    }
    setSnapshot(data);
    trackExamEvent(
      "exam_page_loaded",
      { status: data.attemptStatus },
      { attemptId: data.attemptId, examId: data.examId },
    );

    const answerMap = new Map<string, unknown>();
    const versionMap = new Map<string, number>();
    const clientSeqMap = new Map<string, number>();
    for (const q of data.questions) {
      if (q.answerValue != null) {
        answerMap.set(q.id, q.answerValue);
        // Restore server version and last clientSeq from snapshot so the
        // first save after reload uses a correct baseVersion and a fresh
        // clientSeq (max+1), avoiding CONFLICTING_PAYLOAD rejection.
        versionMap.set(q.id, q.currentVersion ?? 0);
        clientSeqMap.set(q.id, q.currentClientSeq ?? 0);
      }
    }
    setAnswers(answerMap);
    versionsRef.current = versionMap;
    clientSeqsRef.current = clientSeqMap;

    const states: QuestionState[] = data.questions.map((q) =>
      q.answerValue != null ? "answered" : "unanswered",
    );
    setQuestionStates(states);
    setIsDisconnected(false);
  }, []);

  /**
   * Page-level loader: fetch + apply, catching errors into `loadError` and
   * toggling `isLoading`. Used for initial load, ErrorState retry, and the
   * post-submit reload. The restore hook does NOT use this — it uses
   * `fetchSnapshot` directly so a reload failure is observable.
   *
   * Stale-request safe: each call captures its own load generation and the
   * attemptId it requested. After every await, both are re-checked — a late
   * GET from a previous route (or a previous retry) cannot apply its snapshot
   * or write loadError/isLoading onto the current page. This is the same
   * generation-guard discipline the restore hook uses; before this guard a
   * route change could leave the page pinned to an ErrorState when an OLD
   * GET resolved AFTER the NEW GET had already succeeded.
   */
  const loadSnapshot = useCallback(async () => {
    if (!attemptId) return;
    const requestedAttemptId = attemptId;
    // Pre-increment: every loadSnapshot call gets a fresh generation. Two
    // concurrent loads of the same attempt (StrictMode replay, retry during
    // load, post-submit reload overlapping initial load) then cannot reorder
    // — the later-issued load's result wins, and a late-resolving earlier
    // load is rejected at apply/loadError/isLoading time.
    const generation = ++loadGenerationRef.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await fetchSnapshot(requestedAttemptId);
      if (
        generation !== loadGenerationRef.current ||
        currentAttemptIdRef.current !== requestedAttemptId
      ) {
        return;
      }
      applySnapshot(data);
    } catch {
      if (
        generation !== loadGenerationRef.current ||
        currentAttemptIdRef.current !== requestedAttemptId
      ) {
        return;
      }
      trackExamEvent(
        "exam_page_loaded",
        { outcome: "failed" },
        { attemptId, level: "warn" },
      );
      setLoadError(t("candidateRuntime.errors.loadFailed"));
    } finally {
      if (
        generation === loadGenerationRef.current &&
        currentAttemptIdRef.current === requestedAttemptId
      ) {
        setIsLoading(false);
      }
    }
  }, [attemptId, fetchSnapshot, applySnapshot, t]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

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
      if (unloadedAttemptRef.current) {
        clearPendingForAttempt(unloadedAttemptRef.current);
      }
    },
    [],
  );

  // Route/snapshot binding (PR 219 review finding 1): the view MUST NOT be
  // derived from a snapshot whose attemptId disagrees with the current route
  // param. On a route change the old snapshot lingers for one render; if we
  // derived the view unconditionally, the restore hook could be called with
  // the OLD attempt's canResume against the NEW route's attemptId and POST
  // restore to the wrong attempt. Gating on `snapshotMatchesRoute` makes the
  // page render the initializing state until the new attempt's GET resolves.
  const snapshotMatchesRoute = Boolean(
    attemptId && snapshot?.attemptId === attemptId,
  );

  // Reset page state on a real route change so the previous attempt's view
  // never flashes for the new route. Render-time prev-value check (not an
  // effect): the reset must be visible in the same commit as the param
  // change, before any child effect reads stale state.
  //
  // This resets ALL attempt-scoped state — not just snapshot/loadError/
  // isLoading. A retained currentIndex (e.g. 9 from a 10-question exam)
  // applied to a 5-question new exam would make currentQuestionView null and
  // pin the page to the generic ErrorState, and Retry would not recover
  // because the snapshot reload does not reset currentIndex either. The save/
  // submit/transient/flush states and the submit/deadline refs are also
  // attempt-scoped and must not leak across routes.
  const prevAttemptIdRef = useRef<string | undefined>(attemptId);
  if (prevAttemptIdRef.current !== attemptId) {
    prevAttemptIdRef.current = attemptId;
    currentAttemptIdRef.current = attemptId;
    // Bump the load generation so any still-pending GET from the PREVIOUS
    // attempt is rejected at apply/loadError/isLoading time. Without this, a
    // late-resolving old GET could overwrite the new route's freshly-loaded
    // snapshot (or write loadError onto an already-loaded page).
    loadGenerationRef.current += 1;
    // Intentionally set during render: this is the documented React pattern
    // for "adjust state when a prop changes" (you may call setState during
    // render if you bail out of the rest of the render immediately after).
    setSnapshot(null);
    setLoadError(null);
    setIsLoading(true);
    // Reset all attempt-scoped UI state so nothing from the previous attempt
    // leaks onto the new route.
    setCurrentIndex(0);
    setQuestionStates([]);
    setAnswers(new Map());
    setSaveState("idle");
    setSaveRejection(null);
    setShowSubmitDialog(false);
    setTransientState("idle");
    setIsFlushing(false);
    setFlushResult(null);
    setAutoSubmitFailed(false);
    setIsDisconnected(false);
    // Reset attempt-scoped refs. versionsRef / clientSeqsRef will be rebuilt
    // from the new attempt's snapshot by applySnapshot, but clearing them now
    // avoids any window where stale save state could drive a save for the
    // wrong attempt.
    versionsRef.current = new Map();
    clientSeqsRef.current = new Map();
    submittingRef.current = false;
    deadlineHandledRef.current = false;
    heartbeatFailureRef.current = 0;
    heartbeatFailureReportedRef.current = false;
  }

  // P3-FSM-0: the view is derived PURELY from the authoritative snapshot.
  // This is the single business-view derivation seam (L0 §7.2). Every
  // business-derived UI decision must read from `view`, never reconstruct
  // isEditable/canSave/answerSource/lock/visibility from raw fields.
  const view = useMemo(
    () =>
      snapshotMatchesRoute && snapshot ? deriveTakeExamView(snapshot) : null,
    [snapshot, snapshotMatchesRoute],
  );
  viewRef.current = view;

  // REC-I3: explicit restore for a disrupted-but-resumable attempt. The hook
  // fires POST /api/attempts/:attemptId/restore exactly once when the
  // authoritative snapshot reports canResume=true, then re-reads the snapshot
  // (which remains the page authority). Capability fields — NOT raw status —
  // govern the action, and the snapshot is bound to the route so a stale
  // snapshot cannot drive a restore for the wrong attempt. See
  // docs/adr/ADR-012-candidate-recovery-contract.md.
  const { restoreState, retryRestore } = useAttemptRestore({
    attemptId,
    examId: snapshotMatchesRoute ? view?.examId : undefined,
    canResume: Boolean(snapshotMatchesRoute && view?.canResume),
    fetchSnapshot,
    applySnapshot,
  });
  const isRestoring = restoreState === "restoring";
  const restoreFailed = restoreState === "failed";

  const currentQuestionView = view?.questions[currentIndex] ?? null;
  const currentQuestionId = currentQuestionView?.id;
  const currentAnswer = currentQuestionId
    ? answers.get(currentQuestionId)
    : undefined;

  // question_viewed: fire on question change. Records only structural info.
  useEffect(() => {
    if (!snapshot || !currentQuestionView || !attemptId) return;
    trackExamEvent(
      "question_viewed",
      {
        index: currentIndex + 1,
        total: snapshot.questions.length,
        type: currentQuestionView.type,
      },
      {
        attemptId,
        examId: snapshot.examId,
        questionId: currentQuestionView.id,
      },
    );
  }, [snapshot, currentIndex, currentQuestionView, attemptId]);

  /**
   * Updates local answer state and schedules a versioned save.
   *
   * P3-FSM-0 authority guard: the save callback checks viewRef.current.canSave
   * at execution time (after the debounce window). A snapshot that becomes
   * non-saveable between schedule and execution is honored — no save request
   * is issued.
   */
  async function saveAnswer(questionId: string, answer: unknown) {
    if (!attemptId) return;

    setAnswers((prev) => new Map(prev).set(questionId, answer));
    setQuestionStates((prev) =>
      prev.map((state, index) =>
        view?.questions[index]?.id === questionId && state !== "flagged"
          ? "answered"
          : state,
      ),
    );

    setSaveState("saving");
    setTransientState((s) => transientReducer(s, { type: "SAVE_REQUEST" }));

    // Capture the save-scope generation at SCHEDULE time. The save queue is
    // attempt-scoped (useSubmitFlush(attemptId) installs a fresh scope per
    // attempt). If the route changes before the debounce timer fires, the
    // hook cancels the timer; but if the route changes while the network
    // request is in flight, the fetch completes against the OLD attempt's
    // URL (harmless) yet must NOT mutate THIS page's state/refs (which now
    // reflect the NEW attempt). `stale()` is re-checked before every read
    // of the current page authority and before every state/ref write.
    const scopeGenAtSchedule = getScopeGeneration();
    const saveStale = () => scopeGenAtSchedule !== getScopeGeneration();

    scheduleSave(questionId, async () => {
      // Scope guard FIRST: a stale callback must not read the NEW attempt's
      // authority (viewRef/versionsRef/clientSeqsRef) at all. This runs
      // after the 1500ms debounce; if the route changed, bail before any
      // read or write.
      if (saveStale()) {
        return;
      }
      // P3-FSM-0: execution-time authority guard. The current view is read
      // from the ref so the latest snapshot (which may have been reloaded
      // during the debounce window) decides whether to save. This is the
      // authoritative seam — disabled controls alone are NOT sufficient.
      if (!viewRef.current?.canSave) {
        return;
      }

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
        // Scope guard again after the await: an in-flight save that settles
        // after a route change must NOT write the NEW page's state/refs.
        if (saveStale()) {
          return;
        }

        if (result.accepted) {
          versionsRef.current.set(questionId, result.serverVersion);
          setSaveState("saved");
          setIsDisconnected(false);
          setSaveRejection(null);
          setTransientState((s) =>
            transientReducer(s, { type: "SAVE_SUCCESS" }),
          );
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
          setTransientState((s) =>
            transientReducer(s, { type: "SAVE_SUCCESS" }),
          );
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
        setTransientState((s) => transientReducer(s, { type: "SAVE_FAILED" }));
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
        // Scope guard at the TOP of catch: api.post() rejecting does NOT go
        // through the post-await stale check above — without this guard a
        // network failure on the OLD attempt's save would write saveState
        // "error" / setIsDisconnected(true) / transient SAVE_FAILED onto the
        // NEW page. A stale save's failure is not the new attempt's failure.
        if (saveStale()) {
          return;
        }
        setSaveState("error");
        setTransientState((s) => transientReducer(s, { type: "SAVE_FAILED" }));
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

  /**
   * Submits the attempt. After a successful submit, the durable
   * submitted/locked UI state is reconstructed by reloading the
   * authoritative CandidateTakeSnapshot (Step 8) — SUBMIT_SUCCESS itself is
   * only a transient event and is not the source of durable business state.
   */
  const handleSubmit = useCallback(async () => {
    if (!attemptId || submittingRef.current) return;
    submittingRef.current = true;
    setTransientState((s) => transientReducer(s, { type: "SUBMIT_REQUEST" }));
    trackExamEvent("submit_requested", {}, { attemptId });
    try {
      await api.post(`/api/attempts/${attemptId}/submit`);
      setTransientState((s) => transientReducer(s, { type: "SUBMIT_SUCCESS" }));
      trackExamEvent("submit_success", {}, { attemptId });
      // P3-FSM-0 Step 8: reload the authoritative snapshot so the locked /
      // submitted view is reconstructed from backend truth, then navigate.
      // The snapshot endpoint runs deadline reconciliation and returns the
      // frozen view; the result page will fetch its own authoritative data.
      try {
        await loadSnapshot();
      } catch {
        // Snapshot reload is best-effort here; result page is the canonical
        // post-submit destination and will surface any backend error.
      }
      navigate(routes.exam.result(attemptId));
    } catch (err) {
      submittingRef.current = false;
      setTransientState((s) => transientReducer(s, { type: "SUBMIT_FAILED" }));
      trackExamEvent(
        "submit_failed",
        { errorCode: err instanceof Error ? "SUBMIT_ERROR" : "UNKNOWN" },
        { attemptId, level: "error" },
      );
      toast.error(t("candidateRuntime.errors.submitFailed"));
      throw err;
    }
  }, [attemptId, navigate, loadSnapshot, t]);

  /**
   * Flushes all pending answer saves and records the flush result.
   *
   * Stale-guarded: if the route changes while a flush is awaiting (the
   * previous attempt's submit-flow flush, or a deadline auto-submit flush),
   * the late-resolving flush must NOT write its result / clear isFlushing
   * onto the NEW attempt's page. The hook's flush() is already scope-bound
   * (it captured its own scope at call time), but the page-side setState
   * here is a separate seam that needs its own guard.
   */
  const runSubmitFlush = useCallback(async () => {
    const attemptAtStart = attemptId;
    const scopeGenAtStart = getScopeGeneration();
    const stale = () =>
      currentAttemptIdRef.current !== attemptAtStart ||
      getScopeGeneration() !== scopeGenAtStart;

    setIsFlushing(true);
    setFlushResult(null);
    try {
      const result = await flush();
      if (!stale()) {
        setFlushResult(result);
      }
    } finally {
      if (!stale()) {
        setIsFlushing(false);
      }
    }
  }, [attemptId, flush, getScopeGeneration]);

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
          ? currentQuestionView && answers.has(currentQuestionView.id)
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
    if (snapshot && currentIndex < snapshot.questions.length - 1) {
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

  // Browser connectivity + visibility telemetry.
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

  // Deadline auto-submit. The deadline value comes from the snapshot's
  // effectiveDeadline (authoritative); the auto-submit side-effect is a UI
  // concern and remains here. After auto-submit fires, handleSubmit reloads
  // the authoritative snapshot (Step 8) so durable state is backend-sourced.
  useEffect(() => {
    if (!view?.effectiveDeadline || !view.canSubmit) return;

    if (nowByServerClock() < new Date(view.effectiveDeadline).getTime()) {
      deadlineHandledRef.current = false;
      setAutoSubmitFailed(false);
    }

    if (deadlineHandledRef.current) return;

    const checkDeadline = () => {
      if (deadlineHandledRef.current) return;
      if (nowByServerClock() >= new Date(view.effectiveDeadline!).getTime()) {
        deadlineHandledRef.current = true;
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
  }, [
    view?.effectiveDeadline,
    view?.canSubmit,
    flush,
    handleSubmit,
    nowByServerClock,
    attemptId,
    t,
  ]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState label={t("candidateRuntime.loading.attempt")} />
      </div>
    );
  }

  if (loadError || !snapshot || !view || !currentQuestionView) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <ErrorState
          message={loadError ?? t("candidateRuntime.errors.loadUnavailable")}
          onRetry={loadSnapshot}
        />
      </div>
    );
  }

  // REC-I3: while an explicit restore is in flight, render the restoring
  // surface — NOT the editable exam and NOT the deadline/time-up overlay
  // (which would otherwise appear merely because the disrupted snapshot has
  // isEditable=false). The snapshot stays authoritative; this is a UI state.
  if (isRestoring) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center"
        data-testid="restore-restoring-surface"
        role="status"
        aria-live="polite"
      >
        <AppIcon
          icon={LoaderCircle}
          size="state"
          className="animate-spin text-primary"
        />
        <h1 className="type-section-title">
          {t("candidateRuntime.restore.restoringTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("candidateRuntime.restore.restoringDescription")}
        </p>
      </div>
    );
  }

  // REC-I3: a restore network/server failure surfaces a dedicated recovery
  // state. It MUST NOT be represented as a save failure, and it MUST NOT
  // display deadline/time-up copy merely because the attempt is locked due
  // to disruption. The candidate may retry (a fresh POST is allowed) or
  // return to the exam list.
  if (restoreFailed) {
    return (
      <RestoreFailedSurface
        onRetry={() => retryRestore()}
        onBackToList={() => navigate(routes.exam.list)}
      />
    );
  }

  // Map the snapshot question to QuestionRenderer's expected prop shape.
  // This is mechanical field-name mapping only (id/prompt/options/score) —
  // it does NOT derive isEditable / answerSource / lock / visibility.
  const rendererQuestion = {
    originalQuestionId: currentQuestionView.id,
    type: currentQuestionView.type,
    content: currentQuestionView.prompt,
    contentDocument: currentQuestionView.promptDocument,
    answerMode: currentQuestionView.answerMode,
    attachments: [],
    options: currentQuestionView.options,
    score: currentQuestionView.maxScore,
    gradingRule: {
      multiSelectScoring: "all_correct_full" as const,
      fillBlankMatchMode: "exact" as const,
    },
    order: currentIndex,
  };

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
            <div className="text-lg font-medium">
              {view.isLocked
                ? t("candidateRuntime.status.ended")
                : t("candidateRuntime.status.inProgress")}
            </div>
            <div className="text-sm text-muted-foreground">
              {t("candidateRuntime.navigator.questionOf", {
                current: currentIndex + 1,
                total: snapshot.questions.length,
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SaveIndicator state={saveState} />
            {/* The personal countdown exists ONLY in timed_window mode
                (Phase A2 (Issue 291)). deadline mode shows a static cutoff time; an
                untimed exam shows the untimed badge. The snapshot's canonical
                timingMode is the gate — never a null effectiveDeadline. */}
            {!view.isLocked && view.timingMode === "timed_window" && (
              <ExamTimer
                deadlineAt={view.effectiveDeadline!}
                onTimeout={handleTimeout}
                serverOffsetMs={serverOffsetRef.current}
              />
            )}
            {!view.isLocked && view.timingMode === "deadline" && (
              <div
                data-testid="deadline-static"
                className="rounded-md border border-border bg-card px-3 py-1.5 text-right"
              >
                <div className="type-metadata">
                  {t("candidateRuntime.timer.cutoff")}
                </div>
                <span className="type-numeric text-sm font-medium leading-tight">
                  {view.effectiveDeadline
                    ? formatDateTime(view.effectiveDeadline)
                    : "—"}
                </span>
              </div>
            )}
            {!view.isLocked && view.timingMode === "untimed" && (
              <div
                data-testid="untimed-badge"
                className="rounded-md border border-border bg-card px-3 py-1.5"
              >
                <span className="type-metadata">
                  {t("candidateRuntime.timer.untimed")}
                </span>
              </div>
            )}
            {!view.isLocked && (
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
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground xl:block">
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
              items={snapshot.questions.map((q, i) => ({
                id: q.id,
                number: i + 1,
                state: questionStates[i] ?? "unanswered",
              }))}
              currentId={snapshot.questions[currentIndex]?.id ?? ""}
              onSelect={(id) => {
                const idx = snapshot.questions.findIndex((q) => q.id === id);
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
                    <AppIcon icon={display.Icon} size="inline" />
                    <AlertTitle>{t(display.titleKey as never)}</AlertTitle>
                    <AlertDescription>
                      {t(display.descriptionKey as never)}
                    </AlertDescription>
                  </Alert>
                );
              })()}

            {isDisconnected && !view.isLocked && (
              <Alert
                variant="destructive"
                className="border-destructive/30 bg-destructive/10"
              >
                <AppIcon icon={WifiOff} size="inline" />
                <AlertTitle>
                  {t("candidateRuntime.connection.abnormal")}
                </AlertTitle>
                <AlertDescription>
                  {t("candidateRuntime.connection.restoreHint")}
                </AlertDescription>
              </Alert>
            )}

            <section
              className="relative surface-content p-5 md:p-8"
              data-testid="take-question-section"
            >
              {view.isLocked && (
                <div
                  className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm"
                  data-testid="deadline-overlay"
                >
                  <div className="flex flex-col items-center gap-3 text-center">
                    <AppIcon
                      icon={TimerOff}
                      size="state"
                      className="text-destructive"
                    />
                    <div className="text-lg font-medium text-foreground">
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
                      total: snapshot.questions.length,
                    })}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t("candidateRuntime.question.score", {
                      score: currentQuestionView.maxScore,
                    })}
                  </div>
                </div>
                {!view.isLocked && (
                  <Button variant="outline" size="sm" onClick={toggleFlag}>
                    {/* Deliberate raw Lucide render: AppIcon does not support the
                        fill toggle needed for flagged/unflagged visual state.
                        Governed to match inline role (16px/1.75px). */}
                    <Flag
                      size={16}
                      strokeWidth={1.5}
                      absoluteStrokeWidth
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
              <div className="type-reading mb-8">
                <ContentRenderer
                  content={currentQuestionView.prompt}
                  document={currentQuestionView.promptDocument}
                />
              </div>
              <QuestionRenderer
                question={rendererQuestion}
                answer={currentAnswer}
                onChange={(answer) =>
                  saveAnswer(currentQuestionView.id, answer)
                }
                // P3-FSM-0 Step 6: per-question disabled state comes from the
                // derived view (L0 §7.2), not a recalculated lock flag.
                disabled={currentQuestionView.disabled}
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
              total: snapshot.questions.length,
            })}
          </div>
          {!view.isLocked && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrev}
                disabled={currentIndex === 0}
              >
                <AppIcon icon={ChevronLeft} size="inline" />
                {t("candidateRuntime.actions.previous")}
              </Button>
              <Button variant="outline" size="sm" onClick={toggleFlag}>
                {/* Deliberate raw Lucide render: AppIcon does not support the
                    fill toggle needed for flagged/unflagged visual state.
                    Governed to match inline role (16px/1.75px). */}
                <Flag
                  size={16}
                  strokeWidth={1.5}
                  absoluteStrokeWidth
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
              {currentIndex === snapshot.questions.length - 1 ? (
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
                  <AppIcon icon={ChevronRight} size="inline" />
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
