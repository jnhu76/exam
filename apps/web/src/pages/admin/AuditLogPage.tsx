import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api, ApiError } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import type { AuditActionMetadataEntry } from "@exam/contracts";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { DataToolbar } from "@/components/shared/DataToolbar";
import { DatePicker } from "@/components/shared/DatePicker";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ScrollText,
  X,
} from "lucide-react";

interface AuditLogItem {
  id: string;
  organizationId: string;
  actorId: string;
  actorName?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

/** Keyset-paginated audit log page response. */
interface AuditLogPageData {
  items: AuditLogItem[];
  nextCursor: string | null;
  /** Frozen upper bound of the window these results were read from. */
  snapshotTo: string;
}

const PAGE_SIZE = 20;

const TARGET_FILTER_KEYS = [
  "all",
  "attempt",
  "exam",
  "user",
  "enrollment",
  "organization",
] as const;

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

/** Builds the shared filter query string for the current filters. */
function buildFilterQuery(filters: {
  action: string;
  target: string;
  from?: Date;
  to?: Date;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.action !== "all") params.set("action", filters.action);
  if (filters.target !== "all") params.set("targetType", filters.target);
  // Date bounds: inclusive on the server. `from` is the start-of-day of the
  // picked date; `to` is pushed to end-of-day so the same day is included.
  // The server freezes `to` into the snapshot on the first page.
  if (filters.from) params.set("from", startOfDayISO(filters.from));
  if (filters.to) params.set("to", endOfDayISO(filters.to));
  return params;
}

/** Builds the search query string: shared filters + keyset page params. */
function buildSearchQuery(
  filters: Parameters<typeof buildFilterQuery>[0],
  cursor?: string,
): string {
  const params = buildFilterQuery(filters);
  params.set("limit", String(PAGE_SIZE));
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

/**
 * Audit log search + export.
 *
 * The action dropdown is rendered from the BACKEND action vocabulary
 * (`GET /admin/audit-log/actions`) — the web never owns "which actions exist",
 * so a newly shipped action appears automatically. Pagination is a bounded
 * keyset cursor (`nextCursor` is opaque); the page tracks the cursor path so
 * prev/next never skip or repeat rows. Search pages and export are
 * projections of ONE audit window: the server freezes the window's upper
 * bound into `snapshotTo` (and every cursor), and the export echoes that
 * `snapshotTo` so the CSV matches what the admin is looking at — rows
 * written after the list loaded never leak into it. A hard row cap is
 * enforced by the API (no client `limit` on export).
 */
export function AuditLogPage() {
  const { t } = useTranslation();
  const { formatDateTime } = useProductDateTime();

  const [data, setData] = useState<AuditLogPageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Backend-driven action vocabulary.
  const [actionOptions, setActionOptions] = useState<
    AuditActionMetadataEntry[]
  >([]);

  const [actionFilter, setActionFilter] = useState("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);

  // Keyset cursor path: `currentCursor` fetched the current page (null = the
  // first page); `pastCursors` is the stack of cursors used to get here, with
  // null entries marking the first page (so prev can return to it).
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [pastCursors, setPastCursors] = useState<(string | null)[]>([]);

  const [exporting, setExporting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ actions: AuditActionMetadataEntry[] }>(
        "/api/admin/audit-log/actions",
      )
      .then((result) => {
        if (!cancelled) setActionOptions(result.actions);
      })
      .catch(() => {
        // The vocabulary endpoint is best-effort for rendering: the log list
        // still loads; the action filter degrades to "all actions".
        if (!cancelled) setActionOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadLogs = useCallback(
    async (cursor?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.get<AuditLogPageData>(
          `/api/admin/audit-logs?${buildSearchQuery(
            {
              action: actionFilter,
              target: targetFilter,
              from: fromDate,
              to: toDate,
            },
            cursor,
          )}`,
        );
        setData(result);
      } catch {
        setError(t("admin.audit.loadFailed"));
      } finally {
        setIsLoading(false);
      }
    },
    [actionFilter, targetFilter, fromDate, toDate, t],
  );

  // Initial load + whenever filters change (resets to the first page).
  useEffect(() => {
    setCurrentCursor(null);
    setPastCursors([]);
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadLogs]);

  const handleDateChange = useCallback(
    (newDate: Date | undefined, isStartDate: boolean) => {
      if (isStartDate && newDate && toDate && newDate > toDate) {
        setFromDate(toDate);
        setToDate(newDate);
      } else if (!isStartDate && newDate && fromDate && newDate < fromDate) {
        setToDate(fromDate);
        setFromDate(newDate);
      } else if (isStartDate) {
        setFromDate(newDate);
      } else {
        setToDate(newDate);
      }
    },
    [fromDate, toDate],
  );

  const hasActiveFilter =
    actionFilter !== "all" ||
    targetFilter !== "all" ||
    fromDate !== undefined ||
    toDate !== undefined;

  const clearFilters = useCallback(() => {
    setActionFilter("all");
    setTargetFilter("all");
    setFromDate(undefined);
    setToDate(undefined);
  }, []);

  const goNext = useCallback(() => {
    if (!data?.nextCursor) return;
    // Remember how to get back to the current page (null = the first page).
    setPastCursors((stack) => [...stack, currentCursor]);
    setCurrentCursor(data.nextCursor);
    setExpandedId(null);
    loadLogs(data.nextCursor);
  }, [data, currentCursor, loadLogs]);

  const goPrev = useCallback(() => {
    if (pastCursors.length === 0) return;
    const prev = pastCursors[pastCursors.length - 1] ?? null;
    setPastCursors((stack) => stack.slice(0, -1));
    setCurrentCursor(prev);
    setExpandedId(null);
    loadLogs(prev ?? undefined);
  }, [pastCursors, loadLogs]);

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Echo the snapshot bound of the result set the admin is viewing so
      // the CSV is the same window; before the first successful load there
      // is no window yet and the server opens a fresh one.
      const params = buildFilterQuery({
        action: actionFilter,
        target: targetFilter,
        from: fromDate,
        to: toDate,
      });
      if (data?.snapshotTo) params.set("snapshotTo", data.snapshotTo);
      await downloadFile(
        `/api/admin/audit-logs/export?${params.toString()}`,
        `audit-logs-${Date.now()}.csv`,
      );
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : t("admin.audit.exportFailed");
      toast.error(message);
    } finally {
      setExporting(false);
    }
  }, [exporting, data, actionFilter, targetFilter, fromDate, toDate, t]);

  const items = data?.items ?? [];
  const hasPrev = pastCursors.length > 0;
  const hasNext = data?.nextCursor != null;

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => loadLogs()} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.audit.title")}
        description={t("admin.audit.description")}
      />
      <DataToolbar>
        <Select value={actionFilter} onValueChange={(v) => setActionFilter(v)}>
          <SelectTrigger
            className="w-[220px]"
            aria-label={t("admin.audit.filterActions.all")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem key="all" value="all">
              {t("admin.audit.filterActions.all")}
            </SelectItem>
            {actionOptions.map(({ action }) => (
              <SelectItem key={action} value={action}>
                {t(`admin.audit.filterActions.${action}` as never, action)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={targetFilter} onValueChange={(v) => setTargetFilter(v)}>
          <SelectTrigger
            className="w-[150px]"
            aria-label={t("admin.audit.filterTargets.all")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TARGET_FILTER_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {t(`admin.audit.filterTargets.${key}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DatePicker
          aria-label={t("admin.audit.startDate")}
          placeholder={t("admin.audit.startDate")}
          value={fromDate}
          onChange={(d) => handleDateChange(d, true)}
        />
        <DatePicker
          aria-label={t("admin.audit.endDate")}
          placeholder={t("admin.audit.endDate")}
          value={toDate}
          onChange={(d) => handleDateChange(d, false)}
        />
        {hasActiveFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground"
          >
            <AppIcon icon={X} size="inline" className="mr-1" />
            {t("admin.audit.clearFilter")}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting}
          className="ml-auto"
        >
          <AppIcon icon={Download} size="inline" className="mr-1" />
          {exporting ? t("admin.audit.exporting") : t("admin.audit.export")}
        </Button>
      </DataToolbar>
      {items.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={ScrollText} size="state" />}
          title={t("admin.audit.empty")}
          description={t("admin.audit.emptyDescription")}
        />
      ) : (
        <>
          <DataTableShell>
            <Table>
              <DataTableColumns
                columns={[
                  { role: "date" },
                  { role: "short-id", key: "actor" },
                  { role: "type", key: "action" },
                  { role: "type", key: "target" },
                  { role: "short-id", key: "detail" },
                ]}
              />
              <TableHeader>
                <TableRow>
                  <DataTableHead role="date">
                    {t("admin.audit.columns.time")}
                  </DataTableHead>
                  <DataTableHead role="short-id">
                    {t("admin.audit.columns.actor")}
                  </DataTableHead>
                  <DataTableHead role="type">
                    {t("admin.audit.columns.action")}
                  </DataTableHead>
                  <DataTableHead role="type">
                    {t("admin.audit.columns.target")}
                  </DataTableHead>
                  <DataTableHead role="short-id">
                    {t("admin.audit.columns.detail")}
                  </DataTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() =>
                      setExpandedId(expandedId === item.id ? null : item.id)
                    }
                  >
                    <DataTableCell
                      role="date"
                      className="text-sm text-muted-foreground"
                    >
                      {formatDateTime(item.createdAt)}
                    </DataTableCell>
                    <DataTableCell
                      role="short-id"
                      className="truncate text-foreground"
                    >
                      {item.actorName ?? item.actorId}
                    </DataTableCell>
                    <DataTableCell role="type">
                      <span className="inline-flex items-center rounded-md bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-soft-foreground">
                        {item.action}
                      </span>
                    </DataTableCell>
                    <DataTableCell role="type">{item.targetType}</DataTableCell>
                    <DataTableCell
                      role="short-id"
                      className="truncate text-sm text-muted-foreground"
                    >
                      {item.targetId}
                    </DataTableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableShell>
          {expandedId &&
            (() => {
              const item = items.find((i) => i.id === expandedId);
              if (!item) return null;
              return (
                <div className="rounded-md border p-4">
                  <h3 className="mb-2 text-sm font-medium">
                    {t("admin.audit.columns.detail")}
                  </h3>
                  <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify(item.metadata, null, 2)}
                  </pre>
                  {item.ipAddress && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("admin.audit.ipAddress", { address: item.ipAddress })}
                    </p>
                  )}
                </div>
              );
            })()}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("admin.audit.pageInfo", { count: items.length })}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPrev}
                onClick={goPrev}
              >
                <AppIcon icon={ChevronLeft} size="inline" className="mr-1" />
                {t("common.table.prev")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={goNext}
              >
                {t("common.table.next")}
                <AppIcon icon={ChevronRight} size="inline" className="ml-1" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
