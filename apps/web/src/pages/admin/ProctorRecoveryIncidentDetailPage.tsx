import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api } from "@/lib/api";
import type { ProctorIncidentDetail } from "@exam/contracts";
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
import { DefinitionList } from "@/components/shared/DefinitionList";
import { AppIcon } from "@/components/shared/AppIcon";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/shared/PageContainer";
import {
  IncidentCommand,
  PayloadSummary,
} from "@/features/recovery-operations/IncidentCommand";
import { ArrowLeft, CircleAlert, RefreshCw, ShieldAlert } from "lucide-react";

/**
 * Point-in-time read — the page renders exactly the server snapshot; the
 * stale flag self-updates via the projection hook's wall-clock tick.
 */
const SNAPSHOT_STALE_MS = 2 * 60_000;
const NAMESPACE = "admin.proctorRecoveryIncident";

/**
 * Proctor Recovery incident detail (J6, EXAM-303).
 *
 * Narrow Proctor projection over `GET /api/admin/incidents/:incidentId/detail`
 * (assignment_scoped): incident row + event history (notes are events) + link
 * metadata + summaries already within Proctor read authority. Per the EXAM-303
 * freeze (F3, human-gate corrective) the wire carries NO time-adjustment
 * ledger, NO auditReferences, and NO Admin attempt-command execution details —
 * the page cannot render what the server never sends.
 *
 * The operations area renders ONLY the server-computed `allowedActions`
 * (status candidates ∩ caller capabilities): for a Proctor this is the
 * investigate family on non-terminal incidents — resolve/dismiss (Admin
 * terminal judgment) is structurally absent, and link_attempt appears only on
 * non-anchored incidents.
 */
export function ProctorRecoveryIncidentDetailPage() {
  const { t } = useTranslation();
  const { formatTime } = useProductDateTime();
  const { incidentId } = useParams<{ incidentId: string }>();

  const { data, error, isInitialLoading, isRefreshing, isStale, refresh } =
    useRecoveryProjection<ProctorIncidentDetail>({
      load: ({ signal }) =>
        api.get<ProctorIncidentDetail>(
          `/api/admin/incidents/${incidentId}/detail`,
          { signal },
        ),
      getSnapshotAt: (d) => d.snapshotAt,
      staleAfterMs: SNAPSHOT_STALE_MS,
      deps: [incidentId],
    });

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
        icon={<AppIcon icon={ShieldAlert} size="state" />}
        title={t("admin.proctorRecoveryIncident.notFound")}
        description={t("admin.proctorRecoveryIncident.notFoundDescription")}
      />
    );
  }

  return (
    <PageContainer role="admin-standard" className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.proctorRecoveryIncident.title")}
        description={data.incident.description}
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
                ? t("admin.proctorRecoveryIncident.refreshing")
                : t("admin.proctorRecoveryIncident.refresh")}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={routes.admin.proctorRecovery}>
                <AppIcon icon={ArrowLeft} size="inline" className="mr-1" />
                {t("admin.proctorRecoveryIncident.back")}
              </Link>
            </Button>
          </div>
        }
      />

      {/* Background-refresh failure: old data stays on screen + inline
          warning; full ErrorState only when there is no data at all. */}
      {error && (
        <InlineErrorBanner>
          {t(recoveryErrorMessageKey(error.kind, NAMESPACE) as never)}
        </InlineErrorBanner>
      )}

      {isStale && (
        <div className="flex items-center gap-2 type-metadata text-warning">
          <AppIcon icon={CircleAlert} size="inline" />
          {t("admin.proctorRecoveryIncident.snapshotStale")}
        </div>
      )}

      {/* Operations — server-computed eligibility, never a client-side
          derivation from status. */}
      {data.allowedActions.length > 0 && (
        <PageSection
          title={t("admin.recoveryOps.operationsTitle")}
          className="lg:col-span-2"
        >
          <div className="flex flex-wrap gap-2">
            {data.allowedActions.includes("investigate") && (
              <IncidentCommand
                incidentId={data.incident.id}
                incidentVersion={data.incident.version}
                endpoint="/investigate"
                titleKey="admin.recoveryOps.actions.investigate"
                confirmLabelKey="admin.recoveryOps.actions.investigate"
                doneToastKey="admin.recoveryOps.actions.investigateDone"
                description={t("admin.recoveryOps.investigateDescription", {
                  id: data.incident.id,
                  description: data.incident.description,
                })}
                fields={[
                  {
                    kind: "select",
                    key: "reasonCode",
                    labelKey: "admin.recoveryOps.reasonCodeLabel",
                    required: false,
                    options: [
                      {
                        value: "technical_incident",
                        labelKey:
                          "admin.recoveryOps.reasonCodeTechnicalIncident",
                      },
                      {
                        value: "candidate_request",
                        labelKey:
                          "admin.recoveryOps.reasonCodeCandidateRequest",
                      },
                      {
                        value: "other",
                        labelKey: "admin.recoveryOps.reasonCodeOther",
                      },
                    ],
                  },
                  {
                    kind: "text",
                    key: "reasonText",
                    labelKey: "admin.recoveryOps.reasonTextLabel",
                    required: false,
                    maxLength: 1000,
                  },
                ]}
                refresh={refresh}
              />
            )}
            {data.allowedActions.includes("add_note") && (
              <IncidentCommand
                incidentId={data.incident.id}
                incidentVersion={data.incident.version}
                endpoint="/notes"
                titleKey="admin.recoveryOps.actions.addNote"
                confirmLabelKey="admin.recoveryOps.actions.addNote"
                doneToastKey="admin.recoveryOps.actions.addNoteDone"
                description={t("admin.recoveryOps.addNoteDescription", {
                  id: data.incident.id,
                })}
                versioned={false}
                fields={[
                  {
                    kind: "text",
                    key: "body",
                    labelKey: "admin.recoveryOps.bodyLabel",
                    required: true,
                    requiredErrorKey: "admin.recoveryOps.bodyRequired",
                    maxLength: 500,
                  },
                ]}
                refresh={refresh}
              />
            )}
            {data.allowedActions.includes("change_severity") && (
              <IncidentCommand
                incidentId={data.incident.id}
                incidentVersion={data.incident.version}
                endpoint="/severity"
                titleKey="admin.recoveryOps.actions.changeSeverity"
                confirmLabelKey="admin.recoveryOps.actions.changeSeverity"
                doneToastKey="admin.recoveryOps.actions.changeSeverityDone"
                description={t("admin.recoveryOps.changeSeverityDescription", {
                  id: data.incident.id,
                })}
                fields={[
                  {
                    kind: "select",
                    key: "severity",
                    labelKey: "admin.recoveryOps.severityLabel",
                    required: true,
                    requiredErrorKey: "admin.recoveryOps.severityRequired",
                    options: [
                      {
                        value: "info",
                        labelKey: "admin.recoveryQueue.severity.info",
                      },
                      {
                        value: "minor",
                        labelKey: "admin.recoveryQueue.severity.minor",
                      },
                      {
                        value: "major",
                        labelKey: "admin.recoveryQueue.severity.major",
                      },
                      {
                        value: "critical",
                        labelKey: "admin.recoveryQueue.severity.critical",
                      },
                    ],
                  },
                  {
                    kind: "text",
                    key: "reasonText",
                    labelKey: "admin.recoveryOps.reasonTextLabel",
                    required: false,
                    maxLength: 1000,
                  },
                ]}
                refresh={refresh}
              />
            )}
            {data.allowedActions.includes("link_attempt") && (
              <IncidentCommand
                incidentId={data.incident.id}
                incidentVersion={data.incident.version}
                endpoint="/attempts"
                titleKey="admin.recoveryOps.actions.linkAttempt"
                confirmLabelKey="admin.recoveryOps.actions.linkAttempt"
                doneToastKey="admin.recoveryOps.actions.linkAttemptDone"
                description={t(
                  "admin.recoveryOps.linkAttemptDescription" as never,
                  {
                    id: data.incident.id,
                  },
                )}
                fields={[
                  {
                    kind: "text",
                    key: "attemptId",
                    labelKey: "admin.proctorRecoveryIncident.attemptIdLabel",
                    required: true,
                    requiredErrorKey:
                      "admin.proctorRecoveryIncident.attemptIdRequired",
                  },
                  {
                    kind: "select",
                    key: "relationshipType",
                    labelKey: "admin.proctorRecoveryIncident.relationshipLabel",
                    required: true,
                    requiredErrorKey:
                      "admin.proctorRecoveryIncident.relationshipRequired",
                    options: [
                      {
                        value: "affected",
                        labelKey:
                          "admin.recoveryIncident.relationshipType.affected",
                      },
                      {
                        value: "referenced",
                        labelKey:
                          "admin.recoveryIncident.relationshipType.referenced",
                      },
                    ],
                  },
                ]}
                refresh={refresh}
              />
            )}
          </div>
        </PageSection>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Incident overview */}
        <PageSection
          title={t("admin.proctorRecoveryIncident.sections.overview")}
          className="lg:col-span-2"
        >
          <DefinitionList
            className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2"
            items={[
              {
                label: t("admin.recoveryIncident.header.status"),
                value: (
                  <StatusBadge
                    status={incidentStatusKey(data.incident.status)}
                  />
                ),
              },
              {
                label: t("admin.recoveryIncident.header.severity"),
                value: t(
                  `admin.recoveryQueue.severity.${data.incident.severity}` as never,
                ),
              },
              {
                label: t("admin.recoveryIncident.header.type"),
                value: t(
                  `admin.recoveryIncident.type.${data.incident.type}` as never,
                ),
              },
              {
                label: t("admin.recoveryIncident.header.createdAt"),
                value: formatTime(data.incident.createdAt),
              },
              {
                label: t("admin.recoveryIncident.header.version"),
                value: data.incident.version,
              },
              ...(data.incident.resolutionSummary
                ? [
                    {
                      label: t("admin.recoveryIncident.resolutionSummary"),
                      value: data.incident.resolutionSummary,
                      className: "sm:col-span-2",
                    },
                  ]
                : []),
            ]}
          />
        </PageSection>

        {/* Exam + anchor attempt — summaries already within Proctor read
            authority (the assigned-exam list row / monitoring row). */}
        <PageSection title={t("admin.proctorRecoveryIncident.sections.exam")}>
          <DefinitionList
            className="flex flex-col gap-2"
            items={[
              {
                label: t("admin.proctorRecoveryIncident.sections.exam"),
                value: (
                  <span className="font-medium">{data.examSummary.title}</span>
                ),
              },
              {
                label: t("admin.proctorRecovery.columns.attempt"),
                value: data.primaryAttempt ? (
                  <span className="flex items-center gap-2">
                    <Link
                      to={routes.admin.attemptDetail(data.primaryAttempt.id)}
                      className="text-sm underline-offset-4 hover:underline"
                    >
                      {data.primaryAttempt.id}
                    </Link>
                    <StatusBadge status={data.primaryAttempt.status} />
                  </span>
                ) : (
                  t("admin.recoveryQueue.noAttempt")
                ),
              },
            ]}
          />
        </PageSection>

        {/* Events — chronological (server-ordered) */}
        <PageSection
          title={t("admin.proctorRecoveryIncident.sections.events")}
          className="lg:col-span-2"
        >
          {data.events.length === 0 ? (
            <p className="type-secondary">
              {t("admin.proctorRecoveryIncident.noEvents")}
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
                    <span className="type-metadata">
                      {formatTime(e.createdAt)}
                    </span>
                  </span>
                  <PayloadSummary payload={e.payload} />
                </li>
              ))}
            </ol>
          )}
        </PageSection>

        {/* Notes */}
        <PageSection title={t("admin.proctorRecoveryIncident.sections.notes")}>
          {data.notes.length === 0 ? (
            <p className="type-secondary">
              {t("admin.proctorRecoveryIncident.noNotes")}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.notes.map((n) => (
                <li key={n.operationId} className="flex flex-col gap-0.5">
                  <span className="text-sm">{n.body}</span>
                  <span className="type-metadata">
                    {formatTime(n.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Attempt memberships — link metadata; the attempt id links to the
            assignment-scoped attempt detail the Proctor already may read. */}
        <PageSection title={t("admin.recoveryIncident.sections.memberships")}>
          {data.attemptLinks.length === 0 ? (
            <p className="type-secondary">
              {t("admin.recoveryIncident.noMemberships")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.attemptLinks.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <Link
                    to={routes.admin.attemptDetail(m.attemptId)}
                    className="text-sm underline-offset-4 hover:underline"
                  >
                    {m.attemptId}
                  </Link>
                  <span className="text-xs">
                    {t(
                      `admin.recoveryIncident.relationshipType.${m.relationshipType}` as never,
                    )}
                  </span>
                  <span className="type-metadata">
                    {formatTime(m.linkedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Linked operator actions — incident-domain link metadata only
            (type / linked id / time). The underlying execution details are
            Admin recovery surface and are deliberately not present on this
            wire (freeze F3). */}
        <PageSection title={t("admin.recoveryIncident.sections.actions")}>
          {data.actionLinks.length === 0 ? (
            <p className="type-secondary">
              {t("admin.recoveryIncident.noActions")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.actionLinks.map((a) => (
                <li key={a.id} className="flex flex-col gap-0.5 py-2">
                  <span className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-medium">
                      {t(
                        `admin.recoveryIncident.actionType.${a.actionType}` as never,
                      )}
                    </span>
                    <span className="type-metadata">
                      {formatTime(a.linkedAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Interruption evidence links — episode ids only; the full episode
            ledger is Admin recovery surface (freeze F3). */}
        <PageSection title={t("admin.recoveryIncident.sections.interruptions")}>
          {data.interruptionLinks.length === 0 ? (
            <p className="type-secondary">
              {t("admin.recoveryIncident.noInterruptions")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.interruptionLinks.map((l) => (
                <li key={l.id} className="flex flex-col gap-0.5 py-2">
                  <span className="text-sm font-medium">
                    {l.interruptionId}
                  </span>
                  <span className="type-metadata">
                    {t("admin.proctorRecoveryIncident.attemptIdLabel")}:{" "}
                    {l.attemptId} · {formatTime(l.linkedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>
      </div>
    </PageContainer>
  );
}
