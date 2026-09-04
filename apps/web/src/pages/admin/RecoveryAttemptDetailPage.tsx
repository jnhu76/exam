import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { createContextSafeUuid } from "@/lib/uuid";
import type { AttemptOperationsContext as RecoveryAttemptOperationsResponse } from "@exam/contracts";
import { incidentStatusKey } from "@/lib/recovery";
import { recoveryErrorMessageKey } from "@/lib/recoveryErrors";
import { routes } from "@/lib/routes";
import { useRecoveryProjection } from "@/hooks/useRecoveryProjection";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSection } from "@/components/shared/PageSection";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AppIcon } from "@/components/shared/AppIcon";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { FieldError } from "@/components/shared/FieldError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RecoveryCommandDialog } from "@/features/recovery-operations/RecoveryCommandDialog";
import {
  classifyOperationFailure,
  useRecoveryOperation,
} from "@/features/recovery-operations/useRecoveryOperation";
import {
  clearPendingForceSubmit,
  loadPendingForceSubmit,
  savePendingForceSubmit,
} from "@/features/force-submit/pendingForceSubmitAuthority";
import {
  clearPendingMisconduct,
  loadPendingMisconduct,
  savePendingMisconduct,
} from "@/features/misconduct/pendingMisconductAuthority";
import { getPendingGrantCoordinator } from "@/features/operator-grant/pendingGrantCoordinatorSingleton";
import {
  AlreadyPendingError,
  CoordinationUnavailableError,
  LeaseConflictError,
  type PendingGrantCommand,
  type PendingGrantSendClaim,
} from "@/features/operator-grant/pendingGrantAuthority";
import {
  ArrowLeft,
  CircleAlert,
  Clock,
  Flag,
  RefreshCw,
  Send,
  ShieldAlert,
} from "lucide-react";

const STALE_AFTER_MS = 2 * 60_000;
const NAMESPACE = "admin.recoveryAttempt";

/**
 * Attempt Operations Context (J5-I1B3, contract §6.4) — read-only Admin
 * projection of ONE attempt: the FULL per-Attempt time-adjustment ledger
 * (all sources), interruption episodes with nested events, the audit
 * timeline, and related-incident navigation stubs. Read-only phase: the
 * action area is NOT rendered — `allowedActions` is a computed result, never
 * a disabled-button state (contract §6.4 note).
 *
 * The full ledger here is deliberately distinct from the Incident page's
 * incident-scoped `timeAdjustmentSummaries` (contract §6.1/§6.3 boundary);
 * the ledger section carries a caption making that explicit.
 */
export function RecoveryAttemptDetailPage() {
  const { t } = useTranslation();
  const { formatTime } = useProductDateTime();
  const { user } = useAuthContext();
  const { attemptId } = useParams<{ attemptId: string }>();

  const { data, error, isInitialLoading, isRefreshing, isStale, refresh } =
    useRecoveryProjection<RecoveryAttemptOperationsResponse>({
      load: ({ signal }) =>
        api.get<RecoveryAttemptOperationsResponse>(
          `/api/admin/recovery/attempts/${attemptId}`,
          { signal },
        ),
      getSnapshotAt: (d) => d.snapshotAt,
      staleAfterMs: STALE_AFTER_MS,
      deps: [attemptId],
    });

  // ── J5-I1C1 Operations — three dangerous commands, one frozen operationId
  // each (J5-R0 §8.2). Force-submit + misconduct persist a durable pending
  // authority BEFORE the POST (fail-closed: an unpersisted identity must not
  // be sent) and restore it on dialog open; the time grant reuses the shared
  // `PendingGrantCoordinator` (the same authority the Proctor dashboard uses —
  // keyed per (organizationId, actorId), so a Recovery grant and a Proctor
  // grant for the same admin cannot both be in flight). All outcomes reload
  // the authoritative projection — no optimistic mutation.
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [grantMinutes, setGrantMinutes] = useState(10);
  const [grantReasonCode, setGrantReasonCode] = useState("technical_incident");
  const [grantReasonText, setGrantReasonText] = useState("");
  // The time-grant command is frozen on first submit and replayed verbatim on
  // every retry (mirrors the Proctor dashboard's GrantDialogState). The frozen
  // command + send claim live in the shared coordinator's durable authority
  // (localStorage), so a reload / navigation cannot lose the identity — a
  // later "+10 min" reuses the SAME operationId instead of minting a fresh one
  // that the server would treat as a REAL second time adjustment.
  const [grantPhase, setGrantPhase] = useState<
    "idle" | "submitting" | "indeterminate"
  >("idle");
  const grantClaimRef = useRef<PendingGrantSendClaim | null>(null);
  // The frozen command held in React state for the retry path. On a draft the
  // editable fields are the source of truth; once frozen this mirrors the
  // coordinator's stored authority so the dialog can render it read-only.
  const [grantFrozenCommand, setGrantFrozenCommand] =
    useState<PendingGrantCommand | null>(null);

  const [forceSubmitDialogOpen, setForceSubmitDialogOpen] = useState(false);
  const [forceSubmitReason, setForceSubmitReason] = useState("");

  const [misconductDialogOpen, setMisconductDialogOpen] = useState(false);
  const [misconductSeverity, setMisconductSeverity] = useState<
    "warning" | "serious"
  >("warning");
  const [misconductNotes, setMisconductNotes] = useState("");

  // Fix C: when a confirmed force-submit / misconduct outcome's durable-authority
  // CLEAR fails, the stale record would silently block every later operation of
  // that type. These page-level flags surface a recovery banner (the hook has
  // already reset its identity before onSuccess, so the banner is the only
  // remaining recovery surface). The banner offers a retry-clear affordance.
  const [forceSubmitCleanupFailed, setForceSubmitCleanupFailed] =
    useState(false);
  const [misconductCleanupFailed, setMisconductCleanupFailed] = useState(false);

  const forceSubmit = useRecoveryOperation({
    submit: (operationId) =>
      api.post(`/api/admin/attempts/${data?.attempt.id ?? ""}/force-submit`, {
        operationId,
        reason: forceSubmitReason.trim(),
      }),
    beforeSubmit: (operationId) => {
      if (!user || !data) return false;
      const saved = savePendingForceSubmit({
        schemaVersion: 2,
        organizationId: user.organizationId,
        actorId: user.id,
        command: {
          attemptId: data.attempt.id,
          operationId,
          reason: forceSubmitReason.trim(),
          examId: data.examSummary.id,
          candidateName: data.candidateSummary.displayName,
        },
        createdAt: Date.now(),
      });
      if (!saved.ok) {
        toast.error(t("admin.recoveryOps.persistenceFailed"));
        return false;
      }
      return true;
    },
    onSuccess: () => {
      // Fix C: the server confirmed the outcome, but the durable-authority clear
      // may FAIL — surface a recovery banner instead of closing silently (a
      // stale record would block every later force-submit).
      let cleanupFailed = false;
      if (user) {
        const cleared = clearPendingForceSubmit(user.organizationId, user.id);
        cleanupFailed = !cleared.ok;
      }
      setForceSubmitCleanupFailed(cleanupFailed);
      if (cleanupFailed) {
        toast.warning(t("admin.recoveryOps.cleanupFailed"));
      } else {
        toast.success(t("admin.recoveryOps.actions.forceSubmitDone"));
      }
      setForceSubmitDialogOpen(false);
      refresh();
    },
    onConfirmedRejection: () => {
      let cleanupFailed = false;
      if (user) {
        const cleared = clearPendingForceSubmit(user.organizationId, user.id);
        cleanupFailed = !cleared.ok;
      }
      setForceSubmitCleanupFailed(cleanupFailed);
      setForceSubmitDialogOpen(false);
    },
    onIndeterminate: () => toast.error(t("admin.recoveryOps.indeterminate")),
  });

  const misconduct = useRecoveryOperation({
    submit: (operationId) =>
      api.post(`/api/admin/attempts/${data?.attempt.id ?? ""}/misconduct`, {
        operationId,
        severity: misconductSeverity,
        notes: misconductNotes.trim(),
      }),
    beforeSubmit: (operationId) => {
      if (!user || !data) return false;
      const saved = savePendingMisconduct({
        schemaVersion: 2,
        organizationId: user.organizationId,
        actorId: user.id,
        command: {
          attemptId: data.attempt.id,
          operationId,
          severity: misconductSeverity,
          notes: misconductNotes.trim(),
          examId: data.examSummary.id,
          candidateName: data.candidateSummary.displayName,
        },
        createdAt: Date.now(),
      });
      if (!saved.ok) {
        toast.error(t("admin.recoveryOps.persistenceFailed"));
        return false;
      }
      return true;
    },
    onSuccess: () => {
      // Fix C: same contract as force-submit — a failed clear surfaces a
      // recovery banner instead of closing silently.
      let cleanupFailed = false;
      if (user) {
        const cleared = clearPendingMisconduct(user.organizationId, user.id);
        cleanupFailed = !cleared.ok;
      }
      setMisconductCleanupFailed(cleanupFailed);
      if (cleanupFailed) {
        toast.warning(t("admin.recoveryOps.cleanupFailed"));
      } else {
        toast.success(t("admin.recoveryOps.actions.markMisconductDone"));
      }
      setMisconductDialogOpen(false);
      refresh();
    },
    onConfirmedRejection: () => {
      let cleanupFailed = false;
      if (user) {
        const cleared = clearPendingMisconduct(user.organizationId, user.id);
        cleanupFailed = !cleared.ok;
      }
      setMisconductCleanupFailed(cleanupFailed);
      setMisconductDialogOpen(false);
    },
    onIndeterminate: () => toast.error(t("admin.recoveryOps.indeterminate")),
  });

  /** Opens the force-submit dialog, honoring the durable pending authority. */
  const openForceSubmitDialog = useCallback(() => {
    if (!user || !data) return;
    const result = loadPendingForceSubmit(user.organizationId, user.id);
    if (result.kind === "corrupt") {
      toast.error(t("admin.recoveryOps.corruptCleared"));
      setForceSubmitDialogOpen(true);
      forceSubmit.begin();
      return;
    }
    if (
      result.kind === "authority" &&
      result.authority.command.attemptId !== data.attempt.id
    ) {
      // At most one pending force-submit per admin — resolve it first.
      toast.error(t("admin.recoveryOps.blockedByPending"));
      return;
    }
    if (result.kind === "authority") {
      // Restore the frozen command verbatim — its outcome was never confirmed.
      setForceSubmitReason(result.authority.command.reason);
      setForceSubmitDialogOpen(true);
      forceSubmit.begin(result.authority.command.operationId);
      return;
    }
    setForceSubmitReason("");
    setForceSubmitDialogOpen(true);
    forceSubmit.begin();
  }, [user, data, forceSubmit, t]);

  /** Opens the misconduct dialog, honoring the durable pending authority. */
  const openMisconductDialog = useCallback(() => {
    if (!user || !data) return;
    const result = loadPendingMisconduct(user.organizationId, user.id);
    if (result.kind === "corrupt") {
      toast.error(t("admin.recoveryOps.corruptCleared"));
      setMisconductDialogOpen(true);
      misconduct.begin();
      return;
    }
    if (
      result.kind === "authority" &&
      result.authority.command.attemptId !== data.attempt.id
    ) {
      toast.error(t("admin.recoveryOps.blockedByPending"));
      return;
    }
    if (result.kind === "authority") {
      setMisconductSeverity(result.authority.command.severity);
      setMisconductNotes(result.authority.command.notes);
      setMisconductDialogOpen(true);
      misconduct.begin(result.authority.command.operationId);
      return;
    }
    setMisconductSeverity("warning");
    setMisconductNotes("");
    setMisconductDialogOpen(true);
    misconduct.begin();
  }, [user, data, misconduct, t]);

  /**
   * Opens the time-grant dialog, honoring the shared pending-grant authority
   * (the coordinator). If an unresolved command exists for THIS attempt it is
   * restored so the retry replays the SAME operationId (idempotent); one for a
   * DIFFERENT attempt blocks the dialog (the global per-admin slot holds at
   * most one). This mirrors the Proctor dashboard's `openGrantDialog`.
   */
  const openGrantDialog = useCallback(async () => {
    if (!user || !data) return;
    const orgId = user.organizationId;
    const attemptId = data.attempt.id;
    const coordinator = getPendingGrantCoordinator();
    const current = await coordinator.getCurrent(orgId, user.id);
    if (!current.ok) {
      // Coordination unavailable — fail closed (no fresh identity may be minted
      // while the shared authority cannot be read).
      toast.error(t("admin.recoveryOps.coordinationUnavailable"));
      return;
    }
    if (current.authority) {
      if (current.authority.command.attemptId !== attemptId) {
        // A pending command for a DIFFERENT attempt blocks this dialog.
        toast.error(t("admin.recoveryOps.blockedByPending"));
        return;
      }
      // Restore the frozen command verbatim into the editable fields + the
      // indeterminate phase so a retry replays the same operationId.
      const restored = current.authority.command;
      setGrantMinutes(Math.round(restored.addedSeconds / 60));
      setGrantReasonCode(restored.reasonCode);
      setGrantReasonText(restored.reasonText);
      setGrantFrozenCommand(restored);
      grantClaimRef.current = null;
      setGrantPhase("indeterminate");
      setGrantDialogOpen(true);
      return;
    }
    // No pending command — fresh draft.
    setGrantMinutes(10);
    setGrantReasonCode("technical_incident");
    setGrantReasonText("");
    setGrantFrozenCommand(null);
    grantClaimRef.current = null;
    setGrantPhase("idle");
    setGrantDialogOpen(true);
  }, [user, data, t]);

  /**
   * Sends a frozen time-grant command via the shared coordinator (mirrors the
   * Proctor dashboard's `handleGrantTime`). From `idle` we `reserve` (fail-closed
   * on AlreadyPending / CoordinationUnavailable); from `indeterminate` we replay
   * the frozen command and re-acquire a send claim via `claimForSend`. A
   * confirmed outcome clears the authority via `clearConfirmed`; an indeterminate
   * failure surrenders the lease via `releaseIndeterminate` and keeps the frozen
   * command for an idempotent retry.
   */
  const submitGrantCommand = useCallback(async () => {
    if (!user || !data || grantPhase === "submitting") return;
    const orgId = user.organizationId;
    const attemptId = data.attempt.id;
    const coordinator = getPendingGrantCoordinator();
    let command: PendingGrantCommand;
    let claim: PendingGrantSendClaim;
    if (grantPhase === "idle") {
      command = {
        attemptId,
        operationId: createContextSafeUuid(),
        addedSeconds: Math.max(1, Math.floor(grantMinutes)) * 60,
        reasonCode: grantReasonCode,
        reasonText: grantReasonText.trim() || grantReasonCode,
      };
      const reserved = await coordinator.reserve(orgId, user.id, command);
      if (!reserved.ok) {
        if (reserved.error instanceof AlreadyPendingError) {
          toast.warning(t("admin.recoveryOps.blockedByPending"));
          return;
        }
        toast.error(t("admin.recoveryOps.coordinationUnavailable"));
        return;
      }
      claim = reserved.claim;
    } else {
      // indeterminate retry — replay the frozen command verbatim.
      command = grantFrozenCommand ?? {
        attemptId,
        operationId: createContextSafeUuid(),
        addedSeconds: Math.max(1, Math.floor(grantMinutes)) * 60,
        reasonCode: grantReasonCode,
        reasonText: grantReasonText.trim() || grantReasonCode,
      };
      const claimed = await coordinator.claimForSend(orgId, user.id, command);
      if (!claimed.ok) {
        if (claimed.error instanceof LeaseConflictError) {
          toast.warning(t("admin.recoveryOps.leaseConflict"));
          return;
        }
        toast.error(t("admin.recoveryOps.coordinationUnavailable"));
        return;
      }
      claim = claimed.claim;
    }
    grantClaimRef.current = claim;
    setGrantFrozenCommand(command);
    setGrantPhase("submitting");
    try {
      await api.post(`/api/admin/attempts/${attemptId}/time-grants`, {
        operationId: command.operationId,
        addedSeconds: command.addedSeconds,
        reasonCode: command.reasonCode,
        reasonText: command.reasonText,
      });
      // Confirmed outcome — clear the shared authority (full-claim compare-and-
      // clear). A failed clear surfaces a non-blocking warning but does not
      // change the grant's HTTP result.
      const cleared = await coordinator.clearConfirmed(orgId, user.id, claim);
      if (!cleared.ok) {
        toast.warning(t("admin.recoveryOps.clearStaleWarning"));
      }
      toast.success(t("admin.recoveryOps.actions.timeGrantDone"));
      setGrantDialogOpen(false);
      setGrantPhase("idle");
      setGrantFrozenCommand(null);
      grantClaimRef.current = null;
      refresh();
    } catch (err) {
      const kind = classifyOperationFailure(err);
      if (kind === "indeterminate") {
        // Commit status unknown — surrender the lease but KEEP the frozen
        // command so a retry replays the same operationId.
        const released = await coordinator.releaseIndeterminate(
          orgId,
          user.id,
          claim,
        );
        if (released.ok) {
          setGrantPhase("indeterminate");
          toast.error(t("admin.recoveryOps.indeterminate"));
          return;
        }
        // Release mismatch — reconcile against the shared authority. If it was
        // cleared elsewhere, drop the local state; otherwise keep the frozen
        // command for retry.
        const reread = await coordinator.getCurrent(orgId, user.id);
        if (reread.ok && reread.authority === null) {
          setGrantPhase("idle");
          setGrantFrozenCommand(null);
          grantClaimRef.current = null;
          setGrantDialogOpen(false);
          toast.info(t("admin.recoveryOps.resolvedInAnotherTab"));
          return;
        }
        setGrantPhase("indeterminate");
        toast.error(t("admin.recoveryOps.indeterminate"));
        return;
      }
      // Confirmed rejection — clear the authority; the identity is dead.
      const cleared = await coordinator.clearConfirmed(orgId, user.id, claim);
      if (!cleared.ok) {
        toast.warning(t("admin.recoveryOps.clearStaleWarning"));
      }
      setGrantPhase("idle");
      setGrantFrozenCommand(null);
      grantClaimRef.current = null;
      setGrantDialogOpen(false);
      toast.error(
        getApiErrorMessage(
          err,
          t,
          t("admin.recoveryOps.actions.timeGrantFailed"),
        ),
      );
    }
  }, [
    user,
    data,
    grantPhase,
    grantMinutes,
    grantReasonCode,
    grantReasonText,
    grantFrozenCommand,
    refresh,
    t,
  ]);

  /**
   * Explicitly abandons an indeterminate time-grant command (clears the shared
   * authority). When the clear fails the dialog + frozen state are KEPT so the
   * admin never believes the slot was freed while a stale record still blocks
   * later grants.
   */
  const dismissGrant = useCallback(async () => {
    if (!user) return;
    const orgId = user.organizationId;
    const claim = grantClaimRef.current;
    const coordinator = getPendingGrantCoordinator();
    // If we hold a claim, clear via compare-and-clear; otherwise the command
    // is indeterminate without an active lease (e.g. restored after reload) —
    // a fresh clear is not possible, so treat any remaining authority as stale
    // and rely on clearConfirmed's mismatch semantics. In the common restored
    // case there is no claim: fall back to leaving the authority for retry.
    if (claim) {
      const cleared = await coordinator.clearConfirmed(orgId, user.id, claim);
      if (!cleared.ok) {
        toast.error(t("admin.recoveryOps.dismissFailed"));
        return;
      }
    }
    setGrantPhase("idle");
    setGrantFrozenCommand(null);
    grantClaimRef.current = null;
    setGrantDialogOpen(false);
  }, [user, t]);

  const dismissForceSubmit = useCallback(() => {
    if (!user) return;
    const cleared = clearPendingForceSubmit(user.organizationId, user.id);
    if (!cleared.ok) {
      toast.error(t("admin.recoveryOps.dismissFailed"));
      return;
    }
    forceSubmit.reset();
    setForceSubmitDialogOpen(false);
    setForceSubmitCleanupFailed(false);
  }, [user, forceSubmit, t]);

  const dismissMisconduct = useCallback(() => {
    if (!user) return;
    const cleared = clearPendingMisconduct(user.organizationId, user.id);
    if (!cleared.ok) {
      toast.error(t("admin.recoveryOps.dismissFailed"));
      return;
    }
    misconduct.reset();
    setMisconductDialogOpen(false);
    setMisconductCleanupFailed(false);
  }, [user, misconduct, t]);

  if (isInitialLoading) return <LoadingState />;
  if (error && !data) {
    return (
      <ErrorState
        message={t(recoveryErrorMessageKey(error.kind, NAMESPACE) as never)}
        onRetry={refresh}
      />
    );
  }
  if (!data) {
    return (
      <EmptyState
        icon={<AppIcon icon={Flag} size="state" />}
        title={t("admin.recoveryAttempt.notFound")}
        description={t("admin.recoveryAttempt.notFoundDescription")}
      />
    );
  }

  const { attempt } = data;
  const effectiveDiffers =
    attempt.deadlineAt != null &&
    attempt.effectiveDeadlineAt != null &&
    attempt.effectiveDeadlineAt !== attempt.deadlineAt;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.recoveryAttempt.title")}
        description={t("admin.recoveryAttempt.attemptNo", {
          count: attempt.attemptNo,
        })}
        status={<StatusBadge status={attempt.status} />}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={isRefreshing}
            >
              <AppIcon icon={RefreshCw} size="inline" className="mr-1" />
              {isRefreshing
                ? t("admin.recoveryAttempt.refreshing")
                : t("admin.recoveryAttempt.refresh")}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={routes.admin.recovery}>
                <AppIcon icon={ArrowLeft} size="inline" className="mr-1" />
                {t("admin.recoveryAttempt.back")}
              </Link>
            </Button>
          </div>
        }
      />

      {/* Background-refresh failure: old data stays on screen + inline warning
          (a full-screen ErrorState is shown only when there is no data). */}
      {error && (
        <InlineErrorBanner>
          {t(recoveryErrorMessageKey(error.kind, NAMESPACE) as never)}
        </InlineErrorBanner>
      )}

      {/* Snapshot indicator — server RR snapshot time + staleness flag. */}
      <div className="flex items-center gap-2 type-metadata">
        {isStale && (
          <AppIcon icon={CircleAlert} size="inline" className="text-warning" />
        )}
        {t("admin.recoveryAttempt.snapshotAt", {
          time: formatTime(data.snapshotAt),
        })}
        {isStale && (
          <span className="text-warning">
            {t("admin.recoveryAttempt.snapshotStale")}
          </span>
        )}
      </div>

      {/* Misconduct flag — prominent, boolean on the wire (jsonb → boolean). */}
      {attempt.misconduct && (
        <InlineErrorBanner>
          <span className="flex items-center gap-2">
            <AppIcon icon={Flag} size="inline" />
            {t("admin.recoveryAttempt.misconductDescription")}
          </span>
        </InlineErrorBanner>
      )}

      {/* Fix C: cleanup-failed recovery banners. A confirmed force-submit /
          misconduct outcome whose durable-authority CLEAR failed leaves a stale
          record that silently blocks every later operation of that type. The
          banner offers a retry-clear (the dismiss handler re-attempts the clear
          and keeps the banner if it still fails). */}
      {forceSubmitCleanupFailed && (
        <div
          role="alert"
          data-testid="force-submit-cleanup-failed-banner"
          className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm text-warning"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <span className="font-medium">
                {t("admin.recoveryOps.forceSubmitCleanupFailedTitle")}
              </span>
              <span className="text-xs">
                {t("admin.recoveryOps.cleanupFailedBody")}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => dismissForceSubmit()}
            >
              {t("admin.recoveryOps.clearStaleCommand")}
            </Button>
          </div>
        </div>
      )}
      {misconductCleanupFailed && (
        <div
          role="alert"
          data-testid="misconduct-cleanup-failed-banner"
          className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm text-warning"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <span className="font-medium">
                {t("admin.recoveryOps.misconductCleanupFailedTitle")}
              </span>
              <span className="text-xs">
                {t("admin.recoveryOps.cleanupFailedBody")}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => dismissMisconduct()}
            >
              {t("admin.recoveryOps.clearStaleCommand")}
            </Button>
          </div>
        </div>
      )}

      {/* Operations (J5-I1C1) — server-computed eligibility (allowedActions),
          never a client-side derivation from status. Empty allowedActions
          keeps the page read-only (§6.4 note: a computed result, not a
          disabled-button state). */}
      {data.allowedActions.length > 0 && (
        <PageSection
          title={t("admin.recoveryOps.operationsTitle")}
          className="lg:col-span-2"
        >
          <div className="flex flex-wrap gap-2">
            {data.allowedActions.includes("time_grant") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openGrantDialog()}
                disabled={grantPhase === "submitting"}
              >
                <AppIcon icon={Clock} size="inline" className="mr-1" />
                {t("admin.recoveryOps.actions.timeGrant")}
              </Button>
            )}
            {data.allowedActions.includes("force_submit") && (
              <Button
                variant="outline"
                size="sm"
                onClick={openForceSubmitDialog}
                disabled={forceSubmit.phase === "submitting"}
              >
                <AppIcon icon={Send} size="inline" className="mr-1" />
                {t("admin.recoveryOps.actions.forceSubmit")}
              </Button>
            )}
            {data.allowedActions.includes("misconduct_mark") && (
              <Button
                variant="outline"
                size="sm"
                onClick={openMisconductDialog}
                disabled={misconduct.phase === "submitting"}
              >
                <AppIcon icon={ShieldAlert} size="inline" className="mr-1" />
                {t("admin.recoveryOps.actions.markMisconduct")}
              </Button>
            )}
          </div>
        </PageSection>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Attempt overview */}
        <PageSection title={t("admin.recoveryAttempt.sections.overview")}>
          <dl className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <dt className="type-metadata">
                {t("admin.recoveryAttempt.statusLabel")}
              </dt>
              <dd>
                <StatusBadge status={attempt.status} />
              </dd>
            </div>
            <div>
              <dt className="type-metadata">
                {t("admin.recoveryAttempt.startedAt")}
              </dt>
              <dd className="text-sm">
                {attempt.startedAt ? formatTime(attempt.startedAt) : "—"}
              </dd>
            </div>
            <div>
              <dt className="type-metadata">
                {t("admin.recoveryAttempt.submittedAt")}
              </dt>
              <dd className="text-sm">
                {attempt.submittedAt ? formatTime(attempt.submittedAt) : "—"}
              </dd>
            </div>
            <div>
              <dt className="type-metadata">
                {t("admin.recoveryAttempt.gradedAt")}
              </dt>
              <dd className="text-sm">
                {attempt.gradedAt ? formatTime(attempt.gradedAt) : "—"}
              </dd>
            </div>
            <div>
              <dt className="type-metadata">
                {t("admin.recoveryAttempt.lastActivityAt")}
              </dt>
              <dd className="text-sm">
                {attempt.lastActivityAt
                  ? formatTime(attempt.lastActivityAt)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="type-metadata">
                {t("admin.recoveryAttempt.effectiveDeadline")}
              </dt>
              <dd className="text-sm">
                {attempt.effectiveDeadlineAt
                  ? formatTime(attempt.effectiveDeadlineAt)
                  : "—"}
                {effectiveDiffers && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs text-warning">
                    <AppIcon icon={CircleAlert} size="inline" />
                    {t("admin.recoveryAttempt.effectiveDeadlineDiffers")}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </PageSection>

        {/* Exam + candidate */}
        <div className="flex flex-col gap-4">
          <PageSection title={t("admin.recoveryAttempt.sections.exam")}>
            <dl className="flex flex-col gap-2">
              <div>
                <dt className="type-metadata">
                  {t("admin.recoveryAttempt.sections.exam")}
                </dt>
                <dd className="text-sm font-medium">
                  <Link
                    to={routes.admin.recoveryExam(data.examSummary.id)}
                    className="underline-offset-4 hover:underline"
                  >
                    {data.examSummary.title}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="type-metadata">
                  {t("admin.recoveryQueue.columns.severity")}
                </dt>
                <dd>
                  <StatusBadge status={data.examSummary.status} />
                </dd>
              </div>
              <div>
                <dt className="type-metadata">
                  {t("admin.recoveryAttempt.examCloseAt")}
                </dt>
                <dd className="text-sm">
                  {data.examSummary.closeAt === null
                    ? "—"
                    : formatTime(data.examSummary.closeAt)}
                </dd>
              </div>
            </dl>
          </PageSection>
          <PageSection title={t("admin.recoveryAttempt.sections.candidate")}>
            <p className="text-sm">{data.candidateSummary.displayName}</p>
          </PageSection>
        </div>

        {/* Interruption episodes — chronological with nested events. */}
        <PageSection
          title={t("admin.recoveryAttempt.sections.episodes")}
          className="lg:col-span-2"
        >
          {data.interruptionEpisodes.length === 0 ? (
            <p className="type-secondary">
              {t("admin.recoveryAttempt.noEpisodes")}
            </p>
          ) : (
            <ol className="flex flex-col gap-4">
              {data.interruptionEpisodes.map((episode, index) => (
                <li
                  key={episode.interruption.id}
                  className="flex flex-col gap-2"
                >
                  <span className="text-sm font-medium">
                    {t("admin.recoveryAttempt.episodeCount", {
                      count: index + 1,
                    })}
                    <span className="ml-2 type-metadata">
                      {episode.interruption.id} ·{" "}
                      {formatTime(episode.interruption.createdAt)}
                    </span>
                  </span>
                  <ul className="flex flex-col gap-1.5 pl-4">
                    {episode.events.map((e) => (
                      <li key={e.id} className="flex flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-x-2 text-sm">
                          <span className="font-medium">
                            {t(
                              `admin.recoveryAttempt.eventType.${e.eventType}` as never,
                            )}
                          </span>
                          <span className="type-metadata">
                            {formatTime(e.occurredAt)}
                          </span>
                          {e.actorId && (
                            <span className="type-metadata">{e.actorId}</span>
                          )}
                        </span>
                        <span className="flex flex-wrap gap-x-3 type-metadata">
                          {e.detectionSource && (
                            <span>
                              {t("admin.recoveryAttempt.detectionSource")}:{" "}
                              {e.detectionSource}
                            </span>
                          )}
                          {e.timeoutSeconds != null && (
                            <span>
                              {t("admin.recoveryAttempt.timeoutSeconds")}:{" "}
                              {e.timeoutSeconds}
                            </span>
                          )}
                          {e.eligibleSeconds != null && (
                            <span>
                              {t("admin.recoveryAttempt.eligibleSeconds")}:{" "}
                              {e.eligibleSeconds}s
                            </span>
                          )}
                          {e.timeAdjustmentId && (
                            <span>
                              {t("admin.recoveryAttempt.linkedAdjustment")}:{" "}
                              {e.timeAdjustmentId}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </PageSection>

        {/* Full per-Attempt time-adjustment ledger — ALL sources, deliberately
            distinct from the incident-scoped timeAdjustmentSummaries (§6.4). */}
        <PageSection
          title={t("admin.recoveryAttempt.sections.adjustments")}
          description={t("admin.recoveryAttempt.ledgerNote")}
          className="lg:col-span-2"
        >
          {data.timeAdjustments.length === 0 ? (
            <p className="type-secondary">
              {t("admin.recoveryAttempt.noAdjustments")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.timeAdjustments.map((adj) => (
                <li key={adj.id} className="flex flex-col gap-1 py-2">
                  <span className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-medium">
                      {t(`admin.recoveryAttempt.policy.${adj.policy}` as never)}
                    </span>
                    <span className="type-metadata">
                      {t(`admin.recoveryAttempt.source.${adj.source}` as never)}
                    </span>
                    <span className="text-xs">+{adj.addedSeconds}s</span>
                    {adj.eligibleSeconds != null && (
                      <span className="type-metadata">
                        {t("admin.recoveryAttempt.eligibleSeconds")}:{" "}
                        {adj.eligibleSeconds}s
                      </span>
                    )}
                  </span>
                  <span className="type-metadata">
                    {t("admin.recoveryAttempt.beforeDeadline")}:{" "}
                    {formatTime(adj.beforeDeadline)}
                    {" · "}
                    {t("admin.recoveryAttempt.afterDeadline")}:{" "}
                    {formatTime(adj.afterDeadline)}
                  </span>
                  <span className="type-metadata">
                    {t("admin.recoveryAttempt.reason")}:{" "}
                    {adj.reasonText ?? adj.reasonCode}
                    {" · "}
                    {t("admin.recoveryAttempt.actor")}: {adj.actorId ?? "—"}
                    {" · "}
                    {adj.incidentId && (
                      <>
                        {t("admin.recoveryAttempt.linkedIncident")}:{" "}
                        <Link
                          to={routes.admin.recoveryIncident(adj.incidentId)}
                          className="underline-offset-4 hover:underline"
                        >
                          {adj.incidentId}
                        </Link>
                        {" · "}
                      </>
                    )}
                    {formatTime(adj.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Timeline — audit entries for the attempt target. */}
        <PageSection
          title={t("admin.recoveryAttempt.sections.timeline")}
          className="lg:col-span-2"
        >
          {data.timeline.length === 0 ? (
            <p className="type-secondary">
              {t("admin.recoveryAttempt.noTimeline")}
            </p>
          ) : (
            <ol className="flex flex-col divide-y">
              {data.timeline.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <span className="text-sm font-medium">{entry.action}</span>
                  <span className="type-metadata">
                    {entry.actorName ?? entry.actorId}
                  </span>
                  <span className="type-metadata">
                    {formatTime(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </PageSection>

        {/* Related incidents — navigation stubs (most recently linked first). */}
        <PageSection
          title={t("admin.recoveryAttempt.sections.relatedIncidents")}
          className="lg:col-span-2"
        >
          {data.relatedIncidents.length === 0 ? (
            <p className="type-secondary">
              {t("admin.recoveryAttempt.noRelatedIncidents")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.relatedIncidents.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <Link
                    to={routes.admin.recoveryIncident(r.id)}
                    className="text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {r.title}
                  </Link>
                  <StatusBadge status={incidentStatusKey(r.status)} />
                  <span className="type-metadata">
                    {t(`admin.recoveryQueue.severity.${r.severity}` as never)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>
      </div>

      {/* ── Operations dialogs (J5-I1C1) ── */}
      <RecoveryCommandDialog
        open={grantDialogOpen}
        onOpenChange={setGrantDialogOpen}
        title={t("admin.recoveryOps.actions.timeGrant")}
        description={t("admin.recoveryOps.timeGrantDescription", {
          name: data.candidateSummary.displayName,
          no: attempt.attemptNo,
          minutes: grantMinutes,
        })}
        confirmLabel={t("admin.recoveryOps.actions.timeGrant")}
        confirmDisabled={
          !Number.isFinite(grantMinutes) ||
          grantMinutes < 1 ||
          grantReasonText.trim().length === 0 ||
          grantReasonText.trim().length > 1000
        }
        submitting={grantPhase === "submitting"}
        indeterminate={grantPhase === "indeterminate"}
        onConfirm={() => void submitGrantCommand()}
        onDismissIndeterminate={() => void dismissGrant()}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="recovery-grant-minutes">
            {t("admin.recoveryOps.minutesLabel")}
          </Label>
          <Input
            id="recovery-grant-minutes"
            type="number"
            min={1}
            value={grantMinutes}
            onChange={(e) => setGrantMinutes(Number(e.target.value))}
          />
          {(!Number.isFinite(grantMinutes) || grantMinutes < 1) && (
            <FieldError>{t("admin.recoveryOps.minutesInvalid")}</FieldError>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="recovery-grant-reason-code">
            {t("admin.recoveryOps.reasonCodeLabel")}
          </Label>
          <Select
            value={grantReasonCode}
            onValueChange={setGrantReasonCode}
            disabled={grantPhase !== "idle"}
          >
            <SelectTrigger id="recovery-grant-reason-code">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="technical_incident">
                {t("admin.recoveryOps.reasonCodeTechnicalIncident")}
              </SelectItem>
              <SelectItem value="candidate_request">
                {t("admin.recoveryOps.reasonCodeCandidateRequest")}
              </SelectItem>
              <SelectItem value="other">
                {t("admin.recoveryOps.reasonCodeOther")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="recovery-grant-reason-text">
            {t("admin.recoveryOps.reasonTextLabel")}
          </Label>
          <Textarea
            id="recovery-grant-reason-text"
            value={grantReasonText}
            onChange={(e) => setGrantReasonText(e.target.value)}
          />
          {grantReasonText.trim().length === 0 && (
            <FieldError>{t("admin.recoveryOps.reasonRequired")}</FieldError>
          )}
        </div>
      </RecoveryCommandDialog>

      <RecoveryCommandDialog
        open={forceSubmitDialogOpen}
        onOpenChange={setForceSubmitDialogOpen}
        title={t("admin.recoveryOps.actions.forceSubmit")}
        description={t("admin.recoveryOps.forceSubmitDescription", {
          name: data.candidateSummary.displayName,
          no: attempt.attemptNo,
          examTitle: data.examSummary.title,
        })}
        confirmLabel={t("admin.recoveryOps.actions.forceSubmit")}
        confirmDisabled={
          forceSubmitReason.trim().length === 0 ||
          forceSubmitReason.trim().length > 500
        }
        destructive
        submitting={forceSubmit.phase === "submitting"}
        indeterminate={forceSubmit.phase === "indeterminate"}
        onConfirm={() => void forceSubmit.run()}
        onDismissIndeterminate={dismissForceSubmit}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="recovery-force-submit-reason">
            {t("admin.recoveryOps.reasonRequiredLabel")}
          </Label>
          <Textarea
            id="recovery-force-submit-reason"
            value={forceSubmitReason}
            onChange={(e) => setForceSubmitReason(e.target.value)}
          />
          {forceSubmitReason.trim().length === 0 && (
            <FieldError>{t("admin.recoveryOps.reasonRequired")}</FieldError>
          )}
          {forceSubmitReason.trim().length > 500 && (
            <FieldError>
              {t("admin.recoveryOps.reasonTooLong", { count: 500 })}
            </FieldError>
          )}
        </div>
      </RecoveryCommandDialog>

      <RecoveryCommandDialog
        open={misconductDialogOpen}
        onOpenChange={setMisconductDialogOpen}
        title={t("admin.recoveryOps.actions.markMisconduct")}
        description={t("admin.recoveryOps.markMisconductDescription", {
          name: data.candidateSummary.displayName,
          no: attempt.attemptNo,
          examTitle: data.examSummary.title,
        })}
        confirmLabel={t("admin.recoveryOps.actions.markMisconduct")}
        confirmDisabled={
          misconductNotes.trim().length === 0 ||
          misconductNotes.trim().length > 1000
        }
        destructive
        submitting={misconduct.phase === "submitting"}
        indeterminate={misconduct.phase === "indeterminate"}
        onConfirm={() => void misconduct.run()}
        onDismissIndeterminate={dismissMisconduct}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="recovery-misconduct-severity">
            {t("admin.recoveryOps.severityLabel")}
          </Label>
          <Select
            value={misconductSeverity}
            onValueChange={(v) =>
              setMisconductSeverity(v as "warning" | "serious")
            }
            disabled={misconduct.phase !== "idle"}
          >
            <SelectTrigger id="recovery-misconduct-severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="warning">
                {t("admin.recoveryOps.severityWarning")}
              </SelectItem>
              <SelectItem value="serious">
                {t("admin.recoveryOps.severitySerious")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="recovery-misconduct-notes">
            {t("admin.recoveryOps.notesLabel")}
          </Label>
          <Textarea
            id="recovery-misconduct-notes"
            value={misconductNotes}
            onChange={(e) => setMisconductNotes(e.target.value)}
          />
          {misconductNotes.trim().length === 0 && (
            <FieldError>{t("admin.recoveryOps.notesRequired")}</FieldError>
          )}
          {misconductNotes.trim().length > 1000 && (
            <FieldError>
              {t("admin.recoveryOps.reasonTooLong", { count: 1000 })}
            </FieldError>
          )}
        </div>
      </RecoveryCommandDialog>
    </div>
  );
}
