import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/capabilities";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Users, MonitorPlay } from "lucide-react";
import { createContextSafeUuid } from "@/lib/uuid";
import { getPendingGrantCoordinator } from "@/features/operator-grant/pendingGrantCoordinatorSingleton";
import {
  loadPendingForceSubmit,
  savePendingForceSubmit,
  clearPendingForceSubmit,
  type PendingForceSubmitCommand,
} from "@/features/force-submit/pendingForceSubmitAuthority";
import {
  CoordinationUnavailableError,
  AlreadyPendingError,
  LeaseConflictError,
  commandsEqual,
  type PendingGrantSendClaim,
} from "@/features/operator-grant/pendingGrantAuthority";
import type {
  CandidateStatusItem,
  CandidateStatusResponse,
  TimeGrantRequest,
  TimeGrantResponse,
} from "@exam/contracts";

/** Polling interval for the proctor dashboard (ms). */
const POLL_INTERVAL_MS = 5_000;

/** A frozen operator time-grant command — the exact bytes to (re)send. */
interface PendingTimeGrant {
  organizationId: string;
  attemptId: string;
  operationId: string;
  addedSeconds: number;
  reasonCode: string;
  reasonText: string;
}

/**
 * State machine for the time-grant dialog. `draft` holds a live operationId +
 * editable fields; the moment the user submits, a `PendingTimeGrant` is frozen
 * and the dialog moves to `submitting` carrying the full send claim (the
 * authority's operationId + revision + leaseId). On an unconfirmed failure the
 * dialog moves to `indeterminate`, which holds the frozen command but NO active
 * lease — a retry must re-acquire a send claim via `claimForSend` before it
 * may POST. Retry always replays the frozen command verbatim.
 *
 * `submitting` carries the FULL claim because it is the only phase that has a
 * right to send; `clearConfirmed` / `releaseIndeterminate` compare the whole
 * (operationId, revision, leaseId) triple so a late stale response cannot
 * corrupt a newer claim.
 */
type GrantDialogState =
  | {
      phase: "draft";
      operationId: string;
      minutes: number;
      reasonCode: string;
      reasonText: string;
    }
  | {
      phase: "submitting";
      command: PendingTimeGrant;
      claim: PendingGrantSendClaim;
    }
  | { phase: "indeterminate"; command: PendingTimeGrant };

/** Failure classification for a grant request outcome. */
type GrantFailureKind =
  | "indeterminate"
  | "confirmed_rejection"
  | "idempotency_conflict";

/**
 * Classifies a thrown grant error into the recovery action the UI must take.
 *
 *   indeterminate       — network drop / 5xx where the server's commit status
 *                         is unknown. KEEP the frozen command and reuse the
 *                         same operationId on retry (never mint a new one).
 *   confirmed_rejection — 4xx with a known code (validation / state / not
 *                         found). The command will never succeed as-sent; clear
 *                         it and let the admin re-edit.
 *   idempotency_conflict — the operationId was already committed for a
 *                         different payload. That identity is now unusable;
 *                         clear it and tell the admin a new command is needed.
 */
function classifyGrantFailure(error: unknown): GrantFailureKind {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: number }).status;
    const code = (error as { code?: string }).code;
    if (code === "IDEMPOTENCY_CONFLICT") return "idempotency_conflict";
    // status 0 = network failure (fetch threw); 5xx = server may or may not
    // have committed → treat as unconfirmed.
    if (status === 0 || status >= 500) return "indeterminate";
    // 4xx with a definitive code is a confirmed rejection.
    return "confirmed_rejection";
  }
  // Non-ApiError throw (defensive): treat as unconfirmed.
  return "indeterminate";
}

/** Groups candidates into status categories for the proctor dashboard. */
interface StatusGroups {
  active: CandidateStatusItem[];
  disrupted: CandidateStatusItem[];
  submitted: CandidateStatusItem[];
  graded: CandidateStatusItem[];
}

/**
 * Groups an array of candidate status items by their attempt status.
 */
function groupByStatus(candidates: CandidateStatusItem[]): StatusGroups {
  const groups: StatusGroups = {
    active: [],
    disrupted: [],
    submitted: [],
    graded: [],
  };
  for (const c of candidates) {
    if (c.status === "in_progress") {
      groups.active.push(c);
    } else if (c.status === "disrupted") {
      groups.disrupted.push(c);
    } else if (c.status === "submitted" || c.status === "grading") {
      groups.submitted.push(c);
    } else if (c.status === "graded") {
      groups.graded.push(c);
    }
    // not_started / queued / voided are not displayed in the status card groups
  }
  return groups;
}

/**
 * Proctor dashboard for monitoring live exam candidates via HTTP polling.
 * Displays status cards grouped by attempt state and exposes action buttons
 * for force-submit, time-grant, and misconduct flag.
 */
export function ProctorDashboardPage() {
  const { t } = useTranslation();
  const { formatTime } = useProductDateTime();
  const { user } = useAuthContext();
  const { id: examId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<CandidateStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  // Action dialogs
  const [extendDialogOpen, setExtendDialogOpen] = useState(false);
  const [extending, setExtending] = useState(false);
  const [extendTarget, setExtendTarget] = useState<CandidateStatusItem | null>(
    null,
  );
  // Operator time-grant dialog state machine (REC-I4-I3B2 + review P1-3/P1-4).
  //
  //   draft        — dialog open, operationId minted, fields still editable.
  //                  Submitting freezes a PendingTimeGrant and moves to
  //                  `submitting`.
  //   submitting   — a frozen command is in flight; fields are read-only.
  //   indeterminate— the request failed without a confirmed outcome (network
  //                  drop / 5xx where commit status is unknown). The frozen
  //                  command is RETAINED and reused verbatim on retry so the
  //                  same operationId cannot silently mint a duplicate grant.
  //                  It is also persisted through the shared coordinator
  //                  authority in localStorage so a refresh / navigation cannot
  //                  lose the pending identity.
  //
  // A confirmed outcome (granted / idempotent_replay / terminal), a confirmed
  // rejection (4xx with a known code), or an idempotency conflict clears the
  // frozen command. An indeterminate command for one attempt blocks opening a
  // grant dialog for a different attempt until it is resolved or discarded.
  const [grantState, setGrantState] = useState<GrantDialogState>(() => ({
    phase: "draft",
    operationId: createContextSafeUuid(),
    minutes: 10,
    reasonCode: "technical_incident",
    reasonText: "",
  }));

  const [misconductDialogOpen, setMisconductDialogOpen] = useState(false);
  const [misconductSeverity, setMisconductSeverity] = useState<
    "warning" | "serious"
  >("warning");
  const [misconductNotes, setMisconductNotes] = useState("");
  const [flagging, setFlagging] = useState(false);
  const [misconductTarget, setMisconductTarget] =
    useState<CandidateStatusItem | null>(null);

  const [forceSubmitting, setForceSubmitting] = useState(false);

  /**
   * Force-submit retry-identity state (J5-I1C Slice 2 review P1-2). A
   * force-submit is an operationId-keyed durable command; a lost response
   * after the server committed must NOT cause a retry to mint a NEW
   * operationId, or the effect is applied twice. The frozen command is
   * persisted in sessionStorage (same-tab) and reused verbatim on retry.
   *
   *   idle         — no command in flight.
   *   submitting   — a frozen command is in flight.
   *   indeterminate— the POST failed without a confirmed outcome (network
   *                  drop / 5xx); the frozen command is RETAINED and reused
   *                  verbatim on retry so the same operationId replays.
   */
  type ForceSubmitPhase =
    | { phase: "idle" }
    | {
        phase: "submitting";
        command: PendingForceSubmitCommand;
      }
    | { phase: "indeterminate"; command: PendingForceSubmitCommand };
  const [forceSubmitState, setForceSubmitState] = useState<ForceSubmitPhase>({
    phase: "idle",
  });
  /**
   * The attempt the force-submit dialog currently targets, and any pre-existing
   * pending command for a DIFFERENT attempt (which blocks opening the dialog
   * until resolved).
   */
  const [forceSubmitTargetAttemptId, setForceSubmitTargetAttemptId] = useState<
    string | null
  >(null);
  const [forceSubmitBlockedReason, setForceSubmitBlockedReason] = useState<
    string | null
  >(null);

  /** Fetches candidate status from the API. */
  const loadStatus = useCallback(async () => {
    if (!examId) return;
    setError(null);
    try {
      const result = await api.get<CandidateStatusResponse>(
        `/api/admin/exams/${examId}/candidates/status`,
      );
      setData(result);
    } catch {
      setError(t("admin.proctorDashboard.errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [examId, t]);

  useEffect(() => {
    loadStatus();
    intervalRef.current = setInterval(loadStatus, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loadStatus]);

  // REC-I4-C1: subscribe to cross-tab authority changes so this tab's dialog
  // state stays in sync when another tab reserves or clears a pending command.
  useEffect(() => {
    const coordinator = getPendingGrantCoordinator();
    const unsubscribe = coordinator.subscribe((event) => {
      // If the current grant dialog is in an indeterminate state and another
      // tab cleared the authority, close the dialog gracefully.
      if (
        event.type === "authority_cleared" &&
        (grantState.phase === "indeterminate" ||
          grantState.phase === "submitting")
      ) {
        resetGrantDialog();
      }
      // If another tab reserved a command while we're in draft, we don't
      // automatically close — the user will hit the reserve step on submit
      // and get the AlreadyPendingError flow.
    });
    return () => unsubscribe();
  }, [grantState.phase]);

  /**
   * Opens the force-submit confirmation for `attemptId`. Detects a pre-existing
   * pending command for the SAME attempt (e.g. from a prior lost response) and
   * restores it as `indeterminate` so the retry reuses the frozen operationId.
   * If a pending command exists for a DIFFERENT attempt, surfaces a block
   * warning. Sets the target attempt for the dialog description rendering.
   */
  function openForceSubmitDialog(attemptId: string) {
    if (!user) return;
    const pending = loadPendingForceSubmit(user.organizationId, user.id);
    setForceSubmitBlockedReason(null);
    setForceSubmitTargetAttemptId(attemptId);
    if (pending && pending.command.attemptId !== attemptId) {
      setForceSubmitBlockedReason(
        t("admin.proctorDashboard.forceSubmit.blockedPending"),
      );
      setForceSubmitState({ phase: "idle" });
      return;
    }
    if (pending && pending.command.attemptId === attemptId) {
      setForceSubmitState({ phase: "indeterminate", command: pending.command });
      return;
    }
    setForceSubmitState({ phase: "idle" });
  }

  /**
   * Force-submit confirm handler. Freezes the command (minting ONE
   * operationId for the whole user action, OR reusing the existing pending
   * command if this is a retry of the same attempt), persists it BEFORE the
   * POST (fail-closed), sends it, and classifies the outcome:
   *   - success (200, any disposition) → clear + success toast + reload;
   *   - indeterminate (network drop / 5xx, commit status unknown) → retain
   *     the frozen command and move to `indeterminate` so a retry reuses the
   *     SAME operationId (the lost-response retry-identity fix);
   *   - confirmed rejection (4xx) / idempotency conflict → clear + error toast.
   * On a retry (indeterminate → confirm), the frozen command is reused
   * verbatim — no new operationId is minted.
   */
  async function handleForceSubmitConfirm(attemptId: string) {
    if (!user) return;
    // If there is already a pending command for THIS attempt (a retry after a
    // lost response, possibly restored from sessionStorage), reuse it verbatim
    // — never mint a new operationId for the same user action.
    const pending = loadPendingForceSubmit(user.organizationId, user.id);
    const command =
      pending && pending.command.attemptId === attemptId
        ? pending.command
        : {
            attemptId,
            operationId: createContextSafeUuid(),
            reason: t("admin.proctorDashboard.forceSubmit.reason"),
          };
    savePendingForceSubmit({
      schemaVersion: 1,
      organizationId: user.organizationId,
      actorId: user.id,
      command,
      createdAt: Date.now(),
    });
    // Close the dialog immediately — the outcome (and any indeterminate
    // retry affordance) is shown on the candidate card.
    setForceSubmitTargetAttemptId(null);
    setForceSubmitBlockedReason(null);
    setForceSubmitState({ phase: "submitting", command });
    setForceSubmitting(true);
    try {
      await api.post(`/api/admin/attempts/${attemptId}/force-submit`, {
        operationId: command.operationId,
        reason: command.reason,
      });
      clearPendingForceSubmit(user.organizationId, user.id);
      setForceSubmitState({ phase: "idle" });
      setForceSubmitTargetAttemptId(null);
      toast.success(t("admin.proctorDashboard.forceSubmit.done"));
      await loadStatus();
    } catch (err) {
      const failure = classifyGrantFailure(err);
      if (failure === "indeterminate") {
        setForceSubmitState({ phase: "indeterminate", command });
        toast.error(t("admin.proctorDashboard.forceSubmit.indeterminate"));
        return;
      }
      clearPendingForceSubmit(user.organizationId, user.id);
      setForceSubmitState({ phase: "idle" });
      toast.error(
        err instanceof Error
          ? err.message
          : t("admin.proctorDashboard.errors.forceSubmitFailed"),
      );
    } finally {
      setForceSubmitting(false);
    }
  }

  /** Clears a retained indeterminate force-submit command (user dismissal). */
  function dismissForceSubmitIndeterminate() {
    if (!user) return;
    clearPendingForceSubmit(user.organizationId, user.id);
    setForceSubmitState({ phase: "idle" });
    setForceSubmitTargetAttemptId(null);
  }

  /**
   * Handles operator time grant for a candidate (REC-I4-C1 cross-tab authority).
   *
   * Send-claim ownership (REC-I4-C1 follow-up, issue 233):
   *   - draft        → `reserve` atomically grants the FIRST send claim; no
   *                    second claim step is needed before the first POST.
   *   - indeterminate→ every retry MUST `claimForSend` first. On
   *                    LeaseConflictError the POST is suppressed (another tab
   *                    is already sending), the frozen command is KEPT, and no
   *                    new operationId is minted.
   *
   * The `submitting` phase carries the full claim; confirmed outcomes clear via
   * `clearConfirmed(claim)` and indeterminate outcomes release via
   * `releaseIndeterminate(claim)`. A late stale response cannot corrupt a newer
   * claim because both APIs compare operationId + revision + leaseId.
   */
  async function handleGrantTime() {
    if (!extendTarget?.attemptId || !user) return;
    const orgId = user.organizationId;
    const attemptId = extendTarget.attemptId;
    const coordinator = getPendingGrantCoordinator();

    // Resolve the command + send claim for THIS attempt. From `draft` we freeze
    // a fresh command and acquire the first-send claim via `reserve`; from
    // `indeterminate` we replay the frozen command VERBATIM and must re-acquire
    // a send claim via `claimForSend` before any POST. Same operationId /
    // payload on retry so it can never drift into an idempotency conflict or a
    // duplicate grant.
    let command: PendingTimeGrant;
    let claim: PendingGrantSendClaim;
    if (grantState.phase === "draft") {
      command = {
        organizationId: orgId,
        attemptId,
        operationId: grantState.operationId,
        addedSeconds: grantState.minutes * 60,
        reasonCode: grantState.reasonCode,
        reasonText: grantState.reasonText.trim() || grantState.reasonCode,
      };
      // REC-I4-C1: reserve the command in the shared authority BEFORE sending
      // the HTTP request. If the shared authority is unavailable or another
      // tab already has a pending command, fail closed — never send a request
      // that could create a duplicate operationId. Reserve atomically grants
      // the first-send claim, so the first POST does not call claimForSend.
      const reserve = await coordinator.reserve(orgId, user.id, command);
      if (!reserve.ok) {
        if (reserve.error instanceof AlreadyPendingError) {
          const existing = reserve.error.existing;
          // Only restore the pending command when it targets THIS attempt.
          // Restoring a different attempt's frozen command would show a
          // dialog whose retry button is a dead affordance. For a different
          // attempt, block and reset to a fresh draft instead.
          toast.warning(
            t("admin.proctorDashboard.extendDialog.blockedByPending", {
              minutes: existing.command.addedSeconds / 60,
            }),
          );
          if (existing.command.attemptId === attemptId) {
            setGrantState({
              phase: "indeterminate",
              command: {
                organizationId: existing.organizationId,
                attemptId: existing.command.attemptId,
                operationId: existing.command.operationId,
                addedSeconds: existing.command.addedSeconds,
                reasonCode: existing.command.reasonCode,
                reasonText: existing.command.reasonText,
              },
            });
          } else {
            // A different attempt's command is still pending — direct the
            // proctor to resolve it first; do NOT open a dead dialog.
            resetGrantDialog();
          }
          return;
        }
        // CoordinationUnavailableError — fail closed.
        toast.error(
          t("admin.proctorDashboard.extendDialog.coordinationUnavailable"),
        );
        return;
      }
      claim = reserve.claim;
    } else {
      // indeterminate retry path.
      command = grantState.command;
      // Defensive: the frozen command must target the open dialog's attempt.
      if (command.attemptId !== attemptId) return;

      // Re-acquire a send claim atomically BEFORE the POST. This is the
      // cross-tab send-ownership gate: at most one tab may POST the frozen
      // command while a non-expired lease is held. The server remains the
      // final effect-safety authority; this coordinates the client sends.
      const claimed = await coordinator.claimForSend(orgId, user.id, command);
      if (!claimed.ok) {
        if (claimed.error instanceof LeaseConflictError) {
          // Another tab (or this tab's own prior lease) is still sending.
          // Do NOT POST; keep the frozen command; do not mint a new
          // operationId. Surface a retry-later message.
          toast.warning(t("admin.proctorDashboard.extendDialog.leaseConflict"));
          return;
        }
        // CoordinationUnavailableError — fail closed, do not POST.
        toast.error(
          t("admin.proctorDashboard.extendDialog.coordinationUnavailable"),
        );
        return;
      }
      // Always send the canonical stored command; claimForSend guarantees the
      // returned claim matches the stored frozen command's operationId.
      claim = claimed.claim;
    }

    setExtending(true);
    setGrantState({ phase: "submitting", command, claim });
    const body: TimeGrantRequest = {
      operationId: command.operationId,
      addedSeconds: command.addedSeconds,
      reasonCode: command.reasonCode,
      reasonText: command.reasonText,
    };

    // Clear the shared authority after a CONFIRMED HTTP outcome (or a
    // discardable failure). Uses the FULL claim so a stale response whose
    // lease was already released/re-claimed cannot delete a newer authority.
    // Surfaces a non-blocking warning if the clear itself failed (stale claim /
    // coordination unavailable) WITHOUT changing the grant's HTTP result — the
    // server is the source of truth for the deadline effect; the authority is
    // bookkeeping. A failed clear can leave a stale pending command visible to
    // other tabs, so the proctor is told to refresh / close other exam-admin
    // tabs.
    const clearAuthority = async (): Promise<void> => {
      const cleared = await coordinator.clearConfirmed(orgId, user.id, claim);
      if (!cleared.ok) {
        toast.warning(
          t("admin.proctorDashboard.extendDialog.clearStaleWarning"),
        );
      }
    };

    try {
      const res = await api.post<TimeGrantResponse, TimeGrantRequest>(
        `/api/admin/attempts/${attemptId}/time-grants`,
        body,
      );
      // All three outcomes are CONFIRMED results → clear the pending command
      // via full-claim compare-and-clear (only clears if the authority still
      // matches our operationId + revision + leaseId, preventing stale tabs
      // from deleting a newer authority).
      await clearAuthority();
      switch (res.outcome) {
        case "granted":
          toast.success(
            t("admin.proctorDashboard.extendDialog.done", {
              minutes: command.addedSeconds / 60,
            }),
          );
          break;
        case "idempotent_replay":
          // Same command was already committed; do not report a new grant.
          toast.success(t("admin.proctorDashboard.extendDialog.doneReplay"));
          break;
        case "terminal":
          // The attempt had already ended; NO time was added. Surface as a
          // warning, not a success, so the proctor does not misread it.
          toast.warning(t("admin.proctorDashboard.extendDialog.doneTerminal"));
          break;
      }
      // Confirmed result: close the dialog and reset to a fresh draft.
      resetGrantDialog();
      await loadStatus();
    } catch (err) {
      switch (classifyGrantFailure(err)) {
        case "indeterminate": {
          // Commit status unknown: surrender the active lease but KEEP the
          // frozen command so the same operationId is retried. releaseIndeterminate
          // bumps the authority revision so this (now stale) claim cannot later
          // clear or release a re-claimed authority. The dialog stays open with
          // the retry affordance (no active lease claimed).
          const released = await coordinator.releaseIndeterminate(
            orgId,
            user.id,
            claim,
          );
          if (released.ok) {
            setGrantState({ phase: "indeterminate", command });
            toast.warning(
              t("admin.proctorDashboard.extendDialog.indeterminate"),
            );
            break;
          }
          // Release MISMATCH: this claim no longer owns the authority (another
          // tab cleared/re-claimed it while our request was in flight). Do NOT
          // blindly revive a local indeterminate state — reconcile against the
          // SHARED AUTHORITY (the source of truth), otherwise a late stale
          // response arriving after an `authority_cleared` broadcast could
          // hide a closed dialog and block every other grant until refresh.
          await reconcileStaleRelease(orgId, user.id, command);
          break;
        }
        case "idempotency_conflict": {
          // The operationId is now unusable for this payload; clear it and
          // tell the admin a new command is required to retry.
          await clearAuthority();
          resetGrantDialog();
          toast.error(
            t("admin.proctorDashboard.extendDialog.idempotencyConflict"),
          );
          break;
        }
        case "confirmed_rejection":
        default: {
          // Definitive failure (validation / state / not-found): clear the
          // command and let the admin re-edit.
          await clearAuthority();
          resetGrantDialog();
          toast.error(
            err instanceof Error
              ? err.message
              : t("admin.proctorDashboard.errors.extendFailed"),
          );
          break;
        }
      }
    } finally {
      setExtending(false);
    }
  }

  /**
   * Reconciles local dialog state against the SHARED AUTHORITY after an
   * indeterminate retry's `releaseIndeterminate` returned a mismatch — i.e.
   * this tab's claim no longer owns the authority (another tab cleared it,
   * re-claimed it, or the lease was taken over while our request was in
   * flight). The shared authority is the source of truth; the local dialog
   * state is only a cache. Blindly turning a mismatch back into a local
   * `indeterminate` would risk a HIDDEN stale dialog (already-closed by an
   * `authority_cleared` broadcast) that blocks every other grant until refresh.
   *
   *   - authority cleared           → the command was resolved elsewhere;
   *                                    close the dialog and reset to a fresh
   *                                    draft (info toast, not an error).
   *   - same frozen command still    → it was re-claimed or re-released by
   *     pending under a new lease      another tab; keep retrying the SAME
   *                                    canonical command (indeterminate).
   *   - a DIFFERENT command pending  → a newer unrelated authority exists;
   *                                    reset to a fresh draft and point the
   *                                    proctor at the still-pending grant.
   *   - coordination unavailable     → cannot verify shared state; keep FAIL
   *                                    CLOSED on the frozen command (warning).
   *                                    The next retry re-enters this
   *                                    reconciliation via claimForSend.
   */
  async function reconcileStaleRelease(
    orgId: string,
    actorId: string,
    command: PendingTimeGrant,
  ): Promise<void> {
    const coordinator = getPendingGrantCoordinator();
    let current;
    try {
      current = await coordinator.getCurrent(orgId, actorId);
    } catch {
      // Defensive: getCurrent returns a Result, but guard a synchronous throw
      // the same way as CoordinationUnavailableError.
      setGrantState({ phase: "indeterminate", command });
      toast.warning(
        t("admin.proctorDashboard.extendDialog.releaseFailedWarning"),
      );
      return;
    }
    if (!current.ok) {
      // Cannot verify shared state — keep the frozen command (fail closed);
      // a later retry re-enters this reconciliation.
      setGrantState({ phase: "indeterminate", command });
      toast.warning(
        t("admin.proctorDashboard.extendDialog.releaseFailedWarning"),
      );
      return;
    }
    if (!current.authority) {
      // The command was resolved (confirmed + cleared) in another tab.
      resetGrantDialog();
      toast.info(t("admin.proctorDashboard.extendDialog.resolvedInAnotherTab"));
      return;
    }
    if (commandsEqual(current.authority.command, command)) {
      // The same frozen command is still pending under a new lease/release —
      // keep retrying the canonical identity.
      setGrantState({
        phase: "indeterminate",
        command: {
          organizationId: current.authority.organizationId,
          attemptId: current.authority.command.attemptId,
          operationId: current.authority.command.operationId,
          addedSeconds: current.authority.command.addedSeconds,
          reasonCode: current.authority.command.reasonCode,
          reasonText: current.authority.command.reasonText,
        },
      });
      return;
    }
    // A different command is now pending — do not revive a stale local dialog;
    // reset to a fresh draft and surface the still-pending grant.
    resetGrantDialog();
    toast.warning(
      t("admin.proctorDashboard.extendDialog.blockedByPending", {
        minutes: current.authority.command.addedSeconds / 60,
      }),
    );
  }

  /**
   * Resets the grant dialog to a fresh editable draft (new operationId, default
   * fields) and clears the dialog target. Used on confirmed outcomes and
   * discardable failures. The shared authority is cleared separately via
   * coordinator.clearConfirmed.
   */
  function resetGrantDialog() {
    setGrantState({
      phase: "draft",
      operationId: createContextSafeUuid(),
      minutes: 10,
      reasonCode: "technical_incident",
      reasonText: "",
    });
    setExtendDialogOpen(false);
    setExtendTarget(null);
  }

  /**
   * Opens the grant dialog for a candidate. Honors the cross-tab pending command
   * invariant (REC-I4-C1): if an unresolved command exists for THIS attempt,
   * restore it (so the proctor retries the same operationId); if one exists for
   * a DIFFERENT attempt, block opening and direct the proctor to resolve it
   * first (prevents a second in-flight grant that would mint a new identity).
   *
   * The SHARED AUTHORITY is the source of truth; the local in-memory state is
   * only a cache. The shared authority is read FIRST, before any local pre-check,
   * so a stale local indeterminate state (e.g. a late response that arrived
   * after another tab cleared the authority) cannot manufacture a false block.
   */
  async function openGrantDialog(candidate: CandidateStatusItem) {
    if (!user || !candidate.attemptId) return;
    const orgId = user.organizationId;
    const attemptId = candidate.attemptId;
    const coordinator = getPendingGrantCoordinator();

    setExtendTarget(candidate);

    // Read the shared authority FIRST (REC-I4-C1). This is authoritative for
    // cross-tab scenarios: another tab may have a pending command for this
    // attempt or a different attempt, OR may have already cleared a command
    // this tab still believes is pending locally.
    let current;
    try {
      current = await coordinator.getCurrent(orgId, user.id);
    } catch {
      // Defensive: getCurrent is declared to return a Result, but if anything
      // inside the coordinator throws synchronously (e.g. a future default-dependency
      // change), fail closed exactly like CoordinationUnavailableError.
      setExtendTarget(null);
      toast.error(
        t("admin.proctorDashboard.extendDialog.coordinationUnavailable"),
      );
      return;
    }
    if (!current.ok) {
      // Coordination unavailable (Web Locks / localStorage / corrupted record):
      // fail closed — do NOT open a fresh draft, which would mint a new
      // operationId that cannot be coordinated across tabs.
      setExtendTarget(null);
      toast.error(
        t("admin.proctorDashboard.extendDialog.coordinationUnavailable"),
      );
      return;
    }
    if (current.authority) {
      const pending = current.authority;
      if (pending.command.attemptId === attemptId) {
        // Same attempt — restore the exact frozen command. The `indeterminate`
        // phase holds the frozen command but NO active lease claim; the retry
        // button must re-acquire a send claim via claimForSend before POST.
        setGrantState({
          phase: "indeterminate",
          command: {
            organizationId: pending.organizationId,
            attemptId: pending.command.attemptId,
            operationId: pending.command.operationId,
            addedSeconds: pending.command.addedSeconds,
            reasonCode: pending.command.reasonCode,
            reasonText: pending.command.reasonText,
          },
        });
      } else {
        // Different attempt — block and show which attempt is pending.
        toast.warning(
          t("admin.proctorDashboard.extendDialog.blockedByPending", {
            minutes: pending.command.addedSeconds / 60,
          }),
        );
        setExtendTarget(null);
        return;
      }
    } else {
      // No shared pending command — create a fresh draft.
      setGrantState({
        phase: "draft",
        operationId: createContextSafeUuid(),
        minutes: 10,
        reasonCode: "technical_incident",
        reasonText: "",
      });
    }
    setExtendDialogOpen(true);
  }

  /**
   * Patches a subset of the editable draft fields. No-op when the dialog is not
   * in the `draft` phase (frozen commands are read-only). Centralizing the
   * `phase === "draft"` guard keeps the discriminated-union narrowing in one
   * place instead of each input's onChange.
   */
  function updateDraft(
    patch: Partial<
      Pick<
        Extract<GrantDialogState, { phase: "draft" }>,
        "minutes" | "reasonCode" | "reasonText"
      >
    >,
  ) {
    setGrantState((prev) =>
      prev.phase === "draft" ? { ...prev, ...patch } : prev,
    );
  }

  /** Handles misconduct flag for a candidate. */
  async function handleFlagMisconduct() {
    if (!misconductTarget?.attemptId || flagging) return;
    setFlagging(true);
    try {
      await api.post(
        `/api/admin/attempts/${misconductTarget.attemptId}/misconduct`,
        {
          severity: misconductSeverity,
          notes:
            misconductNotes ||
            t("admin.proctorDashboard.misconductDialog.defaultNotes"),
        },
      );
      toast.success(t("admin.proctorDashboard.misconductDialog.done"));
      setMisconductDialogOpen(false);
      setMisconductNotes("");
      await loadStatus();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("admin.proctorDashboard.errors.flagFailed"),
      );
    } finally {
      setFlagging(false);
    }
  }

  // Project the grant dialog fields from the state machine. In `draft` the
  // fields are live-editable; once a command is frozen (submitting /
  // indeterminate) the inputs render the frozen command read-only so a retry
  // cannot drift the payload.
  const grantFieldsEditable = grantState.phase === "draft";
  const grantMinutes =
    grantState.phase === "draft"
      ? grantState.minutes
      : Math.round(grantState.command.addedSeconds / 60);
  const grantReasonCode =
    grantState.phase === "draft"
      ? grantState.reasonCode
      : grantState.command.reasonCode;
  const grantReasonText =
    grantState.phase === "draft"
      ? grantState.reasonText
      : grantState.command.reasonText;
  // A frozen command (retry) is always submittable; a draft needs a positive
  // minute count and a non-empty reason.
  const canSubmitGrant =
    grantState.phase !== "draft" ||
    (grantState.minutes > 0 && grantState.reasonText.trim().length > 0);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadStatus} />;
  if (!data) return null;

  const groups = groupByStatus(data.candidates);
  const hasAnyCandidates = data.candidates.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.proctorDashboard.title")}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsLoading(true);
                void loadStatus();
              }}
            >
              <AppIcon icon={RefreshCw} size="inline" />
              {t("admin.proctorDashboard.actions.refresh")}
            </Button>
            <Button
              data-testid="proctor-monitor-link"
              variant="outline"
              size="sm"
              onClick={() =>
                examId && void navigate(routes.admin.examProctorMonitor(examId))
              }
            >
              <AppIcon icon={MonitorPlay} size="inline" />
              {t("admin.proctorDashboard.actions.monitor")}
            </Button>
            <Button variant="outline" onClick={() => navigate(-1)}>
              {t("admin.proctorDashboard.actions.back")}
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">
            {t("admin.proctorDashboard.tabs.all", { count: data.total })}
          </TabsTrigger>
          <TabsTrigger value="active">
            {t("admin.proctorDashboard.tabs.active", {
              count: groups.active.length,
            })}
          </TabsTrigger>
          <TabsTrigger value="disrupted">
            {t("admin.proctorDashboard.tabs.disrupted", {
              count: groups.disrupted.length,
            })}
          </TabsTrigger>
          <TabsTrigger value="submitted">
            {t("admin.proctorDashboard.tabs.submitted", {
              count: groups.submitted.length,
            })}
          </TabsTrigger>
          <TabsTrigger value="graded">
            {t("admin.proctorDashboard.tabs.graded", {
              count: groups.graded.length,
            })}
          </TabsTrigger>
        </TabsList>

        {!hasAnyCandidates && (
          <div className="mt-4">
            <EmptyState
              icon={<AppIcon icon={Users} size="state" />}
              title={t("admin.proctorDashboard.empty.title")}
              description={t("admin.proctorDashboard.empty.description")}
            />
          </div>
        )}

        <TabsContent value="all" className="mt-4">
          {renderCards(data.candidates)}
        </TabsContent>
        <TabsContent value="active" className="mt-4">
          {renderCards(groups.active)}
        </TabsContent>
        <TabsContent value="disrupted" className="mt-4">
          {renderCards(groups.disrupted)}
        </TabsContent>
        <TabsContent value="submitted" className="mt-4">
          {renderCards(groups.submitted)}
        </TabsContent>
        <TabsContent value="graded" className="mt-4">
          {renderCards(groups.graded)}
        </TabsContent>
      </Tabs>

      {/* Operator time grant dialog */}
      <Dialog
        open={extendDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            // Closing in `draft` (nothing sent yet) is a free cancel — clear
            // the identity. Closing while a command is `submitting` or
            // `indeterminate` KEEPS the frozen command alive: its operationId
            // may already be committed server-side, so discarding it would
            // risk minting a duplicate on the next open.
            if (grantState.phase === "draft") {
              resetGrantDialog();
            } else {
              setExtendDialogOpen(false);
            }
          } else {
            setExtendDialogOpen(open);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("admin.proctorDashboard.extendDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.proctorDashboard.extendDialog.description", {
                name: extendTarget?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          {grantState.phase === "indeterminate" && (
            <div
              role="alert"
              className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
            >
              {t("admin.proctorDashboard.extendDialog.indeterminateBanner")}
            </div>
          )}
          <div className="flex flex-col gap-3 py-2">
            <Label htmlFor="extend-minutes">
              {t("admin.proctorDashboard.extendDialog.minutesLabel")}
            </Label>
            <Input
              id="extend-minutes"
              type="number"
              min={1}
              value={grantMinutes}
              disabled={!grantFieldsEditable}
              onChange={(e) =>
                updateDraft({
                  minutes: Number.parseInt(e.target.value, 10) || 0,
                })
              }
            />
            <Label htmlFor="grant-reason-code">
              {t("admin.proctorDashboard.extendDialog.reasonCodeLabel")}
            </Label>
            <Select
              value={grantReasonCode}
              disabled={!grantFieldsEditable}
              onValueChange={(v) => updateDraft({ reasonCode: v })}
            >
              <SelectTrigger id="grant-reason-code">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="technical_incident">
                  {t(
                    "admin.proctorDashboard.extendDialog.reasonCodeTechnicalIncident",
                  )}
                </SelectItem>
                <SelectItem value="candidate_request">
                  {t(
                    "admin.proctorDashboard.extendDialog.reasonCodeCandidateRequest",
                  )}
                </SelectItem>
                <SelectItem value="other">
                  {t("admin.proctorDashboard.extendDialog.reasonCodeOther")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Label htmlFor="grant-reason-text">
              {t("admin.proctorDashboard.extendDialog.reasonTextLabel")}
            </Label>
            <Textarea
              id="grant-reason-text"
              value={grantReasonText}
              disabled={!grantFieldsEditable}
              onChange={(e) => updateDraft({ reasonText: e.target.value })}
              placeholder={t(
                "admin.proctorDashboard.extendDialog.reasonTextPlaceholder",
              )}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExtendDialogOpen(false)}
            >
              {t("admin.proctorDashboard.extendDialog.cancel")}
            </Button>
            <Button
              disabled={extending || !canSubmitGrant}
              onClick={() => void handleGrantTime()}
            >
              {extending
                ? t("admin.proctorDashboard.extendDialog.confirming")
                : grantState.phase === "indeterminate"
                  ? t("admin.proctorDashboard.extendDialog.retry")
                  : t("admin.proctorDashboard.extendDialog.confirm", {
                      minutes: grantMinutes,
                    })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Misconduct dialog */}
      <Dialog
        open={misconductDialogOpen}
        onOpenChange={setMisconductDialogOpen}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("admin.proctorDashboard.misconductDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.proctorDashboard.misconductDialog.description", {
                name: misconductTarget?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Label htmlFor="misconduct-severity">
              {t("admin.proctorDashboard.misconductDialog.severityLabel")}
            </Label>
            <Select
              value={misconductSeverity}
              onValueChange={(v: "warning" | "serious") =>
                setMisconductSeverity(v)
              }
            >
              <SelectTrigger id="misconduct-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warning">
                  {t("admin.proctorDashboard.misconductDialog.severityWarning")}
                </SelectItem>
                <SelectItem value="serious">
                  {t("admin.proctorDashboard.misconductDialog.severitySerious")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Label htmlFor="misconduct-notes">
              {t("admin.proctorDashboard.misconductDialog.notesLabel")}
            </Label>
            <Textarea
              id="misconduct-notes"
              value={misconductNotes}
              onChange={(e) => setMisconductNotes(e.target.value)}
              placeholder={t(
                "admin.proctorDashboard.misconductDialog.notesPlaceholder",
              )}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMisconductDialogOpen(false)}
            >
              {t("admin.proctorDashboard.misconductDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={flagging || !misconductNotes.trim()}
              onClick={() => void handleFlagMisconduct()}
            >
              {flagging
                ? t("admin.proctorDashboard.misconductDialog.flagging")
                : t("admin.proctorDashboard.misconductDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force-submit confirmation dialog (J5-I1C Slice 2 review P1-2).
          Controlled Dialog (like the time-grant dialog) so opening is driven by
          React state, and the retry state is rendered inside the dialog. */}
      <Dialog
        open={forceSubmitTargetAttemptId !== null}
        onOpenChange={(open) => {
          if (!open && forceSubmitState.phase !== "submitting") {
            setForceSubmitTargetAttemptId(null);
            setForceSubmitBlockedReason(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("admin.proctorDashboard.forceSubmit.title")}
            </DialogTitle>
            <DialogDescription>
              {forceSubmitState.phase === "indeterminate" &&
              forceSubmitState.command.attemptId === forceSubmitTargetAttemptId
                ? t("admin.proctorDashboard.forceSubmit.retryDescription")
                : t("admin.proctorDashboard.forceSubmit.description", {
                    name:
                      data?.candidates.find(
                        (c) => c.attemptId === forceSubmitTargetAttemptId,
                      )?.name ?? "",
                  })}
            </DialogDescription>
          </DialogHeader>
          {forceSubmitBlockedReason && (
            <p className="text-sm text-destructive">
              {forceSubmitBlockedReason}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={forceSubmitting}
              onClick={() => {
                setForceSubmitTargetAttemptId(null);
                setForceSubmitBlockedReason(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={forceSubmitting || forceSubmitBlockedReason !== null}
              onClick={() => {
                if (forceSubmitTargetAttemptId) {
                  void handleForceSubmitConfirm(forceSubmitTargetAttemptId);
                }
              }}
            >
              {forceSubmitState.phase === "indeterminate"
                ? t("admin.proctorDashboard.forceSubmit.retry")
                : t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  /** Renders a grid of candidate status cards. */
  function renderCards(items: CandidateStatusItem[]) {
    if (items.length === 0) {
      return (
        <EmptyState
          icon={<AppIcon icon={Users} size="state" />}
          title={t("admin.proctorDashboard.empty.filteredTitle")}
          description={t("admin.proctorDashboard.empty.filteredDescription")}
        />
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((candidate) => {
          const isLive =
            candidate.status === "in_progress" ||
            candidate.status === "disrupted";
          return (
            <Card key={candidate.candidateId}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium truncate">
                    {candidate.name}
                  </CardTitle>
                  <StatusBadge status={candidate.status} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-xs">
                {candidate.deadlineAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("admin.proctorDashboard.card.deadline")}
                    </span>
                    <span>{formatTime(candidate.deadlineAt)}</span>
                  </div>
                )}
                {candidate.lastActivityAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("admin.proctorDashboard.card.lastActivity")}
                    </span>
                    <span>{formatTime(candidate.lastActivityAt)}</span>
                  </div>
                )}
                {candidate.misconduct && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge
                      status={`misconduct_${candidate.misconduct.severity}`}
                      className="w-fit"
                    />
                    {candidate.misconduct.notes && (
                      <span className="text-muted-foreground">
                        {candidate.misconduct.notes}
                      </span>
                    )}
                  </div>
                )}
                {isLive && candidate.attemptId && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(candidate.status === "in_progress" ||
                      candidate.status === "disrupted") && (
                      <>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={forceSubmitting}
                          onClick={() =>
                            openForceSubmitDialog(candidate.attemptId!)
                          }
                        >
                          {t("admin.proctorDashboard.card.forceSubmit")}
                        </Button>
                        {forceSubmitState.phase === "indeterminate" &&
                          forceSubmitState.command.attemptId ===
                            candidate.attemptId && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={forceSubmitting}
                              onClick={() => dismissForceSubmitIndeterminate()}
                            >
                              {t("admin.proctorDashboard.forceSubmit.dismiss")}
                            </Button>
                          )}
                        {forceSubmitTargetAttemptId === candidate.attemptId &&
                          forceSubmitBlockedReason && (
                            <span className="text-destructive text-xs self-center">
                              {forceSubmitBlockedReason}
                            </span>
                          )}
                      </>
                    )}
                    {candidate.attemptId && user && isAdmin(user) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void openGrantDialog(candidate)}
                      >
                        {t("admin.proctorDashboard.card.extend")}
                      </Button>
                    )}
                    {candidate.attemptId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMisconductTarget(candidate);
                          setMisconductSeverity("warning");
                          setMisconductNotes("");
                          setMisconductDialogOpen(true);
                        }}
                      >
                        {t("admin.proctorDashboard.card.flag")}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }
}
