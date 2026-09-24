import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api } from "@/lib/api";
import type { RecoveryQueueItem, RecoveryQueueResponse } from "@exam/contracts";
import { incidentStatusKey } from "@/lib/recovery";
import { recoveryErrorMessageKey } from "@/lib/recoveryErrors";
import { routes } from "@/lib/routes";
import { useRecoveryQueueProjection } from "@/hooks/useRecoveryQueueProjection";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DesktopDataTable,
  type DataViewColumnDef,
} from "@/components/shared/DesktopDataTable";
import { MobileRecordList } from "@/components/shared/MobileRecordList";
import { DataToolbar, ToolbarFilter } from "@/components/shared/DataToolbar";
import { TextFilterInput } from "@/components/shared/TextFilterInput";
import { DataViewFooter } from "@/components/shared/DataViewFooter";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DatePicker } from "@/components/shared/DatePicker";
import { AppIcon } from "@/components/shared/AppIcon";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/shared/PageContainer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, X, CircleAlert } from "lucide-react";

/** Visible-tab polling interval (J5-I1B1 polling semantics). */
const POLL_INTERVAL_MS = 30_000;
/** A server snapshot older than this is flagged stale (Queue refresh contract). */
const STALE_AFTER_MS = 60_000;
/** Bounded failure backoff for the automatic poll cadence. */
const BACKOFF = { initialMs: POLL_INTERVAL_MS, maxMs: 5 * 60_000 };

/** ISO datetime for the start (00:00:00.000) of the given date, local time. */
function startOfDayISO(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** ISO datetime for the end (23:59:59.999) of the given date, local time. */
function endOfDayISO(date: Date): string {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

const INCIDENT_STATUSES = ["open", "investigating", "resolved", "dismissed"];
const INCIDENT_SEVERITIES = ["info", "minor", "major", "critical"];
const NAMESPACE = "admin.recoveryQueue";

interface QueueFilters {
  status: string;
  severity: string;
  examId: string;
  candidateId: string;
  createdFrom: string;
  createdTo: string;
}

/**
 * Recovery Center queue (J5-I1B1, contract §5.4).
 *
 * Read-only Admin surface: `GET /api/admin/recovery/incidents` with
 * server-side filters. Filters live in the URL query state (shareable,
 * refresh-safe); the keyset cursor lives in the projection coordinator (a
 * cursor in the URL would leak a server pagination secret and break on stale
 * pages).
 *
 * Refresh model (J5-R0 §9, via {@link useRecoveryQueueProjection}):
 *   - visible-only polling at 30s, dropped while a request is in flight;
 *   - focus / re-visibility triggers an immediate page-1 refresh;
 *   - manual Refresh aborts + supersedes any in-flight request;
 *   - bounded failure backoff on the automatic poll cadence;
 *   - `snapshotAt` (server RR snapshot) drives the stale indicator;
 *   - free-text filters (examId/candidateId) are debounced and committed with
 *     `replace:true` so typing does not create per-keystroke history entries.
 */
export function RecoveryQueuePage() {
  const { t } = useTranslation();
  const { formatTime } = useProductDateTime();
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: QueueFilters = useMemo(
    () => ({
      status: searchParams.get("status") ?? "",
      severity: searchParams.get("severity") ?? "",
      examId: searchParams.get("examId") ?? "",
      candidateId: searchParams.get("candidateId") ?? "",
      createdFrom: searchParams.get("createdFrom") ?? "",
      createdTo: searchParams.get("createdTo") ?? "",
    }),
    [searchParams],
  );

  const hasActiveFilter = Object.values(filters).some(Boolean);

  const buildQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.examId) params.set("examId", filters.examId);
    if (filters.candidateId) params.set("candidateId", filters.candidateId);
    if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
    if (filters.createdTo) params.set("createdTo", filters.createdTo);
    return params;
  }, [filters]);

  const queryKey = buildQuery.toString();

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
      api.get<RecoveryQueueResponse>(
        `/api/admin/recovery/incidents?${queryKey}`,
        { signal },
      ),
    loadMorePage: (cursor, { signal }) =>
      api.get<RecoveryQueueResponse>(
        `/api/admin/recovery/incidents?${queryKey}&cursor=${encodeURIComponent(cursor)}`,
        { signal },
      ),
    pollIntervalMs: POLL_INTERVAL_MS,
    staleAfterMs: STALE_AFTER_MS,
    backoff: BACKOFF,
    deps: [queryKey],
  });

  // Free-text exact-identifier filters. The commit choreography (draft →
  // debounce → blur/Enter flush → reset) is owned by TextFilterInput /
  // useDataViewTextCommit; this page owns only what a committed value MEANS —
  // the URL parameter it writes, atomically across the filter group.
  const [examIdDraft, setExamIdDraft] = useState(filters.examId);
  const [candidateIdDraft, setCandidateIdDraft] = useState(filters.candidateId);

  // Sync a draft from the URL only while the user has not typed past the last
  // committed value (back/forward, link share). A draft that has moved ahead
  // of the URL is an in-progress input and wins until its own commit lands —
  // otherwise committing one filter would reset the other's pending draft.
  const lastCommitted = useRef({
    examId: filters.examId,
    candidateId: filters.candidateId,
  });
  useEffect(() => {
    if (examIdDraft === lastCommitted.current.examId) {
      setExamIdDraft(filters.examId);
    }
    if (candidateIdDraft === lastCommitted.current.candidateId) {
      setCandidateIdDraft(filters.candidateId);
    }
    lastCommitted.current = {
      examId: filters.examId,
      candidateId: filters.candidateId,
    };
  }, [filters.examId, filters.candidateId, examIdDraft, candidateIdDraft]);

  /**
   * Commits a filter patch to the URL with replace semantics.
   *
   * The write is ATOMIC across the filter group: react-router's functional
   * `setSearchParams` updater reads the params captured at RENDER time, so two
   * commits landing in the same task — the two debounced text filters expiring
   * together — would both apply against the same base and the first would be
   * silently dropped. This ref carries the last written params, so every commit
   * starts from the latest URL state whether or not a re-render happened in
   * between.
   */
  const latestParams = useRef(searchParams);
  useEffect(() => {
    latestParams.current = searchParams;
  }, [searchParams]);

  function commitFilter(patch: Partial<QueueFilters>) {
    const next = new URLSearchParams(latestParams.current);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    latestParams.current = next;
    setSearchParams(next, { replace: true });
  }

  function clearFilters() {
    setExamIdDraft("");
    setCandidateIdDraft("");
    const cleared = new URLSearchParams();
    latestParams.current = cleared;
    setSearchParams(cleared, { replace: true });
  }

  const fromDate = filters.createdFrom
    ? new Date(filters.createdFrom)
    : undefined;
  const toDate = filters.createdTo ? new Date(filters.createdTo) : undefined;

  const columns = useMemo<DataViewColumnDef<RecoveryQueueItem>[]>(
    () => [
      {
        id: "incident",
        meta: { role: "status" },
        header: t("admin.recoveryQueue.columns.incident"),
        cell: ({ row }) => (
          <Link
            to={routes.admin.recoveryIncident(row.original.incident.id)}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            <StatusBadge
              status={incidentStatusKey(row.original.incident.status)}
            />
          </Link>
        ),
      },
      {
        id: "severity",
        meta: { role: "type", priority: "normal" },
        header: t("admin.recoveryQueue.columns.severity"),
        cell: ({ row }) =>
          t(
            `admin.recoveryQueue.severity.${row.original.incident.severity}` as never,
          ),
      },
      {
        id: "exam",
        meta: { role: "long-text", priority: "high" },
        header: t("admin.recoveryQueue.columns.exam"),
        cell: ({ row }) =>
          // Exam title is on the never-silent-truncate list: wrap, never
          // ellipsis (issue 445 P3 §16).
          row.original.examSummary.title,
      },
      {
        id: "candidate",
        meta: { role: "primary-text" },
        header: t("admin.recoveryQueue.columns.candidate"),
        cell: ({ row }) =>
          row.original.primaryCandidate?.displayName ??
          t("admin.recoveryQueue.noCandidate"),
      },
      {
        id: "attempt",
        meta: { role: "status", priority: "low" },
        header: t("admin.recoveryQueue.columns.attempt"),
        cell: ({ row }) =>
          row.original.primaryAttempt ? (
            <StatusBadge status={row.original.primaryAttempt.status} />
          ) : (
            t("admin.recoveryQueue.noAttempt")
          ),
      },
      {
        id: "linked",
        // A localized count label ("1 条关联"), not a bare numeric value —
        // the number role's 72px floor cannot hold it and the cell clipped
        // (measured on /admin/recovery). secondary-text is the bounded-text
        // role; the label never reaches its wrap threshold.
        meta: { role: "secondary-text", priority: "normal" },
        header: t("admin.recoveryQueue.columns.linked"),
        cell: ({ row }) =>
          t("admin.recoveryQueue.linkedCount", {
            count: row.original.linkedAttemptCount,
          }),
      },
      {
        id: "proctors",
        meta: { role: "secondary-text", priority: "low" },
        header: t("admin.recoveryQueue.columns.proctors"),
        cell: ({ row }) =>
          row.original.activeProctors.length > 0
            ? row.original.activeProctors.map((p) => p.displayName).join("、")
            : "—",
      },
      {
        id: "createdAt",
        meta: { role: "date" },
        header: t("admin.recoveryQueue.columns.createdAt"),
        cell: ({ row }) => formatTime(row.original.incident.createdAt),
      },
    ],
    [t, formatTime],
  );

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
        title={t("admin.recoveryQueue.title")}
        description={t("admin.recoveryQueue.description")}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={isRefreshing}
            aria-label={t("admin.recoveryQueue.refresh")}
          >
            <AppIcon
              icon={RefreshCw}
              size="inline"
              className={isRefreshing ? "animate-spin" : undefined}
            />
            {isRefreshing
              ? t("admin.recoveryQueue.refreshing")
              : t("admin.recoveryQueue.refresh")}
          </Button>
        }
      />

      {snapshotAt && (
        <span className="flex items-center gap-3 type-metadata">
          <span className={isStale ? "text-warning" : undefined}>
            {isStale && <AppIcon icon={CircleAlert} size="inline" />}
            {t("admin.recoveryQueue.snapshotAt", {
              time: formatTime(snapshotAt),
            })}
          </span>
          {isStale && (
            <span className="text-warning">
              {t("admin.recoveryQueue.snapshotStale")}
            </span>
          )}
          {lastUpdatedAt && (
            <span>
              {t("admin.recoveryQueue.lastUpdatedAt", {
                time: formatTime(lastUpdatedAt),
              })}
            </span>
          )}
        </span>
      )}

      <DataTableShell
        archetype="log-diagnostic"
        toolbar={
          <DataToolbar>
            <Select
              value={filters.status || "all"}
              onValueChange={(v) =>
                commitFilter({ status: v === "all" ? "" : v })
              }
            >
              <ToolbarFilter size="narrow">
                <SelectTrigger
                  aria-label={t("admin.recoveryQueue.filters.statusAll")}
                >
                  <SelectValue />
                </SelectTrigger>
              </ToolbarFilter>
              <SelectContent>
                <SelectItem value="all">
                  {t("admin.recoveryQueue.filters.statusAll")}
                </SelectItem>
                {INCIDENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`admin.recoveryQueue.status.${s}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.severity || "all"}
              onValueChange={(v) =>
                commitFilter({ severity: v === "all" ? "" : v })
              }
            >
              <ToolbarFilter size="narrow">
                <SelectTrigger
                  aria-label={t("admin.recoveryQueue.filters.severityAll")}
                >
                  <SelectValue />
                </SelectTrigger>
              </ToolbarFilter>
              <SelectContent>
                <SelectItem value="all">
                  {t("admin.recoveryQueue.filters.severityAll")}
                </SelectItem>
                {INCIDENT_SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`admin.recoveryQueue.severity.${s}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToolbarFilter size="wide">
              <TextFilterInput
                aria-label={t("admin.recoveryQueue.filters.examPlaceholder")}
                placeholder={t("admin.recoveryQueue.filters.examPlaceholder")}
                value={examIdDraft}
                onChange={setExamIdDraft}
                onCommit={(examId) => commitFilter({ examId })}
              />
            </ToolbarFilter>
            <ToolbarFilter size="wide">
              <TextFilterInput
                aria-label={t(
                  "admin.recoveryQueue.filters.candidatePlaceholder",
                )}
                placeholder={t(
                  "admin.recoveryQueue.filters.candidatePlaceholder",
                )}
                value={candidateIdDraft}
                onChange={setCandidateIdDraft}
                onCommit={(candidateId) => commitFilter({ candidateId })}
              />
            </ToolbarFilter>
            <DatePicker
              aria-label={t("admin.recoveryQueue.filters.startDate")}
              placeholder={t("admin.recoveryQueue.filters.startDate")}
              value={fromDate}
              onChange={(d) =>
                commitFilter({
                  createdFrom: d ? startOfDayISO(d) : "",
                  createdTo: d && toDate && toDate < d ? "" : filters.createdTo,
                })
              }
            />
            <DatePicker
              aria-label={t("admin.recoveryQueue.filters.endDate")}
              placeholder={t("admin.recoveryQueue.filters.endDate")}
              value={toDate}
              onChange={(d) =>
                commitFilter({
                  createdTo: d ? endOfDayISO(d) : "",
                  createdFrom:
                    d && fromDate && fromDate > d ? "" : filters.createdFrom,
                })
              }
            />
            {hasActiveFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-muted-foreground"
              >
                <AppIcon icon={X} size="inline" className="mr-1" />
                {t("admin.recoveryQueue.filters.clear")}
              </Button>
            )}
          </DataToolbar>
        }
        mobile={<MobileRecordList columns={columns} rows={items} />}
        footer={
          nextCursor ? (
            <DataViewFooter
              navigation={
                <Button
                  variant="outline"
                  onClick={loadMore}
                  disabled={isLoadingMore || isRefreshing}
                >
                  {isLoadingMore
                    ? t("admin.recoveryQueue.loadingMore")
                    : t("admin.recoveryQueue.loadMore")}
                </Button>
              }
            />
          ) : undefined
        }
      >
        <DesktopDataTable
          columns={columns}
          data={items}
          empty={items.length === 0}
          emptyTitle={t("admin.recoveryQueue.empty")}
          emptyDescription={t("admin.recoveryQueue.emptyDescription")}
        />
      </DataTableShell>

      {/* Background-refresh failure: inline warning outside the items branch
          so an empty queue + poll failure keeps the empty table + warning (P1-3). */}
      {error && snapshotAt !== null && (
        <InlineErrorBanner>
          {t(recoveryErrorMessageKey(error.kind, NAMESPACE) as never)}
        </InlineErrorBanner>
      )}
    </PageContainer>
  );
}
