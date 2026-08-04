import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api } from "@/lib/api";
import type { RecoveryQueueResponse } from "@exam/contracts";
import { incidentStatusKey } from "@/lib/recovery";
import { recoveryErrorMessageKey } from "@/lib/recoveryErrors";
import { routes } from "@/lib/routes";
import { useRecoveryQueueProjection } from "@/hooks/useRecoveryQueueProjection";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { DataToolbar } from "@/components/shared/DataToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DatePicker } from "@/components/shared/DatePicker";
import { AppIcon } from "@/components/shared/AppIcon";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LifeBuoy, RefreshCw, X } from "lucide-react";

/** Visible-tab polling interval (J5-I1B1 polling semantics). */
const POLL_INTERVAL_MS = 30_000;
/** Free-text filter debounce: commits to the URL after typing settles. */
const FILTER_DEBOUNCE_MS = 400;
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
    backoff: BACKOFF,
    deps: [queryKey],
  });

  // Free-text filter draft + debounce. Local state keeps the input responsive;
  // the debounced commit writes the URL with `replace:true` so typing does not
  // push per-keystroke history entries (Back wouldn't step through each char).
  const [examIdDraft, setExamIdDraft] = useState(filters.examId);
  const [candidateIdDraft, setCandidateIdDraft] = useState(filters.candidateId);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync drafts when the URL changes externally (back/forward, link share).
  useEffect(() => {
    setExamIdDraft(filters.examId);
    setCandidateIdDraft(filters.candidateId);
  }, [filters.examId, filters.candidateId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  /** Commits a filter patch to the URL with replace semantics. */
  function commitFilter(patch: Partial<QueueFilters>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  /** Debounced commit for free-text inputs (cancels any pending timer). */
  function scheduleDebouncedCommit(patch: Partial<QueueFilters>) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      commitFilter(patch);
      debounceRef.current = null;
    }, FILTER_DEBOUNCE_MS);
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  const fromDate = filters.createdFrom
    ? new Date(filters.createdFrom)
    : undefined;
  const toDate = filters.createdTo ? new Date(filters.createdTo) : undefined;

  if (isInitialLoading) return <LoadingState />;
  if (error && items.length === 0) {
    return (
      <ErrorState
        message={t(recoveryErrorMessageKey(error.kind, NAMESPACE) as never)}
        onRetry={refresh}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.recoveryQueue.title")}
        description={t("admin.recoveryQueue.description")}
      />
      <DataToolbar>
        <Select
          value={filters.status || "all"}
          onValueChange={(v) => commitFilter({ status: v === "all" ? "" : v })}
        >
          <SelectTrigger
            className="w-[150px]"
            aria-label={t("admin.recoveryQueue.filters.statusAll")}
          >
            <SelectValue />
          </SelectTrigger>
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
          <SelectTrigger
            className="w-[150px]"
            aria-label={t("admin.recoveryQueue.filters.severityAll")}
          >
            <SelectValue />
          </SelectTrigger>
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
        <input
          type="text"
          className="h-9 w-[180px] rounded-md border border-input bg-transparent px-3 text-sm"
          aria-label={t("admin.recoveryQueue.filters.examPlaceholder")}
          placeholder={t("admin.recoveryQueue.filters.examPlaceholder")}
          value={examIdDraft}
          onChange={(e) => {
            setExamIdDraft(e.target.value);
            scheduleDebouncedCommit({ examId: e.target.value });
          }}
          onBlur={() => {
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
              debounceRef.current = null;
              commitFilter({ examId: examIdDraft });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && debounceRef.current) {
              clearTimeout(debounceRef.current);
              debounceRef.current = null;
              commitFilter({ examId: examIdDraft });
            }
          }}
        />
        <input
          type="text"
          className="h-9 w-[180px] rounded-md border border-input bg-transparent px-3 text-sm"
          aria-label={t("admin.recoveryQueue.filters.candidatePlaceholder")}
          placeholder={t("admin.recoveryQueue.filters.candidatePlaceholder")}
          value={candidateIdDraft}
          onChange={(e) => {
            setCandidateIdDraft(e.target.value);
            scheduleDebouncedCommit({ candidateId: e.target.value });
          }}
          onBlur={() => {
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
              debounceRef.current = null;
              commitFilter({ candidateId: candidateIdDraft });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && debounceRef.current) {
              clearTimeout(debounceRef.current);
              debounceRef.current = null;
              commitFilter({ candidateId: candidateIdDraft });
            }
          }}
        />
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

      {items.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={LifeBuoy} size="state" />}
          title={t("admin.recoveryQueue.empty")}
          description={t("admin.recoveryQueue.emptyDescription")}
        />
      ) : (
        <>
          <DataTableShell
            title={t("admin.recoveryQueue.title")}
            toolbar={
              <span className="flex items-center gap-3 text-xs text-muted-foreground">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={refresh}
                  disabled={isRefreshing}
                  className="h-7 gap-1 px-2 text-xs"
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
                {snapshotAt && (
                  <span>
                    {t("admin.recoveryQueue.snapshotAt", {
                      time: formatTime(snapshotAt),
                    })}
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
            }
          >
            {/* Desktop table */}
            <div className="hidden md:block" data-testid="recovery-queue-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("admin.recoveryQueue.columns.incident")}
                    </TableHead>
                    <TableHead>
                      {t("admin.recoveryQueue.columns.severity")}
                    </TableHead>
                    <TableHead>
                      {t("admin.recoveryQueue.columns.exam")}
                    </TableHead>
                    <TableHead>
                      {t("admin.recoveryQueue.columns.candidate")}
                    </TableHead>
                    <TableHead>
                      {t("admin.recoveryQueue.columns.attempt")}
                    </TableHead>
                    <TableHead>
                      {t("admin.recoveryQueue.columns.linked")}
                    </TableHead>
                    <TableHead>
                      {t("admin.recoveryQueue.columns.proctors")}
                    </TableHead>
                    <TableHead>
                      {t("admin.recoveryQueue.columns.createdAt")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.incident.id}>
                      <TableCell>
                        <Link
                          to={routes.admin.recoveryIncident(item.incident.id)}
                          className="text-sm font-medium underline-offset-4 hover:underline"
                        >
                          <StatusBadge
                            status={incidentStatusKey(item.incident.status)}
                          />
                        </Link>
                      </TableCell>
                      <TableCell>
                        {t(
                          `admin.recoveryQueue.severity.${item.incident.severity}` as never,
                        )}
                      </TableCell>
                      <TableCell>{item.examSummary.title}</TableCell>
                      <TableCell>
                        {item.primaryCandidate?.displayName ??
                          t("admin.recoveryQueue.noCandidate")}
                      </TableCell>
                      <TableCell>
                        {item.primaryAttempt ? (
                          <StatusBadge status={item.primaryAttempt.status} />
                        ) : (
                          t("admin.recoveryQueue.noAttempt")
                        )}
                      </TableCell>
                      <TableCell>
                        {t("admin.recoveryQueue.linkedCount", {
                          count: item.linkedAttemptCount,
                        })}
                      </TableCell>
                      <TableCell>
                        {item.activeProctors.length > 0
                          ? item.activeProctors
                              .map((p) => p.displayName)
                              .join("、")
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {formatTime(item.incident.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile card list */}
            <ul
              className="flex flex-col gap-3 md:hidden"
              data-testid="recovery-queue-cards"
            >
              {items.map((item) => (
                <li key={item.incident.id}>
                  <Link
                    to={routes.admin.recoveryIncident(item.incident.id)}
                    className="flex w-full flex-col gap-2 rounded-md border p-3 text-left"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <StatusBadge
                        status={incidentStatusKey(item.incident.status)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {formatTime(item.incident.createdAt)}
                      </span>
                    </span>
                    <span className="text-sm font-medium">
                      {item.examSummary.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t(
                        ("admin.recoveryQueue.severity." +
                          item.incident.severity) as never,
                      )}
                      {" · "}
                      {item.primaryCandidate?.displayName ??
                        t("admin.recoveryQueue.noCandidate")}
                      {" · "}
                      {t("admin.recoveryQueue.linkedCount", {
                        count: item.linkedAttemptCount,
                      })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </DataTableShell>

          {error && (
            <ErrorState
              message={t(
                recoveryErrorMessageKey(error.kind, NAMESPACE) as never,
              )}
              onRetry={refresh}
            />
          )}

          {nextCursor && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore
                  ? t("admin.recoveryQueue.loadingMore")
                  : t("admin.recoveryQueue.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
