import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api } from "@/lib/api";
import {
  incidentStatusKey,
  type RecoveryQueueItem,
  type RecoveryQueueResponse,
} from "@/lib/recovery";
import { routes } from "@/lib/routes";
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
 * refresh-safe); the keyset cursor lives in component state (a cursor in the
 * URL would leak a server pagination secret and break on stale pages).
 *
 * Polling semantics (per plan):
 *   - 30s interval while the tab is visible; ticks are skipped while a
 *     request is in flight (single-flight — no overlapping requests);
 *   - interval pauses automatically when the tab is hidden (setInterval keeps
 *     firing but the visibility gate drops ticks);
 *   - re-visibility / window focus triggers an immediate refresh;
 *   - every page-1 fetch (poll, focus, filter change) REPLACES the
 *     accumulated items and resets the cursor chain — a poll never merges
 *     into an old cursor chain. A request sequence counter discards stale
 *     responses so an older in-flight fetch can never overwrite a newer one.
 */
export function RecoveryQueuePage() {
  const { t } = useTranslation();
  const { formatTime } = useProductDateTime();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<RecoveryQueueItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const buildQuery = useCallback(
    (cursor: string | null): string => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.severity) params.set("severity", filters.severity);
      if (filters.examId) params.set("examId", filters.examId);
      if (filters.candidateId) params.set("candidateId", filters.candidateId);
      if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
      if (filters.createdTo) params.set("createdTo", filters.createdTo);
      if (cursor) params.set("cursor", cursor);
      return params.toString();
    },
    [filters],
  );

  // Single-flight: `activeSeq` owns the in-flight slot; only the latest
  // request may commit (stale responses are discarded by sequence).
  const requestSeqRef = useRef(0);
  const activeSeqRef = useRef<number | null>(null);

  /** Fetches page 1, replacing accumulated items and resetting the cursor chain. */
  const fetchPage1 = useCallback(
    async (mode: "user" | "poll") => {
      const seq = ++requestSeqRef.current;
      if (mode === "poll" && activeSeqRef.current !== null) {
        // Single-flight: drop the poll tick while another request runs.
        return;
      }
      activeSeqRef.current = seq;
      if (mode === "user") setInitialLoading(true);
      setError(null);
      try {
        const result = await api.get<RecoveryQueueResponse>(
          `/api/admin/recovery/incidents?${buildQuery(null)}`,
        );
        if (seq !== requestSeqRef.current) return; // stale response
        setItems(result.items);
        setNextCursor(result.nextCursor);
      } catch {
        if (seq === requestSeqRef.current) {
          setError(t("admin.recoveryQueue.loadFailed"));
        }
      } finally {
        if (activeSeqRef.current === seq) activeSeqRef.current = null;
        if (seq === requestSeqRef.current) setInitialLoading(false);
      }
    },
    [buildQuery, t],
  );

  /** Appends the next cursor page to the accumulated list. */
  const loadMore = useCallback(async () => {
    if (!nextCursor || activeSeqRef.current !== null) return;
    const seq = ++requestSeqRef.current;
    activeSeqRef.current = seq;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await api.get<RecoveryQueueResponse>(
        `/api/admin/recovery/incidents?${buildQuery(nextCursor)}`,
      );
      if (seq !== requestSeqRef.current) return; // superseded by a refresh
      setItems((prev) => [...prev, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch {
      if (seq === requestSeqRef.current) {
        setError(t("admin.recoveryQueue.loadFailed"));
      }
    } finally {
      if (activeSeqRef.current === seq) activeSeqRef.current = null;
      setLoadingMore(false);
    }
  }, [nextCursor, buildQuery, t]);

  // Initial load + polling. The effect is keyed on `fetchPage1`, so any
  // filter change tears down the old interval and re-runs: page-1 fetch +
  // a fresh interval. Poll ticks only fire while the tab is visible; focus
  // and re-visibility trigger an immediate (poll-mode) refresh.
  useEffect(() => {
    void fetchPage1("user");
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void fetchPage1("poll");
    }, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void fetchPage1("poll");
    };
    const onFocus = () => void fetchPage1("poll");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchPage1]);

  /** Applies a filter patch to the URL (and only the URL — cursor state resets). */
  function applyFilter(patch: Partial<QueueFilters>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next);
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams());
  }

  const fromDate = filters.createdFrom
    ? new Date(filters.createdFrom)
    : undefined;
  const toDate = filters.createdTo ? new Date(filters.createdTo) : undefined;

  if (initialLoading && items.length === 0) return <LoadingState />;
  if (error && items.length === 0) {
    return (
      <ErrorState message={error} onRetry={() => void fetchPage1("user")} />
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
          onValueChange={(v) => applyFilter({ status: v === "all" ? "" : v })}
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
          onValueChange={(v) => applyFilter({ severity: v === "all" ? "" : v })}
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
          placeholder={t("admin.recoveryQueue.filters.examPlaceholder")}
          value={filters.examId}
          onChange={(e) => applyFilter({ examId: e.target.value })}
        />
        <input
          type="text"
          className="h-9 w-[180px] rounded-md border border-input bg-transparent px-3 text-sm"
          placeholder={t("admin.recoveryQueue.filters.candidatePlaceholder")}
          value={filters.candidateId}
          onChange={(e) => applyFilter({ candidateId: e.target.value })}
        />
        <DatePicker
          aria-label={t("admin.recoveryQueue.filters.startDate")}
          placeholder={t("admin.recoveryQueue.filters.startDate")}
          value={fromDate}
          onChange={(d) =>
            applyFilter({
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
            applyFilter({
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
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AppIcon icon={RefreshCw} size="inline" />
                {t("admin.recoveryQueue.polling")}
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
                    <TableRow
                      key={item.incident.id}
                      className="cursor-pointer"
                      onClick={() =>
                        navigate(
                          routes.admin.recoveryIncident(item.incident.id),
                        )
                      }
                    >
                      <TableCell>
                        <StatusBadge
                          status={incidentStatusKey(item.incident.status)}
                        />
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
                  <button
                    type="button"
                    className="flex w-full flex-col gap-2 rounded-md border p-3 text-left"
                    onClick={() =>
                      navigate(routes.admin.recoveryIncident(item.incident.id))
                    }
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
                  </button>
                </li>
              ))}
            </ul>
          </DataTableShell>

          {error && (
            <ErrorState
              message={error}
              onRetry={() => void fetchPage1("user")}
            />
          )}

          {nextCursor && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore
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
