import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api, ApiError } from "@/lib/api";
import type { ExamRecoveryContext as RecoveryExamContextResponse } from "@exam/contracts";
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
import { PageContainer } from "@/components/shared/PageContainer";
import { RecoveryCommandDialog } from "@/features/recovery-operations/RecoveryCommandDialog";
import { useRecoveryOperation } from "@/features/recovery-operations/useRecoveryOperation";
import {
  ArrowLeft,
  CircleAlert,
  ListFilter,
  RefreshCw,
  UserPlus,
} from "lucide-react";

const INCIDENT_STATUSES = ["open", "investigating", "resolved", "dismissed"];
const INCIDENT_SEVERITIES = ["info", "minor", "major", "critical"];
const STALE_AFTER_MS = 2 * 60_000;
const NAMESPACE = "admin.recoveryExam";

/**
 * J5-I1C1 — assign-proctor command for the exam recovery detail. The wire has
 * no "available proctors" list, so the admin enters a proctor userId; the
 * server resolves the user and fail-closes (404 unknown / 403 not a proctor /
 * 409 duplicate). One operationId per dialog session, retry-safe.
 */
function AssignProctorCommand({
  examId,
  examTitle,
  refresh,
}: {
  examId: string;
  examTitle: string;
  refresh: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [proctorUserId, setProctorUserId] = useState("");

  const command = useRecoveryOperation({
    submit: (operationId) =>
      api.post(`/api/admin/exams/${examId}/proctors`, {
        operationId,
        proctorUserId: proctorUserId.trim(),
      }),
    onSuccess: () => {
      toast.success(t("admin.recoveryOps.actions.assignProctorDone"));
      setOpen(false);
      setProctorUserId("");
      refresh();
    },
    onConfirmedRejection: (err) => {
      setOpen(false);
      toast.error(
        err instanceof ApiError
          ? t("admin.recoveryOps.rejectionFailed")
          : t("admin.recoveryOps.indeterminate"),
      );
    },
    onIndeterminate: () => toast.error(t("admin.recoveryOps.indeterminate")),
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // Reset the draft ONLY when no command session is active — a frozen
          // command (retry) must never have its payload replaced by a reset.
          if (command.phase === "idle" && command.operationId === null) {
            setProctorUserId("");
          }
          setOpen(true);
          command.begin();
        }}
        disabled={command.phase === "submitting"}
      >
        <AppIcon icon={UserPlus} size="inline" className="mr-1" />
        {t("admin.recoveryOps.actions.assignProctor")}
      </Button>
      <RecoveryCommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("admin.recoveryOps.actions.assignProctor")}
        description={t("admin.recoveryOps.assignProctorDescription", {
          title: examTitle,
        })}
        confirmLabel={t("admin.recoveryOps.actions.assignProctor")}
        confirmDisabled={proctorUserId.trim().length === 0}
        submitting={command.phase === "submitting"}
        indeterminate={command.phase === "indeterminate"}
        onConfirm={() => void command.run()}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="recovery-assign-proctor-user">
            {t("admin.recoveryOps.proctorUserIdLabel")}
          </Label>
          <Input
            id="recovery-assign-proctor-user"
            value={proctorUserId}
            onChange={(e) => setProctorUserId(e.target.value)}
          />
          {proctorUserId.trim().length === 0 && (
            <FieldError>
              {t("admin.recoveryOps.proctorUserIdRequired")}
            </FieldError>
          )}
        </div>
      </RecoveryCommandDialog>
    </>
  );
}

/**
 * J5-I1C1 — revoke-proctor command for one active proctor. Destructive
 * confirmation naming the proctor + exam; terminal for the assignment.
 */
function RevokeProctorCommand({
  examId,
  examTitle,
  userId,
  displayName,
  refresh,
}: {
  examId: string;
  examTitle: string;
  userId: string;
  displayName: string;
  refresh: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const command = useRecoveryOperation({
    submit: (operationId) =>
      api.post(
        `/api/admin/exams/${examId}/proctors/${encodeURIComponent(userId)}/revoke`,
        { operationId },
      ),
    onSuccess: () => {
      toast.success(t("admin.recoveryOps.actions.revokeProctorDone"));
      setOpen(false);
      refresh();
    },
    onConfirmedRejection: (err) => {
      setOpen(false);
      toast.error(
        err instanceof ApiError
          ? t("admin.recoveryOps.rejectionFailed")
          : t("admin.recoveryOps.indeterminate"),
      );
    },
    onIndeterminate: () => toast.error(t("admin.recoveryOps.indeterminate")),
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          command.begin();
        }}
        disabled={command.phase === "submitting"}
      >
        {t("admin.recoveryOps.actions.revokeProctor")}
      </Button>
      <RecoveryCommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("admin.recoveryOps.actions.revokeProctor")}
        description={t("admin.recoveryOps.revokeProctorDescription", {
          name: displayName,
          title: examTitle,
        })}
        confirmLabel={t("admin.recoveryOps.revokeConfirmLabel")}
        destructive
        submitting={command.phase === "submitting"}
        indeterminate={command.phase === "indeterminate"}
        onConfirm={() => void command.run()}
      >
        <p className="type-secondary">{displayName}</p>
      </RecoveryCommandDialog>
    </>
  );
}

/**
 * Exam Recovery Detail (J5-I1B4, contract §6.5) — the org-wide Exam recovery
 * aggregate: exam summary, incident counts, recent incidents, active proctors
 * and the attempt status distribution, all from ONE server snapshot. Read-only
 * Admin surface; renders only wire fields (no self-derivation).
 *
 * Refresh model (J5-R0 §9): no polling (the queue is the live surface), but a
 * manual Refresh button and a server-snapshot-based stale indicator are
 * provided. Errors flow through the shared classifier (no copy leaks from
 * sibling pages).
 */
export function RecoveryExamDetailPage() {
  const { t } = useTranslation();
  const { formatTime } = useProductDateTime();
  const { examId } = useParams<{ examId: string }>();

  const { data, error, isInitialLoading, isRefreshing, isStale, refresh } =
    useRecoveryProjection<RecoveryExamContextResponse>({
      load: ({ signal }) =>
        api.get<RecoveryExamContextResponse>(
          `/api/admin/recovery/exams/${examId}`,
          { signal },
        ),
      getSnapshotAt: (d) => d.snapshotAt,
      staleAfterMs: STALE_AFTER_MS,
      deps: [examId],
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
        icon={<AppIcon icon={ListFilter} size="state" />}
        title={t("admin.recoveryExam.notFound")}
        description={t("admin.recoveryExam.notFoundDescription")}
      />
    );
  }

  const queueForExam = `${routes.admin.recovery}?examId=${data.examSummary.id}`;
  const attemptStatusEntries = Object.entries(data.attemptStatusDistribution);

  return (
    <PageContainer role="admin-standard" className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.recoveryExam.title")}
        description={data.examSummary.title}
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
                ? t("admin.recoveryExam.refreshing")
                : t("admin.recoveryExam.refresh")}
            </Button>
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
        {t("admin.recoveryExam.snapshotAt", {
          time: formatTime(data.snapshotAt),
        })}
        {isStale && (
          <span className="text-warning">
            {t("admin.recoveryExam.snapshotStale")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Exam summary */}
        <PageSection title={t("admin.recoveryExam.sections.exam")}>
          <dl className="flex flex-col gap-2">
            <div>
              <dt className="type-metadata">
                {t("admin.recoveryExam.sections.exam")}
              </dt>
              <dd className="text-sm font-medium break-words">
                {data.examSummary.title}
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
                {t("admin.recoveryExam.timingMode")}
              </dt>
              <dd className="text-sm">
                {t(
                  `admin.recoveryExam.timingModeValue.${data.examSummary.timingMode}` as never,
                )}
              </dd>
            </div>
            <div>
              <dt className="type-metadata">
                {t("admin.recoveryExam.examCloseAt")}
              </dt>
              <dd className="text-sm">
                {data.examSummary.closeAt === null
                  ? "—"
                  : formatTime(data.examSummary.closeAt)}
              </dd>
            </div>
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
                  <span className="type-metadata">
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
            <p className="type-secondary">
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
                  <span className="type-metadata">
                    {t(
                      `admin.recoveryQueue.severity.${incident.severity}` as never,
                    )}
                  </span>
                  <span className="type-metadata">
                    {formatTime(incident.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        {/* Active proctors (J5-I1C1) — assign + per-proctor revoke commands.
            The wire has no allowedActions for this surface; server-side
            capability gating (ExamProctorAssignmentManage) is the authority. */}
        <PageSection title={t("admin.recoveryExam.sections.proctors")}>
          {data.activeProctors.length === 0 ? (
            <p className="type-secondary">
              {t("admin.recoveryExam.noProctors")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.activeProctors.map((p) => (
                <li
                  key={p.userId}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="text-sm">{p.displayName}</span>
                  <RevokeProctorCommand
                    examId={data.examSummary.id}
                    examTitle={data.examSummary.title}
                    userId={p.userId}
                    displayName={p.displayName}
                    refresh={refresh}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 border-t pt-3">
            <AssignProctorCommand
              examId={data.examSummary.id}
              examTitle={data.examSummary.title}
              refresh={refresh}
            />
          </div>
        </PageSection>

        {/* Attempt status distribution — all attempts of the exam */}
        <PageSection
          title={t("admin.recoveryExam.sections.attempts")}
          className="lg:col-span-2"
        >
          {attemptStatusEntries.length === 0 ? (
            <p className="type-secondary">
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
    </PageContainer>
  );
}
