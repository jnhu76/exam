import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { ContentRenderer } from "@/components/shared/content/ContentRenderer";
import { toast } from "sonner";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CircleHelp,
  Flag,
  Lock,
  RotateCcw,
  LoaderCircle,
  TimerOff,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { routes } from "@/lib/routes";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { Separator } from "@/components/ui/separator";
import { AppIcon } from "@/components/shared/AppIcon";
import { PageContainer } from "@/components/shared/PageContainer";
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
// The transient UI state reducer owns the submit/load phases only (#971 R6:
// per-question save state derives from the save queue, not a global slot).
import { transientReducer, type TransientState } from "@/exam/transientReducer";
// Shell leave-guard seam (#971 F-01): the ExamLayout exits consult this
// page's guard before navigating away.
import {
  useRegisterLeaveGuard,
  type LeaveGuard,
} from "@/components/layout/leaveGuard";
// deriveTakeExamView drives every business-derived UI decision from the
// authoritative CandidateTakeSnapshot returned by the take endpoint. No
// frontend reconstruction of isEditable / canSave / answerSource / lock
// state is permitted.
import {
  deriveTakeExamView,
  isDeadlineFrozenSnapshot,
  type TakeExamView,
} from "@/exam/deriveTakeExamView";
import {
  isTerminalHeartbeatSignal,
  isTerminalSaveRejection,
} from "@/exam/terminalAttemptSignal";
import { trackExamEvent, clearPendingForAttempt } from "@/lib/examTelemetry";

type SaveRejectionDisplay = {
  Icon: typeof TimerOff;
  titleKey: string;
  descriptionKey: string;
};

/** Maps a save-rejection reason to its display icon and i18n keys.
 *
 * INVARIANT: every SaveAnswerRejectReason value has an explicit case here —
 * pinning the closed reason vocabulary so a reason can never silently fall
 * into the generic default (message contract D0.13 web-unit assertion).
 * STALE_VERSION surfaces here whenever the CURRENT revision was not
 * accepted; an old reply (a newer revision exists) never reaches this UI.
 */
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
    case "STALE_VERSION":
      return {
        Icon: Lock,
        titleKey: "candidateRuntime.saveRejection.title",
        descriptionKey: "candidateRuntime.saveRejection.staleVersion",
      };
    case "FUTURE_VERSION":
      return {
        Icon: Lock,
        titleKey: "candidateRuntime.saveRejection.title",
        descriptionKey: "candidateRuntime.saveRejection.futureVersion",
      };
    case "CONFLICTING_PAYLOAD":
      return {
        Icon: Lock,
        titleKey: "candidateRuntime.saveRejection.title",
        descriptionKey: "candidateRuntime.saveRejection.conflictingPayload",
      };
    case "INVALID_ANSWER":
      return {
        Icon: Lock,
        titleKey: "candidateRuntime.saveRejection.title",
        descriptionKey: "candidateRuntime.saveRejection.invalidAnswer",
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
 * Wire-failure classification shared by the save and heartbeat paths
 * (#800 PR-B A2-F7). One authority so the two paths cannot drift:
 *   transport   — the request never produced a server response. The api
 *                 client wraps fetch-level failures as ApiError status 0;
 *                 a non-ApiError throw carries no wire facts either, so it
 *                 is transport-class defensively.
 *   serverFault — an HTTP >= 500 response: the SERVER failed the request.
 *   neither     — an HTTP 4xx response: the server ANSWERED with a
 *                 protocol/business rejection, so it claims neither the
 *                 candidate's connectivity nor a server fault.
 * `isDisconnected` is the connection-banner slot flag ("saves cannot persist
 * right now"): transport and 5xx set it, a 4xx leaves it clear.
 */
function classifyWireFailure(err: unknown): {
  transport: boolean;
  serverFault: boolean;
  requestId: string | null;
} {
  const apiError = err instanceof ApiError ? err : null;
  return {
    transport: apiError === null || apiError.status === 0,
    serverFault: apiError !== null && apiError.status >= 500,
    requestId: apiError?.requestId ?? null,
  };
}

/**
 * Locked-state presentation branched by the AUTHORITATIVE snapshot lockReason
 * (#674). Each cause states only what is actually true:
 *   deadline  → time-up copy; 正在自动提交 ONLY while the auto-submit flow is
 *               genuinely in flight; a terminal deadline offers a next action.
 *   disrupted → recovery copy + a valid next action (direct restore retry when
 *               canResume, else navigation to the exam list per ADR-012);
 *               NEVER claims time-up or auto-submit.
 *   submitted / voided → terminal copy + navigation.
 *   absent    → neutral ended copy without auto-submit claims.
 * The snapshot remains the business authority; this component only projects
 * lockReason/canResume/showResult — it invents no business truth.
 */
function LockedOverlay({
  lockReason,
  canResume,
  showResult,
  autoSubmitting,
  autoSubmitFailed,
  onRetrySubmit,
  onRetryRestore,
  onBackToList,
  onViewResult,
}: {
  lockReason: TakeExamView["lockReason"];
  canResume: boolean;
  showResult: boolean;
  autoSubmitting: boolean;
  autoSubmitFailed: boolean;
  onRetrySubmit: () => void;
  onRetryRestore: () => void;
  onBackToList: () => void;
  onViewResult: () => void;
}) {
  const { t } = useTranslation();
  let icon = Lock;
  let titleKey = "candidateRuntime.status.ended";
  let descriptionKey: string | null = null;
  let hintKey: string | null = null;
  if (lockReason === "deadline") {
    icon = TimerOff;
    if (autoSubmitFailed) {
      titleKey = "candidateRuntime.deadline.autoSubmitTitle";
      descriptionKey = "candidateRuntime.deadline.retryHint";
    } else {
      titleKey = "candidateRuntime.deadline.timeUp";
      descriptionKey = autoSubmitting
        ? "candidateRuntime.deadline.autoSubmitting"
        : "candidateRuntime.deadline.endedHint";
    }
  } else if (lockReason === "disrupted") {
    icon = WifiOff;
    titleKey = "candidateRuntime.lock.disruptedTitle";
    descriptionKey = "candidateRuntime.lock.disruptedDescription";
    hintKey = canResume
      ? "candidateRuntime.lock.disruptedResumeHint"
      : "candidateRuntime.lock.disruptedBackHint";
  } else if (lockReason === "submitted") {
    titleKey = "candidateRuntime.lock.submittedTitle";
    descriptionKey = "candidateRuntime.lock.submittedDescription";
  } else if (lockReason === "voided") {
    titleKey = "candidateRuntime.lock.voidedTitle";
    descriptionKey = "candidateRuntime.lock.voidedDescription";
  }

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm"
      data-testid="deadline-overlay"
      data-lock-reason={lockReason ?? "unknown"}
      role="alert"
    >
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <AppIcon
          icon={icon}
          size="state"
          className={
            lockReason === "disrupted" ? undefined : "text-destructive"
          }
        />
        <div className="text-lg font-medium text-foreground">
          {t(titleKey as never)}
        </div>
        {descriptionKey && (
          <div className="type-secondary">{t(descriptionKey as never)}</div>
        )}
        {hintKey && <div className="type-secondary">{t(hintKey as never)}</div>}
        {lockReason === "deadline" && autoSubmitFailed && (
          <Button onClick={onRetrySubmit}>
            {t("candidateRuntime.actions.retrySubmit")}
          </Button>
        )}
        {lockReason === "disrupted" &&
          (canResume ? (
            <Button onClick={onRetryRestore}>
              {t("candidateRuntime.restore.retryRestore")}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={onBackToList}
              data-testid="lock-back-to-list-btn"
            >
              {t("candidateRuntime.lock.backToList")}
            </Button>
          ))}
        {(lockReason === "submitted" ||
          lockReason === "voided" ||
          lockReason === "deadline") &&
          !autoSubmitFailed && (
            <div className="flex flex-wrap justify-center gap-2">
              {showResult && lockReason !== "voided" && (
                <Button variant="outline" onClick={onViewResult}>
                  {t("candidateRuntime.lock.viewResult")}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={onBackToList}
                data-testid="lock-back-to-list-btn"
              >
                {t("candidateRuntime.lock.backToList")}
              </Button>
            </div>
          )}
      </div>
    </div>
  );
}

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
      className="mx-auto flex min-h-screen max-w-xl flex-col items-stretch justify-center gap-4 bg-background"
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
        <Button variant="outline" onClick={onBackToList}>
          {t("candidateRuntime.restore.backToList")}
        </Button>
        <Button ref={retryBtnRef} onClick={onRetry}>
          <AppIcon icon={RotateCcw} size="inline" />
          {t("candidateRuntime.restore.retryRestore")}
        </Button>
      </div>
    </div>
  );
}

type SubmitFactTone = "info" | "caution" | "destructive";

/**
 * One fact row of the submit-confirmation dialog (S3.4 / R1-F9). A non-zero
 * count renders as the soft-feedback toned pill (icon + full fact text — the
 * color triple never carries the signal alone); a zero count stays a quiet
 * secondary line. The tone triple is owned by feedback/recipes.css; this
 * component owns only the row geometry.
 */
function SubmitFactRow({
  testId,
  count,
  label,
  tone,
  icon,
}: {
  testId: string;
  count: number;
  label: string;
  tone: SubmitFactTone;
  icon: LucideIcon;
}) {
  if (count === 0) {
    return (
      <p data-testid={testId} className="type-secondary">
        {label}
      </p>
    );
  }
  return (
    <p
      data-testid={testId}
      data-feedback-tone={tone}
      className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-medium"
    >
      <AppIcon icon={icon} size="inline" />
      {label}
    </p>
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
  // #800 PR-B A2-F7: a save failure caused by a SERVER-side fault
  // (HTTP >= 500) must not read as the candidate's connectivity problem,
  // and an HTTP 4xx rejection (the server ANSWERED "no") must claim neither
  // connectivity nor server fault. isDisconnected keeps its "saves cannot
  // persist right now" banner-slot semantics — transport failures and 5xx
  // set it, a 4xx leaves it clear; success/heartbeat-restore clears it —
  // and saveServerFault only branches WHICH banner copy renders. A2-F2:
  // saveFaultRequestId carries the error envelope's requestId so the
  // server-fault banner can surface the support correlation id.
  const [saveServerFault, setSaveServerFault] = useState(false);
  const [saveFaultRequestId, setSaveFaultRequestId] = useState<string | null>(
    null,
  );
  const [saveRejection, setSaveRejection] = useState<SaveRejection | null>(
    null,
  );
  // #924: the correlation id a 200 business rejection's x-request-id response
  // header carried (browser-observed, client-claimed — never a server
  // authority). INVARIANT: written ONLY as the same-point unconditional
  // overwrite as setSaveRejection (a null header clears the prior id) so the
  // two states can never disagree — an alert showing q2's rejection copy
  // with q1's residual id would misdirect support correlation. Cleared at
  // exactly the three sites that clear saveRejection. Deliberately NOT
  // saveFaultRequestId: that one is the ERROR-envelope id behind the
  // server-fault banner with heartbeat live-probe supersede semantics —
  // different writers, different lifecycle, never merged (#800 A2-F2).
  const [saveRejectionRequestId, setSaveRejectionRequestId] = useState<
    string | null
  >(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [questionStates, setQuestionStates] = useState<QuestionState[]>([]);
  const [answers, setAnswers] = useState<Map<string, unknown>>(new Map());
  // #971 R6: the global save chip is DERIVED below from the save queue's
  // per-question revision statuses — there is no imperative global saveState
  // slot anymore (one question's success must not mask another's failure).
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  // `isSubmitting` is derived from transientState; `submittingRef` guards
  // re-entrant submit handlers within the same tick (the reducer state update
  // is async, so the ref is the synchronous guard).
  const [transientState, setTransientState] = useState<TransientState>("idle");
  const isSubmitting = transientState === "submitting";
  const [isFlushing, setIsFlushing] = useState(false);
  const [flushResult, setFlushResult] = useState<FlushResult | null>(null);
  const [autoSubmitFailed, setAutoSubmitFailed] = useState(false);
  // True ONLY while the real deadline auto-submit flow (flush + submit) is in
  // flight — the lock overlay's 正在自动提交 claim keys off this, never off
  // generic flush state (review U-R4: the submit-dialog flush shares
  // isFlushing and must not read as auto-submitting).
  const [deadlineAutoSubmitting, setDeadlineAutoSubmitting] = useState(false);
  // Synchronous mirror of deadlineAutoSubmitting for the leave guard (the
  // guard must decline exits during an auto-submit episode without waiting
  // for a render).
  const deadlineAutoSubmittingRef = useRef(false);
  // #971 F-01: controlled-leave lifecycle. "saving" holds the shell on the
  // page while the save queue drains and awaits server ACKs; "confirm" is
  // the explicit abandon decision when revisions remain unconfirmed.
  const [leavePhase, setLeavePhase] = useState<"idle" | "saving" | "confirm">(
    "idle",
  );
  // Synchronous mirror of leavePhase: an exit intent claims the page
  // SYNCHRONOUSLY (state updates are async), so a duplicate click or another
  // exit within the same tick can never join or start a second leave.
  const leaveIntentRef = useRef(false);
  const [leaveUnconfirmedCount, setLeaveUnconfirmedCount] = useState(0);
  const resolveLeaveDecisionRef = useRef<((leave: boolean) => void) | null>(
    null,
  );
  const versionsRef = useRef(new Map<string, number>());
  const clientSeqsRef = useRef(new Map<string, number>());
  const submittingRef = useRef(false);
  const deadlineHandledRef = useRef(false);
  // Monotonic instant (performance.now(), ms) of the last deferred deadline
  // verification. A deferral re-arms the episode, but the sibling trigger's
  // interval callback can land in the SAME tick window (both triggers tick at
  // 1s); this cooldown keeps one verification attempt per tick window instead
  // of letting the two triggers immediately re-declare back-to-back. It MUST
  // be monotonic, never the wall clock: a wall-clock rollback (NTP/manual
  // correction) would make the delta negative and suppress every retry even
  // after the heartbeat re-bases the server offset and the server-adjusted
  // expiry tick fires again — breaking page convergence until the wall clock
  // catches back up.
  const deadlineDeferredAtMonotonicRef = useRef<number | null>(null);
  const serverOffsetRef = useRef(0);
  const submitOpenerRef = useRef<HTMLElement | null>(null);
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
  // Unmount guard: a settled submit/auto-submit/heartbeat episode must not
  // call the router or write page state after the take page is gone.
  const mountedRef = useRef(true);
  // In-flight guard for the terminal-signal reconciliation re-read.
  // Concurrent terminal signals (heartbeat 409 + a settling autosave
  // rejection in the same episode) collapse into at most one active take GET.
  const reconciliationInFlightRef =
    useRef<Promise<CandidateTakeSnapshot | null> | null>(null);
  const {
    scheduleSave,
    flush,
    getScopeGeneration,
    getQuestionRevision,
    getSaveQueueSummary,
    failedQuestionIds,
  } = useSubmitFlush(attemptId);
  // Latest failure set / answers, readable from stable callbacks (heartbeat,
  // online listener) without stale-closure races.
  const failedQuestionIdsRef = useRef<string[]>(failedQuestionIds);
  failedQuestionIdsRef.current = failedQuestionIds;
  const answersRef = useRef(answers);
  answersRef.current = answers;

  /**
   * Re-saves every FAILED question through the EXISTING save orchestration
   * (#677 F6: online recovery + manual retry). No second save implementation
   * exists: each retry is saveAnswer → debounced coordinator → flush, so
   * baseVersion / clientSeq / replay semantics and the latest editor snapshot
   * are preserved by construction.
   */
  const retryFailedSaves = useCallback(async () => {
    if (!attemptId) return;
    if (viewRef.current && !viewRef.current.canSave) return;
    const retryIds = failedQuestionIdsRef.current.filter(
      (questionId) => answersRef.current.get(questionId) !== undefined,
    );
    for (const questionId of retryIds) {
      void saveAnswer(questionId, answersRef.current.get(questionId));
    }
    if (retryIds.length > 0) {
      await flush();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, flush]);

  /** Returns the current time adjusted by the server clock offset. */
  const nowByServerClock = useCallback(
    () => Date.now() + serverOffsetRef.current,
    [],
  );

  /**
   * Fetches the authoritative CandidateTakeSnapshot from
   * GET /api/candidate/attempts/:attemptId/take.
   *
   * This is the THROWING primitive. It is shared by the page's own loader
   * (which catches and sets `loadError`) and by the restore hook (which MUST
   * observe real failures so it can surface a recovery state). Splitting fetch
   * from apply is required: a loader that swallows its own error makes the
   * hook's reload-failure branch unreachable.
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
    setSaveServerFault(false);
    setSaveFaultRequestId(null);
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

  /**
   * One authoritative re-read per terminal-signal episode.
   *
   * Triggered by terminal heartbeat/save signals: re-reads
   * GET /api/candidate/attempts/:attemptId/take and routes the frozen
   * snapshot through the SAME applySnapshot seam as the page loader, so the
   * existing view derivation locks the UI (isLocked ← !snapshot.isEditable).
   * The signal only triggers the re-read; the snapshot remains the authority
   * — no client-invented terminal state.
   *
   * Deliberately does NOT flip isLoading (no full-page spinner flash on a
   * background convergence) and does NOT write loadError: a failed re-read
   * keeps the current UI and the terminal signal's own feedback (save
   * rejection alert), and the next heartbeat retries. The generation guard
   * (same discipline as loadSnapshot) rejects a reconciliation that resolves
   * after a route change or a superseding page-level load.
   *
   * Resolves with the fetched snapshot so callers that must DECIDE on server
   * state (the deadline auto-submit gate) can read the same authoritative
   * re-read instead of issuing a second GET; resolves null when the re-read
   * failed or was superseded. Fire-and-forget callers ignore the value.
   */
  const reconcileAuthoritativeAttempt =
    useCallback((): Promise<CandidateTakeSnapshot | null> => {
      if (!attemptId) return Promise.resolve(null);
      if (reconciliationInFlightRef.current) {
        return reconciliationInFlightRef.current;
      }
      const attemptAtStart = attemptId;
      const generationAtStart = loadGenerationRef.current;
      const promise = fetchSnapshot(attemptAtStart)
        .then((data) => {
          if (
            generationAtStart !== loadGenerationRef.current ||
            currentAttemptIdRef.current !== attemptAtStart
          ) {
            return null;
          }
          applySnapshot(data);
          return data;
        })
        .catch(() => {
          // Best-effort convergence; next terminal signal retries.
          return null;
        })
        .finally(() => {
          if (reconciliationInFlightRef.current === promise) {
            reconciliationInFlightRef.current = null;
          }
        });
      reconciliationInFlightRef.current = promise;
      return promise;
    }, [attemptId, fetchSnapshot, applySnapshot]);

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

  // Route/snapshot binding: the view MUST NOT be
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
    // leaks onto the new route. The save chip needs no reset: it derives
    // from the new scope's empty queue (#971 R6).
    setCurrentIndex(0);
    setQuestionStates([]);
    setAnswers(new Map());
    setSaveRejection(null);
    setSaveRejectionRequestId(null);
    setShowSubmitDialog(false);
    setTransientState("idle");
    setIsFlushing(false);
    setFlushResult(null);
    setAutoSubmitFailed(false);
    setDeadlineAutoSubmitting(false);
    deadlineAutoSubmittingRef.current = false;
    setLeavePhase("idle");
    setLeaveUnconfirmedCount(0);
    // A leave negotiation belongs to the attempt that started it: resolve
    // the awaiting shell exit as declined and drop the resolver so a late
    // flush result can neither open a dialog nor navigate on the new attempt.
    const resolveOldLeave = resolveLeaveDecisionRef.current;
    resolveLeaveDecisionRef.current = null;
    resolveOldLeave?.(false);
    setIsDisconnected(false);
    setSaveServerFault(false);
    setSaveFaultRequestId(null);
    // Reset attempt-scoped refs. versionsRef / clientSeqsRef will be rebuilt
    // from the new attempt's snapshot by applySnapshot, but clearing them now
    // avoids any window where stale save state could drive a save for the
    // wrong attempt.
    versionsRef.current = new Map();
    clientSeqsRef.current = new Map();
    submittingRef.current = false;
    deadlineHandledRef.current = false;
    deadlineDeferredAtMonotonicRef.current = null;
    heartbeatFailureRef.current = 0;
    heartbeatFailureReportedRef.current = false;
    // Drop any in-flight reconciliation from the PREVIOUS attempt.
    // The generation guard already makes its late apply a no-op; clearing the
    // ref here ensures the NEW attempt's terminal signals start a fresh
    // re-read instead of joining a promise that may never settle.
    reconciliationInFlightRef.current = null;
  }

  // The view is derived PURELY from the authoritative snapshot.
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
   * Authority guard: the save callback checks viewRef.current.canSave
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

    scheduleSave(questionId, async (revision: number) => {
      // Scope guard FIRST: a stale callback must not read the NEW attempt's
      // authority (viewRef/versionsRef/clientSeqsRef) at all. This runs
      // after the 1500ms debounce; if the route changed, bail before any
      // read or write.
      if (saveStale()) {
        return;
      }
      // Execution-time authority guard. The current view is read
      // from the ref so the latest snapshot (which may have been reloaded
      // during the debounce window) decides whether to save. This is the
      // authoritative seam — disabled controls alone are NOT sufficient.
      if (!viewRef.current?.canSave) {
        // Nothing was sent — the answer stays UNACKNOWLEDGED. The skip
        // rejects so the save queue records the question failed; the
        // derived chip (#971 R6) surfaces it as 保存失败 — never 保存中
        // stuck, never the synced claim: a skipped edit is a save that did
        // not happen.
        throw new Error("save skipped: attempt not saveable");
      }

      const saveStartedAt = Date.now();
      const baseVersion = versionsRef.current.get(questionId) ?? 0;
      const clientSeq = (clientSeqsRef.current.get(questionId) ?? 0) + 1;
      clientSeqsRef.current.set(questionId, clientSeq);
      // #800 PR-B A2-F5: started/failed events carry clientSeq so a
      // persisted telemetry row correlates with the receipt row keyed
      // (attemptId, questionId, clientSeq). clientSeq is a CANDIDATE
      // correlation key, not content identity: a reloaded client restarts
      // its per-question counter, so equal clientSeq does not prove same
      // content or same persistence outcome — the receipt's answerIdentity
      // digest is the content authority. Computed BEFORE the started event
      // so the started row already carries the key.
      trackExamEvent(
        "answer_autosave_started",
        { clientSeq },
        { attemptId, questionId },
      );
      let rejected = false;

      try {
        // #924: postWithMeta surfaces the 200 response's x-request-id header
        // so a BUSINESS rejection (accepted:false never forms an ApiError)
        // still leaves a client-claimed correlation id. Same URL, same
        // payload, same error contract — only the metadata wrapper differs.
        const { data: result, meta } =
          await api.postWithMeta<SaveAnswerResponseDTO>(
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
          setIsDisconnected(false);
          setSaveServerFault(false);
          setSaveFaultRequestId(null);
          setSaveRejection(null);
          setSaveRejectionRequestId(null);
          trackExamEvent(
            "answer_autosave_success",
            { durationMs: Date.now() - saveStartedAt, saveMode: "autosave" },
            { attemptId, questionId },
          );
          return;
        }

        if (result.reason === "STALE_VERSION") {
          // #971 R6: a STALE_VERSION reply always advances THIS scope's
          // knowledge of the server version — including an OLD reply that
          // settles after a newer edit was scheduled. The queue's
          // per-question revision is the identity authority: a response is
          // OLD exactly when the current revision has moved past the one
          // this closure was invoked with (a value comparison would call a
          // re-typed identical value "current").
          versionsRef.current.set(questionId, result.serverVersion);
          if (getQuestionRevision(questionId) !== revision) {
            // Old response: advance version knowledge only. A newer edit
            // owns the editor and the queue's status; this reply must not
            // claim anything for it.
            trackExamEvent(
              "answer_autosave_success",
              {
                durationMs: Date.now() - saveStartedAt,
                saveMode: "stale_version_advance",
              },
              { attemptId, questionId },
            );
            return;
          }
          // Current revision: the business did NOT accept this edit. The
          // candidate's pending input is left untouched and the reply falls
          // through to the existing rejection surfaces (alert + failed chip
          // + retry banner + leave abandon decision). Only accepted:true
          // confirms a save.
        }

        rejected = true;
        setSaveRejection(result);
        // Same-point unconditional overwrite (null clears a prior id) — see
        // the state declaration INVARIANT above.
        setSaveRejectionRequestId(meta.requestId);
        trackExamEvent(
          "answer_autosave_failed",
          {
            saveMode: "autosave",
            durationMs: Date.now() - saveStartedAt,
            errorCode: result.reason,
            // Client-claimed correlation candidate from the response header
            // (allowlisted in the monitoring projection); absent when the
            // hop carried no header — never fabricated.
            ...(meta.requestId ? { requestId: meta.requestId } : {}),
            clientSeq,
          },
          { attemptId, questionId, level: "warn" },
        );
        // A terminal rejection (attempt submitted/closed/deadline)
        // is an authority signal — re-read the frozen snapshot once so the
        // page locks instead of staying stale-editable. The accurate
        // rejection alert above remains the terminal feedback. Non-terminal
        // rejections (version conflicts, invalid answers) do NOT reconcile.
        if (isTerminalSaveRejection(result.reason)) {
          void reconcileAuthoritativeAttempt();
        }
        throw new Error("save rejected by server");
      } catch (err) {
        // Scope guard at the TOP of catch: api.post() rejecting does NOT go
        // through the post-await stale check above — without this guard a
        // network failure on the OLD attempt's save would write
        // setIsDisconnected(true) onto the NEW page. A stale save's failure
        // is not the new attempt's failure.
        if (saveStale()) {
          return;
        }
        if (!rejected) {
          // #800 PR-B A2-F1: an ApiError already carries the wire's machine
          // facts — record the stable code, HTTP status, and envelope
          // requestId so the client_events row joins the server's request.log
          // (errorCode keys are pre-allowed by ADR-012; status/requestId are
          // projected through the monitoring allowlist). Machine facts only:
          // the message text and stack never enter metadata (the shared
          // sanitizer additionally redacts content keys). A transport-level
          // failure carries no ApiError facts and keeps the NETWORK fallback
          // without mislabeling.
          const apiError = err instanceof ApiError ? err : null;
          // A2-F7 three-way contract (see {@link classifyWireFailure}):
          //   transport (status 0 / no ApiError) → connectivity banner;
          //   HTTP >= 500 → server-fault banner;
          //   HTTP 4xx → NO connectivity claim and NO server-fault claim —
          //     the server ANSWERED with a protocol/business rejection, so
          //     only the save-failed surface and the telemetry errorCode
          //     carry it. Semantically the same rejection as the typed
          //     envelope path above (accepted === false), delivered on the
          //     HTTP status channel instead of the reject vocabulary.
          const { transport, serverFault, requestId } =
            classifyWireFailure(err);
          setIsDisconnected(transport || serverFault);
          setSaveServerFault(serverFault);
          setSaveFaultRequestId(requestId);
          trackExamEvent(
            "answer_autosave_failed",
            {
              saveMode: "autosave",
              durationMs: Date.now() - saveStartedAt,
              errorCode: apiError?.code ?? "NETWORK",
              ...(apiError ? { status: apiError.status } : {}),
              ...(apiError?.requestId ? { requestId: apiError.requestId } : {}),
              clientSeq,
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
    // The POST may settle after the route switches attempts or unmounts.
    // Bind the episode to its issuing attempt/scope and never write the new
    // route's state, navigate it, or release its submittingRef.
    const attemptAtStart = attemptId;
    const scopeGenAtStart = getScopeGeneration();
    const stale = () =>
      !mountedRef.current ||
      currentAttemptIdRef.current !== attemptAtStart ||
      getScopeGeneration() !== scopeGenAtStart;
    try {
      await api.post(`/api/attempts/${attemptId}/submit`);
      trackExamEvent("submit_success", {}, { attemptId });
      if (stale()) return;
      setTransientState((s) => transientReducer(s, { type: "SUBMIT_SUCCESS" }));
      // Reload the authoritative snapshot so the locked /
      // submitted view is reconstructed from backend truth, then navigate.
      // The snapshot endpoint runs deadline reconciliation and returns the
      // frozen view; the result page will fetch its own authoritative data.
      try {
        await loadSnapshot();
      } catch {
        // Snapshot reload is best-effort here; result page is the canonical
        // post-submit destination and will surface any backend error.
      }
      // The reload is another await window: if the route switched while it
      // was in flight, the settled submit must not navigate the new route.
      if (stale()) return;
      navigate(routes.exam.result(attemptId));
    } catch (err) {
      trackExamEvent(
        "submit_failed",
        { errorCode: err instanceof Error ? "SUBMIT_ERROR" : "UNKNOWN" },
        { attemptId, level: "error" },
      );
      if (stale()) throw err;
      submittingRef.current = false;
      setTransientState((s) => transientReducer(s, { type: "SUBMIT_FAILED" }));
      toast.error(t("candidateRuntime.errors.submitFailed"));
      throw err;
    }
  }, [attemptId, getScopeGeneration, navigate, loadSnapshot, t]);

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
    // The submit dialog is opened programmatically (its buttons live outside
    // the <Dialog> subtree, so Radix has no trigger to restore focus from).
    // Remember the opener; onCloseAutoFocus returns focus to it (APG dialog
    // pattern).
    submitOpenerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
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

  /**
   * The shell's leave-guard answer (#971 F-01). Contract:
   *   1. an in-flight submit / auto-submit episode owns the page's next
   *      location (it navigates to the result route itself) → decline;
   *   2. a page that cannot save (frozen/disrupted attempt) owns nothing
   *      unconfirmed — its accepted answers are already the server-side
   *      scoring basis (EXSEM-008), and later saves are the server's
   *      rejections to make → allow;
   *   3. otherwise the EXISTING per-question serial save queue drains via
   *      flush() and the shell is held until the business ACKs arrive. The
   *      flush loop re-drains edits that arrive while it waits, so the leave
   *      criterion is always the LAST revision still needing a save;
   *   4. failed/timeout revisions keep the page and demand the explicit
   *      abandon decision — abandoning unconfirmed edits is never silent.
   *
   * Exactly ONE exit intent may be in flight. A duplicate click or a second
   * Exam-controlled exit is rejected synchronously (never joined): joining
   * would let one ACK release TWO navigations.
   *
   * Ownership is re-checked AFTER the flush or the explicit abandon decision
   * and BEFORE the shell performs the navigation: a deadline auto-submit
   * episode that declared during the wait, an in-flight submit, or an attempt
   * switch wins over the old exit.
   */
  const confirmLeave = useCallback(async (): Promise<boolean> => {
    if (leaveIntentRef.current) return false;
    if (submittingRef.current || deadlineAutoSubmittingRef.current) {
      return false;
    }

    const attemptAtStart = attemptId;
    const scopeGenAtStart = getScopeGeneration();
    // The attempt/scope identity captured at request time is the ownership
    // token: an exit belongs to the page state that asked for it. Submit
    // ownership comes from the synchronous refs (their state mirrors lag a
    // render behind).
    const ownsExit = () =>
      mountedRef.current &&
      currentAttemptIdRef.current === attemptAtStart &&
      getScopeGeneration() === scopeGenAtStart &&
      !submittingRef.current &&
      !deadlineAutoSubmittingRef.current;

    if (!ownsExit()) return false;
    if (!viewRef.current?.canSave) return true;

    leaveIntentRef.current = true;
    try {
      const before = getSaveQueueSummary();
      if (before.unconfirmedIds.length === 0 && before.failedIds.length === 0) {
        return true;
      }
      setLeavePhase("saving");
      const decision = new Promise<boolean>((resolve) => {
        resolveLeaveDecisionRef.current = resolve;
        void flush().then((result) => {
          // Cancellation can let another leave start before this flush ends.
          if (resolveLeaveDecisionRef.current !== resolve) return;
          if (
            result.timedOut ||
            result.pendingCount > 0 ||
            result.failedQuestionIds.length > 0
          ) {
            setLeaveUnconfirmedCount(
              result.pendingCount + result.failedQuestionIds.length,
            );
            setLeavePhase("confirm");
            return;
          }
          resolve(ownsExit());
        });
      });
      const leave = await decision;
      // Final ownership gate: after the flush ACK or the candidate's explicit
      // abandon confirmation, and before the shell actually navigates. An
      // episode or attempt switch that happened during the wait wins.
      return leave && ownsExit();
    } finally {
      resolveLeaveDecisionRef.current = null;
      setLeavePhase("idle");
      leaveIntentRef.current = false;
    }
  }, [attemptId, flush, getSaveQueueSummary, getScopeGeneration]);

  /** Resolves the in-flight leave decision from the hold/confirm dialogs. */
  const resolveLeaveDecision = useCallback((leave: boolean) => {
    resolveLeaveDecisionRef.current?.(leave);
  }, []);

  // A pending leave decision must not outlive the page: if the page unmounts
  // while an exit is being negotiated (e.g. the deadline episode navigated
  // first), the awaiting shell exit resolves as declined.
  useEffect(
    () => () => {
      resolveLeaveDecisionRef.current?.(false);
      resolveLeaveDecisionRef.current = null;
    },
    [],
  );

  const leaveGuard = useMemo<LeaveGuard>(
    () => ({ confirmLeave }),
    [confirmLeave],
  );
  useRegisterLeaveGuard(leaveGuard);

  /**
   * One deadline auto-submit episode, shared by BOTH triggers — the page's 1s
   * deadline tick and ExamTimer's onTimeout — so they cannot run competing
   * flows (F16; ADR-009 narrow scope: one episode, one declarer). Guards, in
   * order:
   *   1. the episode is already declared → no-op (the other trigger's view of
   *      the same deadline);
   *   2. a submit POST is already in flight → skip this tick WITHOUT
   *      declaring, so the next tick re-checks and the episode still fires
   *      once the in-flight submit settles. Declaring here would let the
   *      flow's handleSubmit silently no-op and record a phantom
   *      deadline_auto_submit_success while permanently disarming the retry
   *      path;
   *   3. otherwise declare and own the episode: flush (flush-before-submit is
   *      unchanged), then verify with the server, then submit.
   *   4. the episode is bound to the attempt that declared it: if the route
   *      changes while flush()/the verification read is awaiting, this
   *      invocation is abandoned. It must not submit/navigate the old
   *      attempt, toast onto the new route, or clear the new attempt's
   *      deadline indicator. Identity comes from the same currentAttemptIdRef
   *      + scope-generation authority as runSubmitFlush — no second token.
   *   5. SERVER AUTHORITY (ADR-006/ADR-026): local expiry — including
   *      ExamTimer's floored 00:00 display and a forward-jumped wall clock —
   *      is display-level evidence, never a submission authority. After the
   *      flush, the episode re-reads the authoritative /take snapshot. Only
   *      a snapshot that is frozen BY THE DEADLINE (lockReason 'deadline') or
   *      already terminal unlocks the irreversible ordinary submit; that POST
   *      then hits an attempt the server already froze, so reconciliation /
   *      crash recovery makes it idempotent and it can never be recorded as
   *      a candidate manual submit. An editable snapshot (server clock has
   *      not reached the deadline) or an unavailable verification read
   *      defers: NO submit, re-arm, and let the next tick re-check against
   *      the offset re-based by the applied snapshot.
   * Success/failure telemetry and autoSubmitFailed record only the REAL
   * result of this invocation's own submit: the submittingRef re-check below
   * is synchronous with the handleSubmit call, so a pass through it
   * guarantees the submit actually ran. A submit that started while the
   * flush was awaiting releases the declaration instead — that submit's own
   * outcome (navigate on success, released guard on failure) is the truth.
   */
  const runDeadlineAutoSubmit = useCallback(async () => {
    if (!attemptId || deadlineHandledRef.current) return;
    if (submittingRef.current) return;
    // One verification episode per tick window: a deferral (server has not
    // confirmed expiry) re-arms the episode, and the sibling trigger's
    // queued callback in the same window must wait for the next tick. The
    // cooldown runs on the monotonic clock; a wall-clock rollback must never
    // stretch it.
    if (
      deadlineDeferredAtMonotonicRef.current !== null &&
      performance.now() - deadlineDeferredAtMonotonicRef.current < 1000
    ) {
      return;
    }
    // An interval callback from the previous attempt can fire between the
    // route commit and its effect cleanup; it must not declare an episode
    // (or set the indicator) for the new attempt.
    if (!mountedRef.current || currentAttemptIdRef.current !== attemptId) {
      return;
    }
    const attemptAtStart = attemptId;
    const scopeGenAtStart = getScopeGeneration();
    const stale = () =>
      !mountedRef.current ||
      currentAttemptIdRef.current !== attemptAtStart ||
      getScopeGeneration() !== scopeGenAtStart;
    deadlineHandledRef.current = true;
    trackExamEvent("deadline_auto_submit_started", {}, { attemptId });
    setDeadlineAutoSubmitting(true);
    deadlineAutoSubmittingRef.current = true;
    // The episode owns the page's next location from this instant: decline
    // any pending leave negotiation and drop its resolver so a late flush
    // result can neither open the abandon dialog nor navigate.
    const resolvePendingLeave = resolveLeaveDecisionRef.current;
    resolveLeaveDecisionRef.current = null;
    resolvePendingLeave?.(false);

    let flushFailed = false;
    try {
      await flush();
    } catch {
      flushFailed = true;
    }

    if (flushFailed) {
      // A real flush failure stays attributable to the attempt that declared
      // the episode, even if the route has already moved on.
      trackExamEvent(
        "deadline_auto_submit_failed",
        { stage: "flush", errorCode: "FLUSH_ERROR" },
        { attemptId, level: "error" },
      );
    }

    if (stale()) {
      // The new route's render-time reset already owns its refs and UI.
      return;
    }

    if (flushFailed) {
      toast.error(t("candidateRuntime.errors.saveError"));
    }

    if (submittingRef.current) {
      // A submit started while the flush was awaiting (user-initiated).
      // This invocation's handleSubmit would silently no-op, so that
      // submit's outcome — not ours — is the real result: success
      // navigates away; failure releases submittingRef. Re-arm the
      // episode so the next tick can act on the settled truth. Never
      // claim success.
      deadlineHandledRef.current = false;
    } else {
      // SERVER AUTHORITY GATE (see guard 5 above): the authoritative /take
      // re-read both reconciles an expired attempt (freezing it as
      // deadline-submitted) and reports whether the server clock actually
      // agrees with the client's expiry belief.
      const verified = await reconcileAuthoritativeAttempt();
      if (stale()) {
        // The route changed during the verification read; the new route's
        // render-time reset owns its refs and UI.
        return;
      }
      if (submittingRef.current) {
        // A manual submit started while the verification read was in flight:
        // this invocation's handleSubmit would silently no-op behind its
        // guard, so that submit's outcome — not ours — is the real result
        // (success navigates away; failure releases submittingRef). Release
        // the declaration so the next tick can act on the settled truth.
        // Never claim success for a POST this episode did not execute.
        deadlineHandledRef.current = false;
      } else if (verified && isDeadlineFrozenSnapshot(verified)) {
        deadlineDeferredAtMonotonicRef.current = null;
        try {
          await handleSubmit();
          trackExamEvent("deadline_auto_submit_success", {}, { attemptId });
        } catch {
          trackExamEvent(
            "deadline_auto_submit_failed",
            { stage: "submit", errorCode: "SUBMIT_ERROR" },
            { attemptId, level: "error" },
          );
          if (!stale()) {
            setAutoSubmitFailed(true);
            toast.error(t("candidateRuntime.errors.autoSubmitFailed"));
          }
        }
      } else {
        // The server has NOT confirmed expiry: either the snapshot is still
        // editable (client clock ahead of the server clock) or the
        // verification read failed. An unverified local clock must never
        // execute the irreversible ordinary submit — the server would
        // freeze it as a legitimate manual submit before the real deadline,
        // destroying the candidate's remaining time. Defer, re-arm, and let
        // the next tick re-check against the offset re-based by the applied
        // snapshot. The server's own deadline scanner remains the
        // authoritative freeze path if the client never re-verifies.
        deadlineHandledRef.current = false;
        deadlineDeferredAtMonotonicRef.current = performance.now();
        trackExamEvent(
          "deadline_auto_submit_deferred",
          {
            reason: verified
              ? "server_deadline_not_reached"
              : "server_state_unavailable",
          },
          { attemptId, level: "warn" },
        );
      }
    }
    if (!stale()) {
      setDeadlineAutoSubmitting(false);
      deadlineAutoSubmittingRef.current = false;
    }
  }, [
    attemptId,
    flush,
    getScopeGeneration,
    handleSubmit,
    reconcileAuthoritativeAttempt,
    t,
  ]);

  /** Handles exam timer expiry through the shared deadline auto-submit seam. */
  const handleTimeout = useCallback(() => {
    void runDeadlineAutoSubmit();
  }, [runDeadlineAutoSubmit]);

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
    // A heartbeat may cross a route switch; its result belongs to the attempt
    // that issued it and must not touch the new attempt's connectivity state
    // or replay the new attempt's failed saves against the old URL.
    const attemptAtStart = attemptId;
    const scopeGenAtStart = getScopeGeneration();
    const stale = () =>
      !mountedRef.current ||
      currentAttemptIdRef.current !== attemptAtStart ||
      getScopeGeneration() !== scopeGenAtStart;
    try {
      const result = await api.post<{
        ok: true;
        serverNow: string;
      }>(`/api/attempts/${attemptId}/heartbeat`);
      if (stale()) return;
      if (result.serverNow) {
        serverOffsetRef.current =
          new Date(result.serverNow).getTime() - Date.now();
      }
      setIsDisconnected(false);
      setSaveServerFault(false);
      setSaveFaultRequestId(null);
      if (heartbeatFailureReportedRef.current) {
        trackExamEvent(
          "heartbeat_restored",
          { failedCount: heartbeatFailureRef.current },
          { attemptId },
        );
      }
      heartbeatFailureRef.current = 0;
      heartbeatFailureReportedRef.current = false;
      // Connectivity proven restored (server reachable again) — flush any
      // failed saves through the existing orchestration (#677 F6). Covers
      // dropouts where the browser never fired an `online` event.
      if (failedQuestionIdsRef.current.length > 0) {
        void retryFailedSaves();
      }
    } catch (err) {
      if (stale()) return;
      // A terminal heartbeat (409 INVALID_STATE_TRANSITION) is the
      // server reporting the attempt left in_progress — an authority signal,
      // NOT a connectivity failure. Re-read the frozen snapshot once (the
      // existing view derivation then locks the page); never show the
      // "connection restored" hint for an attempt that can no longer save.
      // Once the applied snapshot is already locked, no further re-read is
      // needed — the next 409 is a no-op, so convergence cannot loop.
      if (isTerminalHeartbeatSignal(err)) {
        if (!viewRef.current?.isLocked) {
          void reconcileAuthoritativeAttempt();
        }
        return;
      }
      // Same three-way contract as the save path (the terminal 409 above
      // already returned) — see {@link classifyWireFailure}: transport →
      // connectivity banner; HTTP >= 500 → server-fault banner; any other
      // 4xx means the server ANSWERED — no connectivity claim and no
      // server-fault claim. The heartbeat is a live probe, so its current
      // result supersedes a stale save-path classification (#800 PR-B A2-F7).
      const { transport, serverFault, requestId } = classifyWireFailure(err);
      setIsDisconnected(transport || serverFault);
      setSaveServerFault(serverFault);
      setSaveFaultRequestId(requestId);
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
  }, [
    attemptId,
    getScopeGeneration,
    reconcileAuthoritativeAttempt,
    retryFailedSaves,
  ]);

  // Browser network restoration: automatically re-save failed answers
  // (#677 F6 acceptance — no new keystroke required).
  useEffect(() => {
    const onOnline = () => {
      if (failedQuestionIdsRef.current.length > 0) {
        void retryFailedSaves();
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [retryFailedSaves]);

  // Layout effect cleanup runs synchronously on unmount, closing the
  // commit→passive-cleanup window in which a settling POST could still see
  // mountedRef === true and navigate the router.
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
  // concern and remains here. The flow itself lives in runDeadlineAutoSubmit,
  // shared with ExamTimer's onTimeout so both triggers declare ONE episode
  // (F16). After auto-submit fires, handleSubmit reloads the authoritative
  // snapshot (Step 8) so durable state is backend-sourced.
  useEffect(() => {
    if (!view?.effectiveDeadline || !view.canSubmit) return;

    if (nowByServerClock() < new Date(view.effectiveDeadline).getTime()) {
      deadlineHandledRef.current = false;
      deadlineDeferredAtMonotonicRef.current = null;
      setAutoSubmitFailed(false);
    }

    if (deadlineHandledRef.current) return;

    const checkDeadline = () => {
      if (nowByServerClock() >= new Date(view.effectiveDeadline!).getTime()) {
        void runDeadlineAutoSubmit();
      }
    };

    checkDeadline();
    const interval = setInterval(checkDeadline, 1000);
    return () => clearInterval(interval);
  }, [
    view?.effectiveDeadline,
    view?.canSubmit,
    runDeadlineAutoSubmit,
    nowByServerClock,
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
        <p className="type-secondary">
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

  // This is mechanical field-name mapping only (id/prompt/options/score) —
  // it does NOT derive isEditable / answerSource / lock / visibility.
  // No gradingRule: the candidate question contract structurally excludes the
  // internal grading object (EXSEM-017).
  const rendererQuestion = {
    originalQuestionId: currentQuestionView.id,
    type: currentQuestionView.type,
    content: currentQuestionView.prompt,
    contentDocument: currentQuestionView.promptDocument,
    answerMode: currentQuestionView.answerMode,
    attachments: [],
    options: currentQuestionView.options,
    score: currentQuestionView.maxScore,
    order: currentIndex,
  };

  const unansweredCount = questionStates.filter(
    (s) => s === "unanswered",
  ).length;
  const flaggedCount = questionStates.filter((s) => s === "flagged").length;
  const answeredCount = questionStates.filter(
    (s) => s === "answered" || s === "flagged",
  ).length;
  // #971 R6: the global save chip DERIVES from every question's latest
  // revision status in the active scope. Any failed/skipped revision reads
  // 保存失败 even while other questions saved; any pending/inflight revision
  // reads 保存中 even while other questions saved — a success can never mask
  // another question's unconfirmed or failed state. Only when EVERY touched
  // revision is acknowledged does the chip read the synced claim.
  const saveQueueSummary = getSaveQueueSummary();
  const saveState: SaveState =
    saveQueueSummary.failedIds.length > 0
      ? "error"
      : saveQueueSummary.unconfirmedIds.length > 0
        ? "saving"
        : saveQueueSummary.savedCount > 0
          ? "saved"
          : "idle";
  const failedSaveCount = flushResult?.failedQuestionIds.length ?? 0;
  const unsavedCount = flushResult
    ? flushResult.pendingCount + failedSaveCount
    : 0;
  const flushTimedOut = flushResult?.timedOut ?? false;
  const requiresSubmitOverride = failedSaveCount > 0 || flushTimedOut;

  return (
    <div className="-m-4 flex min-h-screen flex-col bg-background sm:-m-6">
      <header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <PageContainer
          role="exam-runtime"
          className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
        >
          <div>
            <div className="text-lg font-medium">
              {view.isLocked
                ? view.lockReason === "disrupted"
                  ? t("candidateRuntime.lock.disruptedTitle")
                  : t("candidateRuntime.status.ended")
                : t("candidateRuntime.status.inProgress")}
            </div>
            <div className="type-secondary">
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
              <div className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3">
                <span className="type-metadata">
                  {t("candidateRuntime.timer.cutoff")}
                </span>
                <span className="type-numeric text-sm font-medium">
                  {view.effectiveDeadline
                    ? formatDateTime(view.effectiveDeadline)
                    : "—"}
                </span>
              </div>
            )}
            {!view.isLocked && view.timingMode === "untimed" && (
              <div className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3">
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
        </PageContainer>
      </header>

      <PageContainer
        role="exam-runtime"
        className="flex w-full flex-1 flex-col gap-4 px-4 py-4 xl:flex-row xl:items-start"
      >
        <aside className="rounded-lg border bg-card p-3 xl:sticky xl:top-24 xl:max-h-[calc(100vh-8rem)] xl:w-24 xl:overflow-y-auto">
          <div className="mb-2 flex items-center justify-between type-metadata xl:block">
            <span>{t("candidateRuntime.navigator.questionId")}</span>
            <span className="xl:hidden">
              {t("candidateRuntime.navigator.progress", {
                answered: answeredCount,
                unanswered: unansweredCount,
              })}
            </span>
          </div>
          {/* INVARIANT (#683): the current-question ring (ring-2 ring-offset-2)
              paints 2–4px OUTSIDE the button box as ink overflow, which scroll
              containers clip on the left/top. p-1 gives the ring room inside
              the clip boundary; -m-1 keeps the buttons at the same visual
              position. Keep both classes paired with the ring geometry. */}
          <div className="-m-1 overflow-x-auto p-1 xl:overflow-visible">
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

        {/* A div, not <main>: ExamLayout already owns the page's main landmark. */}
        <div className="min-w-0 flex-1">
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
                      {saveRejectionRequestId && (
                        <>
                          {" "}
                          <span>
                            {t("candidateRuntime.saveRejection.requestId", {
                              requestId: saveRejectionRequestId,
                            })}
                          </span>
                        </>
                      )}
                    </AlertDescription>
                  </Alert>
                );
              })()}

            {isDisconnected &&
              !view.isLocked &&
              (saveServerFault ? (
                <Alert
                  variant="destructive"
                  className="border-destructive/30 bg-destructive/10"
                  data-testid="server-fault-alert"
                >
                  <AppIcon icon={TriangleAlert} size="inline" />
                  <AlertTitle>
                    {t("candidateRuntime.connection.serverError")}
                  </AlertTitle>
                  <AlertDescription>
                    {t("candidateRuntime.connection.serverErrorHint")}
                    {saveFaultRequestId && (
                      <>
                        {" "}
                        <span>
                          {t(
                            "candidateRuntime.connection.serverErrorRequestId",
                            { requestId: saveFaultRequestId },
                          )}
                        </span>
                      </>
                    )}
                  </AlertDescription>
                </Alert>
              ) : (
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
              ))}

            {/* Per-question failure set (#677 F6): driven by the save queue's
                authoritative failedQuestionIds, NOT the global chip — a later
                successful save of one question must not hide others' failure.
                Retry re-invokes the existing save orchestration. */}
            {failedQuestionIds.length > 0 && !view.isLocked && (
              <Alert
                variant="destructive"
                className="border-destructive/30 bg-destructive/10"
              >
                <AppIcon icon={TriangleAlert} size="inline" />
                <AlertTitle>
                  {t("candidateRuntime.saveRetry.bannerTitle")}
                </AlertTitle>
                <AlertDescription>
                  <span>
                    {t("candidateRuntime.saveRetry.bannerDescription")}
                  </span>{" "}
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="mt-1"
                    onClick={() => void retryFailedSaves()}
                  >
                    {t("candidateRuntime.saveRetry.retry")}
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <section
              className="relative surface-content p-5 md:p-8"
              data-testid="take-question-section"
            >
              {view.isLocked && (
                <LockedOverlay
                  lockReason={view.lockReason}
                  canResume={view.canResume}
                  showResult={view.showResult}
                  autoSubmitting={deadlineAutoSubmitting}
                  autoSubmitFailed={autoSubmitFailed}
                  onRetrySubmit={() => void handleSubmit()}
                  onRetryRestore={() => retryRestore()}
                  onBackToList={() => navigate(routes.exam.list)}
                  onViewResult={() =>
                    navigate(routes.exam.result(attemptId ?? ""))
                  }
                />
              )}
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <div>
                  <div className="type-secondary">
                    {t("candidateRuntime.navigator.questionOf", {
                      current: currentIndex + 1,
                      total: snapshot.questions.length,
                    })}
                  </div>
                  <div className="type-secondary">
                    {t("candidateRuntime.question.score", {
                      score: currentQuestionView.maxScore,
                    })}
                  </div>
                </div>
                {!view.isLocked && (
                  <Button variant="outline" size="sm" onClick={toggleFlag}>
                    {/* Deliberate raw Lucide render: AppIcon does not support the
                        fill toggle needed for flagged/unflagged visual state.
                        Governed to match inline role (16px/1.5px physical
                        stroke; attr 2.25 = 1.5 × 24/16). */}
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
                // Per-question disabled state comes from the
                // derived view (L0 §7.2), not a recalculated lock flag.
                disabled={currentQuestionView.disabled}
              />
            </section>
          </div>
        </div>
      </PageContainer>

      <Separator />
      <footer className="sticky bottom-0 z-20 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <PageContainer
          role="exam-runtime"
          className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
        >
          <div className="type-secondary">
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
                    Governed to match inline role (16px/1.5px physical
                    stroke; attr 2.25 = 1.5 × 24/16). */}
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
        </PageContainer>
      </footer>

      <Dialog
        open={showSubmitDialog}
        onOpenChange={handleSubmitDialogOpenChange}
      >
        <DialogContent
          showCloseButton={!isFlushing}
          onCloseAutoFocus={(event) => {
            const opener = submitOpenerRef.current;
            if (opener) {
              event.preventDefault();
              opener.focus();
            }
          }}
        >
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
              <div className="flex flex-col items-start gap-1.5">
                <SubmitFactRow
                  testId="submit-fact-unanswered"
                  count={unansweredCount}
                  label={t("candidateRuntime.submitDialog.unansweredLabel", {
                    count: unansweredCount,
                  })}
                  tone="info"
                  icon={CircleHelp}
                />
                <SubmitFactRow
                  testId="submit-fact-unsaved"
                  count={unsavedCount}
                  label={t("candidateRuntime.submitDialog.unsavedLabel", {
                    count: unsavedCount,
                  })}
                  tone="caution"
                  icon={CircleDashed}
                />
                <SubmitFactRow
                  testId="submit-fact-save-failed"
                  count={failedSaveCount}
                  label={t("candidateRuntime.submitDialog.saveFailedLabel", {
                    count: failedSaveCount,
                  })}
                  tone="destructive"
                  icon={TriangleAlert}
                />
              </div>
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

      {/* #971 F-01: ONE controlled-leave dialog. While the save queue drains
          it shows the held state; if revisions remain unconfirmed it turns
          into the explicit abandon decision. Any dismissal path (escape,
          overlay click, 留在本页) declines the exit — the candidate stays
          and can retry through the save banner. */}
      <Dialog
        open={leavePhase !== "idle"}
        onOpenChange={(open) => {
          if (!open) resolveLeaveDecision(false);
        }}
      >
        <DialogContent
          showCloseButton={false}
          data-testid={
            leavePhase === "confirm"
              ? "leave-abandon-dialog"
              : "leave-saving-dialog"
          }
        >
          {leavePhase === "confirm" ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("candidateRuntime.leaveGuard.confirmTitle")}
                </DialogTitle>
                <DialogDescription>
                  {t("candidateRuntime.leaveGuard.confirmDescription", {
                    count: leaveUnconfirmedCount,
                  })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => resolveLeaveDecision(false)}
                >
                  {t("candidateRuntime.leaveGuard.stayButton")}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => resolveLeaveDecision(true)}
                  data-testid="leave-abandon-confirm-btn"
                >
                  {t("candidateRuntime.leaveGuard.abandonButton")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("candidateRuntime.leaveGuard.savingTitle")}
                </DialogTitle>
                <DialogDescription>
                  {t("candidateRuntime.leaveGuard.savingDescription")}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => resolveLeaveDecision(false)}
                >
                  {t("candidateRuntime.leaveGuard.stayButton")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
