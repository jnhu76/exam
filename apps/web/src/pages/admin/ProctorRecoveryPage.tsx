import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api } from "@/lib/api";
import type {
  ProctorRecoveryWorklistResponse,
  ProctorExamListResponse,
} from "@exam/contracts";
import { incidentStatusKey } from "@/lib/recovery";
import { recoveryErrorMessageKey } from "@/lib/recoveryErrors";
import { routes } from "@/lib/routes";
import { useRecoveryQueueProjection } from "@/hooks/useRecoveryQueueProjection";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { DataToolbar, ToolbarFilter } from "@/components/shared/DataToolbar";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AppIcon } from "@/components/shared/AppIcon";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/shared/FieldError";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { PageContainer } from "@/components/shared/PageContainer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RecoveryCommandDialog } from "@/features/recovery-operations/RecoveryCommandDialog";
import { useRecoveryOperation } from "@/features/recovery-operations/useRecoveryOperation";
import { LifeBuoy, RefreshCw, CircleAlert, Wrench } from "lucide-react";

/** Visible-tab polling interval — same cadence as the Admin recovery queue. */
const POLL_INTERVAL_MS = 30_000;
/** A server snapshot older than this is flagged stale. */
const STALE_AFTER_MS = 60_000;
/** Bounded failure backoff for the automatic poll cadence. */
const BACKOFF = { initialMs: POLL_INTERVAL_MS, maxMs: 5 * 60_000 };

const INCIDENT_STATUSES = ["open", "investigating", "resolved", "dismissed"];
const INCIDENT_TYPES = [
  "network_interruption",
  "device_failure",
  "power_failure",
  "candidate_unable_to_continue",
  "suspected_misconduct",
  "operator_error",
  "system_outage",
  "environmental_disruption",
  "other",
] as const;
const INCIDENT_SEVERITIES = ["info", "minor", "major", "critical"];
const NAMESPACE = "admin.proctorRecovery";

/**
 * Proctor Recovery Center worklist (J6, EXAM-303).
 *
 * Read surface over `GET /api/admin/proctor/incidents` — the server scopes
 * the collection to the caller's ACTIVE proctor assignments (never a client
 * parameter). Polling/refresh/staleness semantics are identical to the Admin
 * recovery queue ({@link useRecoveryQueueProjection}). The only mutation is
 * incident creation on an assigned exam via the canonical
 * assignment-scoped incident command route; every other action lives on the
 * per-incident detail page.
 */
export function ProctorRecoveryPage() {
  const { t } = useTranslation();
  const { formatTime } = useProductDateTime();
  const [statusFilter, setStatusFilter] = useState("");

  const queryKey = statusFilter ? `status=${statusFilter}` : "";

  const {
    items,
    nextCursor,
    error,
    isInitialLoading,
    isRefreshing,
    isLoadingMore,
    snapshotAt,
    lastUpdatedAt,
    isStale,
    refresh,
    loadMore,
  } = useRecoveryQueueProjection({
    loadPage1: ({ signal }) =>
      api.get<ProctorRecoveryWorklistResponse>(
        `/api/admin/proctor/incidents?${queryKey}`,
        { signal },
      ),
    loadMorePage: (cursor, { signal }) =>
      api.get<ProctorRecoveryWorklistResponse>(
        `/api/admin/proctor/incidents?${queryKey}&cursor=${encodeURIComponent(cursor)}`,
        { signal },
      ),
    pollIntervalMs: POLL_INTERVAL_MS,
    staleAfterMs: STALE_AFTER_MS,
    backoff: BACKOFF,
    deps: [queryKey],
  });

  const [createOpen, setCreateOpen] = useState(false);

  if (isInitialLoading) return <LoadingState />;
  if (error && snapshotAt === null) {
    return (
      <ErrorState
        message={t(recoveryErrorMessageKey(error.kind, NAMESPACE) as never)}
        onRetry={refresh}
      />
    );
  }

  return (
    <PageContainer role="admin-standard" className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.proctorRecovery.title")}
        description={t("admin.proctorRecovery.description")}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={isRefreshing}
              aria-label={t("admin.proctorRecovery.refresh")}
            >
              <AppIcon
                icon={RefreshCw}
                size="inline"
                className={isRefreshing ? "animate-spin" : undefined}
              />
              {isRefreshing
                ? t("admin.proctorRecovery.refreshing")
                : t("admin.proctorRecovery.refresh")}
            </Button>
            <CreateIncidentButton
              open={createOpen}
              onOpenChange={setCreateOpen}
              onCreated={refresh}
            />
          </div>
        }
      />
      <DataToolbar>
        <Select
          value={statusFilter || "all"}
          onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
        >
          <ToolbarFilter size="narrow">
            <SelectTrigger
              aria-label={t("admin.proctorRecovery.filters.statusAll")}
            >
              <SelectValue />
            </SelectTrigger>
          </ToolbarFilter>
          <SelectContent>
            <SelectItem value="all">
              {t("admin.proctorRecovery.filters.statusAll")}
            </SelectItem>
            {INCIDENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`admin.recoveryQueue.status.${s}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </DataToolbar>

      {snapshotAt && (
        <span className="flex items-center gap-3 type-metadata">
          <span className={isStale ? "text-warning" : undefined}>
            {isStale && <AppIcon icon={CircleAlert} size="inline" />}
            {t("admin.proctorRecovery.snapshotAt", {
              time: formatTime(snapshotAt),
            })}
          </span>
          {isStale && (
            <span className="text-warning">
              {t("admin.proctorRecovery.snapshotStale")}
            </span>
          )}
          {lastUpdatedAt && (
            <span>
              {t("admin.proctorRecovery.lastUpdatedAt", {
                time: formatTime(lastUpdatedAt),
              })}
            </span>
          )}
        </span>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={LifeBuoy} size="state" />}
          title={t("admin.proctorRecovery.empty")}
          description={t("admin.proctorRecovery.emptyDescription")}
        />
      ) : (
        <DataTableShell archetype="log-diagnostic">
          {/* Desktop table */}
          <div className="hidden md:block" data-testid="proctor-recovery-table">
            <Table>
              <DataTableColumns
                columns={[
                  { role: "status", key: "incident" },
                  { role: "type", key: "severity" },
                  { role: "long-text", key: "exam" },
                  { role: "status", key: "attempt" },
                  { role: "date", key: "createdAt" },
                ]}
              />
              <TableHeader>
                <TableRow>
                  <DataTableHead role="status">
                    {t("admin.proctorRecovery.columns.incident")}
                  </DataTableHead>
                  <DataTableHead role="type">
                    {t("admin.proctorRecovery.columns.severity")}
                  </DataTableHead>
                  <DataTableHead role="long-text">
                    {t("admin.proctorRecovery.columns.exam")}
                  </DataTableHead>
                  <DataTableHead role="status">
                    {t("admin.proctorRecovery.columns.attempt")}
                  </DataTableHead>
                  <DataTableHead role="date">
                    {t("admin.proctorRecovery.columns.createdAt")}
                  </DataTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.incident.id}>
                    <DataTableCell role="status">
                      <Link
                        to={routes.admin.proctorRecoveryIncident(
                          item.incident.id,
                        )}
                        className="text-sm font-medium underline-offset-4 hover:underline"
                      >
                        <StatusBadge
                          status={incidentStatusKey(item.incident.status)}
                        />
                      </Link>
                    </DataTableCell>
                    <DataTableCell role="type">
                      {t(
                        `admin.recoveryQueue.severity.${item.incident.severity}` as never,
                      )}
                    </DataTableCell>
                    <DataTableCell role="long-text">
                      {/* Exam title is on the never-silent-truncate list:
                          wrap, never ellipsis (issue 445 P3 §16). */}
                      {item.examSummary.title}
                    </DataTableCell>
                    <DataTableCell role="status">
                      {item.primaryAttempt ? (
                        <StatusBadge status={item.primaryAttempt.status} />
                      ) : (
                        t("admin.recoveryQueue.noAttempt")
                      )}
                    </DataTableCell>
                    <DataTableCell role="date">
                      {formatTime(item.incident.createdAt)}
                    </DataTableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card list */}
          <ul
            className="flex flex-col gap-3 md:hidden"
            data-testid="proctor-recovery-cards"
          >
            {items.map((item) => (
              <li key={item.incident.id}>
                <Link
                  to={routes.admin.proctorRecoveryIncident(item.incident.id)}
                  className="flex w-full flex-col gap-2 rounded-md border p-3 text-left"
                >
                  <span className="flex items-center justify-between gap-2">
                    <StatusBadge
                      status={incidentStatusKey(item.incident.status)}
                    />
                    <span className="type-metadata">
                      {formatTime(item.incident.createdAt)}
                    </span>
                  </span>
                  <span className="block text-sm font-medium">
                    {item.examSummary.title}
                  </span>
                  <span className="type-metadata">
                    {t(
                      ("admin.recoveryQueue.severity." +
                        item.incident.severity) as never,
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </DataTableShell>
      )}

      {/* Background-refresh failure: inline warning outside the items branch
          so an empty worklist + poll failure keeps EmptyState + warning. */}
      {error && snapshotAt !== null && (
        <InlineErrorBanner>
          {t(recoveryErrorMessageKey(error.kind, NAMESPACE) as never)}
        </InlineErrorBanner>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={loadMore}
            disabled={isLoadingMore || isRefreshing}
          >
            {isLoadingMore
              ? t("admin.proctorRecovery.loadingMore")
              : t("admin.proctorRecovery.loadMore")}
          </Button>
        </div>
      )}
    </PageContainer>
  );
}

/**
 * Incident creation on an ASSIGNED exam (canonical assignment-scoped
 * `POST /admin/exams/:examId/incidents`). The exam select is populated from
 * the same assignment-scoped list the workspace uses; ONE operationId per
 * dialog session (reused on retry), indeterminate outcomes keep the dialog in
 * the retry state instead of pretending success.
 */
function CreateIncidentButton({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [exams, setExams] = useState<ProctorExamListResponse["items"]>([]);
  const [examId, setExamId] = useState("");
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("");
  const [description, setDescription] = useState("");

  // Load the assigned-exam options fresh per dialog session — the
  // assignment scope can change between sessions (revocation/reassignment).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const controller = new AbortController();
    api
      .get<ProctorExamListResponse>("/api/admin/proctor/exams", {
        signal: controller.signal,
      })
      .then((data) => {
        if (!cancelled) setExams(data.items);
      })
      .catch(() => {
        // Option loading failure keeps the dialog open with an empty select;
        // the submit path independently re-validates the exam server-side.
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open]);

  const command = useRecoveryOperation({
    submit: (operationId) => {
      const body: Record<string, unknown> = { operationId, type, description };
      if (severity) body.severity = severity;
      return api.post(`/api/admin/exams/${examId}/incidents`, body);
    },
    onSuccess: () => {
      toast.success(t("admin.proctorRecovery.create.done"));
      onOpenChange(false);
      setExamId("");
      setType("");
      setSeverity("");
      setDescription("");
      onCreated();
    },
    onConfirmedRejection: () => {
      onOpenChange(false);
      toast.error(t("admin.recoveryOps.rejectionFailed"));
    },
    onIndeterminate: () => toast.error(t("admin.recoveryOps.indeterminate")),
  });

  const invalid = !examId || !type || description.trim().length === 0;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          onOpenChange(true);
          command.begin();
        }}
        disabled={command.phase === "submitting"}
      >
        <AppIcon icon={Wrench} size="inline" className="mr-1" />
        {t("admin.proctorRecovery.create.title")}
      </Button>
      <RecoveryCommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t("admin.proctorRecovery.create.title")}
        description={t("admin.proctorRecovery.create.description")}
        confirmLabel={t("admin.proctorRecovery.create.title")}
        confirmDisabled={invalid}
        submitting={command.phase === "submitting"}
        indeterminate={command.phase === "indeterminate"}
        onConfirm={() => void command.run()}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="proctor-recovery-create-exam">
            {t("admin.proctorRecovery.create.examLabel")}
          </Label>
          <Select value={examId} onValueChange={(v) => setExamId(v)}>
            <SelectTrigger id="proctor-recovery-create-exam">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {exams.map((exam) => (
                <SelectItem key={exam.examId} value={exam.examId}>
                  {exam.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!examId && (
            <FieldError>
              {t("admin.proctorRecovery.create.examRequired")}
            </FieldError>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="proctor-recovery-create-type">
            {t("admin.proctorRecovery.create.typeLabel")}
          </Label>
          <Select value={type} onValueChange={(v) => setType(v)}>
            <SelectTrigger id="proctor-recovery-create-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INCIDENT_TYPES.map((typeValue) => (
                <SelectItem key={typeValue} value={typeValue}>
                  {t(`admin.recoveryIncident.type.${typeValue}` as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!type && (
            <FieldError>
              {t("admin.proctorRecovery.create.typeRequired")}
            </FieldError>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="proctor-recovery-create-severity">
            {t("admin.recoveryOps.severityLabel")}
          </Label>
          <Select value={severity} onValueChange={(v) => setSeverity(v)}>
            <SelectTrigger id="proctor-recovery-create-severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INCIDENT_SEVERITIES.map((severityValue) => (
                <SelectItem key={severityValue} value={severityValue}>
                  {t(`admin.recoveryQueue.severity.${severityValue}` as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="proctor-recovery-create-description">
            {t("admin.proctorRecovery.create.descriptionLabel")}
          </Label>
          <Textarea
            id="proctor-recovery-create-description"
            value={description}
            maxLength={1000}
            onChange={(e) => setDescription(e.target.value)}
          />
          {description.trim().length === 0 && (
            <FieldError>
              {t("admin.proctorRecovery.create.descriptionRequired")}
            </FieldError>
          )}
          {description.length > 1000 && (
            <FieldError>
              {t("admin.recoveryOps.reasonTooLong", { count: 1000 })}
            </FieldError>
          )}
        </div>
      </RecoveryCommandDialog>
    </>
  );
}
