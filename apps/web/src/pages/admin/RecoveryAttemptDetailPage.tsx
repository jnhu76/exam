import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useProductDateTime } from "@/contexts/DateTimeContext";
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
import { Button } from "@/components/ui/button";
import { ArrowLeft, CircleAlert, Flag, RefreshCw } from "lucide-react";

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

  if (isInitialLoading) return <LoadingState />;
  if (error) {
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
    </div>
  );
}
