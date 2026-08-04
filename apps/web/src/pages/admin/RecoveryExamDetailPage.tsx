import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { ApiError, api } from "@/lib/api";
import type { RecoveryExamContextResponse } from "@/lib/recovery";
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
import { ArrowLeft, ListFilter, ShieldAlert } from "lucide-react";

const INCIDENT_STATUSES = ["open", "investigating", "resolved", "dismissed"];
const INCIDENT_SEVERITIES = ["info", "minor", "major", "critical"];

/**
 * Exam Recovery Detail (J5-I1B4, contract §6.5) — the org-wide Exam recovery
 * aggregate: exam summary, incident counts, recent incidents, active proctors
 * and the attempt status distribution, all from ONE server snapshot. Read-only
 * Admin surface; renders only wire fields (no self-derivation).
 */
export function RecoveryExamDetailPage() {
  const { t } = useTranslation();
  const { formatTime } = useProductDateTime();
  const { examId } = useParams<{ examId: string }>();

  const [data, setData] = useState<RecoveryExamContextResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!examId) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.get<RecoveryExamContextResponse>(
        `/api/admin/recovery/exams/${examId}`,
      );
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? (err as ApiError) : null);
    } finally {
      setIsLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <ErrorState
        message={
          error.status === 404
            ? t("admin.recoveryExam.notFound")
            : error.message || t("admin.recoveryAttempt.loadFailed")
        }
        onRetry={() => void load()}
      />
    );
  }
  if (!data) {
    return (
      <EmptyState
        icon={<AppIcon icon={ShieldAlert} size="state" />}
        title={t("admin.recoveryExam.notFound")}
        description={t("admin.recoveryExam.notFoundDescription")}
      />
    );
  }

  const queueForExam = `${routes.admin.recovery}?examId=${data.examSummary.id}`;
  const attemptStatusEntries = Object.entries(data.attemptStatusDistribution);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.recoveryExam.title")}
        description={data.examSummary.title}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={queueForExam}>
                <AppIcon icon={ListFilter} size="inline" className="mr-1" />
                {t("admin.recoveryExam.viewInQueue")}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={routes.admin.recovery}>
                <AppIcon icon={ArrowLeft} size="inline" className="mr-1" />
                {t("admin.recoveryExam.back")}
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Exam summary */}
        <PageSection title={t("admin.recoveryExam.sections.exam")}>
          <dl className="flex flex-col gap-2">
            <dd className="text-sm font-medium">{data.examSummary.title}</dd>
            <dd>
              <StatusBadge status={data.examSummary.status} />
            </dd>
            <dd className="text-xs text-muted-foreground">
              {t("admin.recoveryExam.timingMode")}:{" "}
              {t(
                `admin.recoveryExam.timingModeValue.${data.examSummary.timingMode}` as never,
              )}
            </dd>
            <dd className="text-xs text-muted-foreground">
              {t("admin.recoveryExam.examCloseAt")}:{" "}
              {formatTime(data.examSummary.closeAt)}
            </dd>
          </dl>
        </PageSection>

        {/* Incident stats — counts by status and severity */}
        <PageSection title={t("admin.recoveryExam.sections.incidents")}>
          <p className="mb-2 text-sm">
            {t("admin.recoveryExam.incidentTotal")}:{" "}
            <span className="font-medium">{data.incidentStats.total}</span>
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-8">
            <div className="flex flex-col gap-1">
              {INCIDENT_STATUSES.map((status) => (
                <span key={status} className="flex items-center gap-2 text-sm">
                  <StatusBadge status={incidentStatusKey(status)} />
                  <span className="font-medium">
                    {
                      data.incidentStats.byStatus[
                        status as keyof typeof data.incidentStats.byStatus
                      ]
                    }
                  </span>
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {INCIDENT_SEVERITIES.map((severity) => (
                <span
                  key={severity}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="text-xs text-muted-foreground">
                    {t(`admin.recoveryQueue.severity.${severity}` as never)}
                  </span>
                  <span className="font-medium">
                    {
                      data.incidentStats.bySeverity[
                        severity as keyof typeof data.incidentStats.bySeverity
                      ]
                    }
                  </span>
                </span>
              ))}
            </div>
          </div>
        </PageSection>

        {/* Recent incidents — navigation stubs to the incident detail page */}
        <PageSection title={t("admin.recoveryExam.sections.recentIncidents")}>
          {data.recentIncidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.recoveryExam.noRecentIncidents")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.recentIncidents.map((incident) => (
                <li
                  key={incident.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <Link
                    to={routes.admin.recoveryIncident(incident.id)}
                    className="text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {t(`admin.recoveryIncident.type.${incident.type}` as never)}
                  </Link>
                  <StatusBadge status={incidentStatusKey(incident.status)} />
                  <span className="text-xs text-muted-foreground">
                    {t(
                      `admin.recoveryQueue.severity.${incident.severity}` as never,
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(incident.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Active proctors */}
        <PageSection title={t("admin.recoveryExam.sections.proctors")}>
          {data.activeProctors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.recoveryExam.noProctors")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.activeProctors.map((p) => (
                <li key={p.userId} className="text-sm">
                  {p.displayName}
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Attempt status distribution — all attempts of the exam */}
        <PageSection
          title={t("admin.recoveryExam.sections.attempts")}
          className="lg:col-span-2"
        >
          {attemptStatusEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.recoveryExam.noAttempts")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {attemptStatusEntries.map(([status, count]) => (
                <li key={status} className="flex items-center gap-3 py-2">
                  <StatusBadge status={status} />
                  <span className="text-sm font-medium">
                    {t("admin.recoveryExam.attemptCount", { count })}
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
