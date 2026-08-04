import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { ApiError, api } from "@/lib/api";
import type { RecoveryIncidentAggregateResponse } from "@/lib/recovery";
import { incidentStatusKey } from "@/lib/recovery";
import { routes } from "@/lib/routes";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSection } from "@/components/shared/PageSection";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AppIcon } from "@/components/shared/AppIcon";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CircleAlert, ShieldAlert } from "lucide-react";

/**
 * A point-in-time aggregate read (contract §6.3): the page renders exactly the
 * server snapshot — a snapshot older than this threshold is flagged as stale
 * (the read is NOT re-polled; the queue is the live surface).
 */
const SNAPSHOT_STALE_MS = 2 * 60_000;

/**
 * Renders a structured top-level key/value summary of an event payload.
 * `payload` is `unknown` on the wire — never dump it as a raw JSON blob;
 * present only plain top-level entries (nested values are compacted).
 */
function PayloadSummary({ payload }: { payload: unknown }) {
  if (
    payload == null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {entries.map(([key, value]) => (
        <span key={key}>
          {key}:{" "}
          {value != null && typeof value === "object"
            ? JSON.stringify(value)
            : String(value)}
        </span>
      ))}
    </span>
  );
}

/**
 * Recovery Incident Detail (J5-I1B2, contract §6.3) — read-only Admin
 * aggregate. Only wire-confirmed fields render (Task 7 field mapping); the
 * action area is NOT rendered in the read-only phase — `allowedActions` is a
 * computed result, never a disabled-button state (contract §6.4 note).
 */
export function RecoveryIncidentDetailPage() {
  const { t } = useTranslation();
  const { formatTime } = useProductDateTime();
  const { incidentId } = useParams<{ incidentId: string }>();

  const [data, setData] = useState<RecoveryIncidentAggregateResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!incidentId) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.get<RecoveryIncidentAggregateResponse>(
        `/api/admin/recovery/incidents/${incidentId}`,
      );
      setData(result);
    } catch (err) {
      // The API client throws ApiError; keep any Error so a transport failure
      // surfaces the error state instead of a misleading empty state.
      setError(err instanceof Error ? (err as ApiError) : null);
    } finally {
      setIsLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <ErrorState
        message={
          error.status === 404
            ? t("admin.recoveryIncident.notFound")
            : error.message || t("admin.recoveryIncident.loadFailed")
        }
        onRetry={() => void load()}
      />
    );
  }
  if (!data) {
    return (
      <EmptyState
        icon={<AppIcon icon={ShieldAlert} size="state" />}
        title={t("admin.recoveryIncident.notFound")}
        description={t("admin.recoveryIncident.notFoundDescription")}
      />
    );
  }

  const snapshotStale =
    Date.now() - new Date(data.snapshotAt).getTime() > SNAPSHOT_STALE_MS;
  const attemptStatusById = new Map(
    data.attemptSummaries.map((a) => [a.id, a.status]),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.recoveryIncident.title")}
        description={data.incident.description}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to={routes.admin.recovery}>
              <AppIcon icon={ArrowLeft} size="inline" className="mr-1" />
              {t("admin.recoveryIncident.back")}
            </Link>
          </Button>
        }
      />

      {/* Snapshot indicator — the aggregate is one consistent read. */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {snapshotStale && (
          <AppIcon icon={CircleAlert} size="inline" className="text-warning" />
        )}
        {t("admin.recoveryIncident.snapshotAt", {
          time: formatTime(data.snapshotAt),
        })}
        {snapshotStale && (
          <span className="text-warning">
            {t("admin.recoveryIncident.snapshotStale")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Incident overview */}
        <PageSection
          title={t("admin.recoveryIncident.sections.overview")}
          className="lg:col-span-2"
        >
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.recoveryIncident.header.status")}
              </dt>
              <dd>
                <StatusBadge status={incidentStatusKey(data.incident.status)} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.recoveryIncident.header.severity")}
              </dt>
              <dd className="text-sm">
                {t(
                  `admin.recoveryQueue.severity.${data.incident.severity}` as never,
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.recoveryIncident.header.type")}
              </dt>
              <dd className="text-sm">
                {t(
                  `admin.recoveryIncident.type.${data.incident.type}` as never,
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.recoveryIncident.header.createdAt")}
              </dt>
              <dd className="text-sm">{formatTime(data.incident.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.recoveryIncident.reportedBy")}
              </dt>
              <dd className="text-sm">{data.incident.reportedBy}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.recoveryIncident.header.version")}
              </dt>
              <dd className="text-sm">{data.incident.version}</dd>
            </div>
            {data.incident.resolvedBy && (
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("admin.recoveryIncident.resolvedBy")}
                </dt>
                <dd className="text-sm">{data.incident.resolvedBy}</dd>
              </div>
            )}
            {data.incident.resolutionSummary && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">
                  {t("admin.recoveryIncident.resolutionSummary")}
                </dt>
                <dd className="text-sm">{data.incident.resolutionSummary}</dd>
              </div>
            )}
          </dl>
        </PageSection>

        {/* Exam summary */}
        <PageSection title={t("admin.recoveryIncident.sections.exam")}>
          <dl className="flex flex-col gap-2">
            <dd className="text-sm font-medium">{data.examSummary.title}</dd>
            <dd>
              <StatusBadge status={data.examSummary.status} />
            </dd>
            <dd className="text-xs text-muted-foreground">
              {t("admin.recoveryIncident.examCloseAt")}:{" "}
              {formatTime(data.examSummary.closeAt)}
            </dd>
          </dl>
        </PageSection>

        {/* Candidate summaries */}
        <PageSection title={t("admin.recoveryIncident.sections.candidates")}>
          {data.candidateSummaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.recoveryIncident.noCandidates")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.candidateSummaries.map((c) => (
                <li key={c.id} className="text-sm">
                  {c.displayName}
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Attempt summaries */}
        <PageSection
          title={t("admin.recoveryIncident.sections.attempts")}
          className="lg:col-span-2"
        >
          {data.attemptSummaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.recoveryIncident.noAttempts")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.attemptSummaries.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2"
                >
                  <Link
                    to={routes.admin.recoveryAttempt(a.id)}
                    className="text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {a.id}
                  </Link>
                  <StatusBadge status={a.status} />
                  <span className="text-xs text-muted-foreground">
                    {t("admin.recoveryIncident.effectiveDeadline")}:{" "}
                    {formatTime(a.effectiveDeadlineAt)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("admin.recoveryIncident.score")}:{" "}
                    {a.score == null ? "—" : a.score}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Events — chronological (server-ordered) */}
        <PageSection title={t("admin.recoveryIncident.sections.events")}>
          {data.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.recoveryIncident.noEvents")}
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {data.events.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-medium">
                      {t(
                        `admin.recoveryIncident.eventType.${e.eventType}` as never,
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatTime(e.createdAt)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {e.actorId ?? "—"}
                    </span>
                  </span>
                  <PayloadSummary payload={e.payload} />
                </li>
              ))}
            </ol>
          )}
        </PageSection>

        {/* Notes */}
        <PageSection title={t("admin.recoveryIncident.sections.notes")}>
          {data.notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.recoveryIncident.noNotes")}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.notes.map((n) => (
                <li key={n.operationId} className="flex flex-col gap-0.5">
                  <span className="text-sm">{n.body}</span>
                  <span className="text-xs text-muted-foreground">
                    {n.actorId ?? "—"} · {formatTime(n.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Action links */}
        <PageSection title={t("admin.recoveryIncident.sections.actions")}>
          {data.actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.recoveryIncident.noActions")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.actions.map((a) => (
                <li key={a.id} className="flex flex-col gap-0.5 py-2">
                  <span className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-medium">
                      {t(
                        `admin.recoveryIncident.actionType.${a.actionType}` as never,
                      )}
                    </span>
                    <Link
                      to={routes.admin.recoveryAttempt(a.attemptId)}
                      className="text-xs underline-offset-4 hover:underline"
                    >
                      {a.attemptId}
                    </Link>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("admin.recoveryIncident.actor")}: {a.actorId ?? "—"} ·{" "}
                    {t("admin.recoveryIncident.header.type")}: {a.operationId} ·{" "}
                    {formatTime(a.linkedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Attempt memberships */}
        <PageSection title={t("admin.recoveryIncident.sections.memberships")}>
          {data.attemptMemberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.recoveryIncident.noMemberships")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.attemptMemberships.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <Link
                    to={routes.admin.recoveryAttempt(m.attemptId)}
                    className="text-sm underline-offset-4 hover:underline"
                  >
                    {m.attemptId}
                  </Link>
                  <span className="text-xs">
                    {t(
                      `admin.recoveryIncident.relationshipType.${m.relationshipType}` as never,
                    )}
                  </span>
                  {attemptStatusById.get(m.attemptId) && (
                    <StatusBadge status={attemptStatusById.get(m.attemptId)!} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Interruption evidence links — stubs; full episodes live on the
            attempt operations page (Task 7 mapping DECISION-1). */}
        <PageSection title={t("admin.recoveryIncident.sections.interruptions")}>
          {data.interruptionLinks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.recoveryIncident.noInterruptions")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.interruptionLinks.map((l) => (
                <li key={l.id} className="flex flex-col gap-0.5 py-2">
                  <span className="text-sm font-medium">
                    {l.interruptionId}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("admin.recoveryIncident.header.type")}:{" "}
                    <Link
                      to={routes.admin.recoveryAttempt(l.attemptId)}
                      className="underline-offset-4 hover:underline"
                    >
                      {l.attemptId}
                    </Link>{" "}
                    · {formatTime(l.linkedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Time adjustment summaries — incident-scoped (contract §6.1/§6.3). */}
        <PageSection title={t("admin.recoveryIncident.sections.adjustments")}>
          {data.timeAdjustmentSummaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.recoveryIncident.noAdjustments")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.timeAdjustmentSummaries.map((adj) => (
                <li key={adj.id} className="flex flex-col gap-1 py-2">
                  <span className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-medium">
                      {t(
                        `admin.recoveryIncident.policy.${adj.policy}` as never,
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t(
                        `admin.recoveryIncident.source.${adj.source}` as never,
                      )}
                    </span>
                    <span className="text-xs">+{adj.addedSeconds}s</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("admin.recoveryIncident.beforeDeadline")}:{" "}
                    {formatTime(adj.beforeDeadline)}
                    {" · "}
                    {t("admin.recoveryIncident.afterDeadline")}:{" "}
                    {formatTime(adj.afterDeadline)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("admin.recoveryIncident.actor")}: {adj.actorId ?? "—"} ·{" "}
                    {adj.reasonText ?? adj.reasonCode ?? "—"} ·{" "}
                    {formatTime(adj.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Audit references */}
        <PageSection title={t("admin.recoveryIncident.sections.audit")}>
          {data.auditReferences.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.recoveryIncident.noAudit")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.auditReferences.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <span className="text-sm font-medium">{r.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.actorName ?? r.actorId ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(r.createdAt)}
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
