import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
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
  // be sent) and restore it on dialog open; the time grant uses the in-hook
  // same-tab identity (the recovery surface is not the cross-tab proctor
  // dashboard). All outcomes reload the authoritative projection — no
  // optimistic mutation.
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [grantMinutes, setGrantMinutes] = useState(10);
  const [grantReasonCode, setGrantReasonCode] = useState("technical_incident");
  const [grantReasonText, setGrantReasonText] = useState("");

  const [forceSubmitDialogOpen, setForceSubmitDialogOpen] = useState(false);
  const [forceSubmitReason, setForceSubmitReason] = useState("");

  const [misconductDialogOpen, setMisconductDialogOpen] = useState(false);
  const [misconductSeverity, setMisconductSeverity] = useState<
    "warning" | "serious"
  >("warning");
  const [misconductNotes, setMisconductNotes] = useState("");

  const grant = useRecoveryOperation({
    submit: (operationId) =>
      api.post(`/api/admin/attempts/${data?.attempt.id ?? ""}/time-grants`, {
        operationId,
        addedSeconds: grantMinutes * 60,
        reasonCode: grantReasonCode,
        reasonText: grantReasonText.trim(),
      }),
    onSuccess: () => {
      toast.success(t("admin.recoveryOps.actions.timeGrantDone"));
      setGrantDialogOpen(false);
      refresh();
    },
    onConfirmedRejection: () => setGrantDialogOpen(false),
    onIndeterminate: () => toast.error(t("admin.recoveryOps.indeterminate")),
  });

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
      if (user) clearPendingForceSubmit(user.organizationId, user.id);
      toast.success(t("admin.recoveryOps.actions.forceSubmitDone"));
      setForceSubmitDialogOpen(false);
      refresh();
    },
    onConfirmedRejection: () => {
      if (user) clearPendingForceSubmit(user.organizationId, user.id);
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
      if (user) clearPendingMisconduct(user.organizationId, user.id);
      toast.success(t("admin.recoveryOps.actions.markMisconductDone"));
      setMisconductDialogOpen(false);
      refresh();
    },
    onConfirmedRejection: () => {
      if (user) clearPendingMisconduct(user.organizationId, user.id);
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

  const openGrantDialog = useCallback(() => {
    // Reset the draft ONLY when no command session is active — a frozen
    // command (retry) must never have its payload replaced by a reset.
    if (grant.phase === "idle" && grant.operationId === null) {
      setGrantMinutes(10);
      setGrantReasonCode("technical_incident");
      setGrantReasonText("");
    }
    setGrantDialogOpen(true);
    grant.begin();
  }, [grant]);

  const dismissForceSubmit = useCallback(() => {
    if (!user) return;
    const cleared = clearPendingForceSubmit(user.organizationId, user.id);
    if (!cleared.ok) {
      toast.error(t("admin.recoveryOps.dismissFailed"));
      return;
    }
    forceSubmit.reset();
    setForceSubmitDialogOpen(false);
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
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
                onClick={openGrantDialog}
                disabled={grant.phase === "submitting"}
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
              <dt className="text-xs text-muted-foreground">
                {t("admin.recoveryAttempt.statusLabel")}
              </dt>
              <dd>
                <StatusBadge status={attempt.status} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.recoveryAttempt.startedAt")}
              </dt>
              <dd className="text-sm">
                {attempt.startedAt ? formatTime(attempt.startedAt) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.recoveryAttempt.submittedAt")}
              </dt>
              <dd className="text-sm">
                {attempt.submittedAt ? formatTime(attempt.submittedAt) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.recoveryAttempt.gradedAt")}
              </dt>
              <dd className="text-sm">
                {attempt.gradedAt ? formatTime(attempt.gradedAt) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.recoveryAttempt.lastActivityAt")}
              </dt>
              <dd className="text-sm">
                {attempt.lastActivityAt
                  ? formatTime(attempt.lastActivityAt)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
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
                <dt className="text-xs text-muted-foreground">
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
                <dt className="text-xs text-muted-foreground">
                  {t("admin.recoveryQueue.columns.severity")}
                </dt>
                <dd>
                  <StatusBadge status={data.examSummary.status} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("admin.recoveryAttempt.examCloseAt")}
                </dt>
                <dd className="text-sm">
                  {formatTime(data.examSummary.closeAt)}
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
            <p className="text-sm text-muted-foreground">
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
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
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
                          <span className="text-xs text-muted-foreground">
                            {formatTime(e.occurredAt)}
                          </span>
                          {e.actorId && (
                            <span className="text-xs text-muted-foreground">
                              {e.actorId}
                            </span>
                          )}
                        </span>
                        <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">
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
                    <span className="text-xs text-muted-foreground">
                      {t(`admin.recoveryAttempt.source.${adj.source}` as never)}
                    </span>
                    <span className="text-xs">+{adj.addedSeconds}s</span>
                    {adj.eligibleSeconds != null && (
                      <span className="text-xs text-muted-foreground">
                        {t("admin.recoveryAttempt.eligibleSeconds")}:{" "}
                        {adj.eligibleSeconds}s
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("admin.recoveryAttempt.beforeDeadline")}:{" "}
                    {formatTime(adj.beforeDeadline)}
                    {" · "}
                    {t("admin.recoveryAttempt.afterDeadline")}:{" "}
                    {formatTime(adj.afterDeadline)}
                  </span>
                  <span className="text-xs text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">
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
                  <span className="text-xs text-muted-foreground">
                    {entry.actorName ?? entry.actorId}
                  </span>
                  <span className="text-xs text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">
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
                  <span className="text-xs text-muted-foreground">
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
        submitting={grant.phase === "submitting"}
        indeterminate={grant.phase === "indeterminate"}
        onConfirm={() => void grant.run()}
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
            disabled={grant.phase !== "idle"}
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
