import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { DataTablePagination } from "@/components/shared/DataTablePagination";
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
import { ScrollText, X } from "lucide-react";

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

interface AuditLogResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const ACTION_FILTER_KEYS = [
  "all",
  "exam.create",
  "exam.update",
  "exam.publish",
  "exam.open",
  "exam.close",
  "exam.closed",
  "exam.unpublish",
  "exam.extend",
  "exam.cancel",
  "exam.archive",
  "exam.publish_results",
  "exam.delete",
  "attempt.start",
  "attempt.restore",
  "attempt.saveAnswer",
  "attempt.submit",
  "attempt.autoSubmit",
  "attempt.disrupted",
  "attempt.misconductFlagged",
  "attempt.forceSubmit",
  "attempt.extendTime",
  "attempt.exported",
  "grading.score_entered",
  "grading.finalized",
  "candidate.create",
  "candidate.update",
  "candidate.import",
  "candidate.password_reset",
  "candidate_field.create",
  "candidate_field.update",
  "candidate_field.delete",
  "question.create",
  "question.update",
  "question.delete",
  "question.import",
  "course.create",
  "course.update",
  "course.delete",
  "enrollment.add",
  "enrollment.remove",
  "user.create",
  "user.update",
  "user.delete",
  "login.success",
  "login.failure",
  "logout",
  "export_scores",
  "branding.update",
  "admin.bootstrap",
  "admin.password_reset.local",
] as const;

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

export function AuditLogPage() {
  const { t } = useTranslation();
  const { formatDateTime } = useProductDateTime();
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pageSize = 20;

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
      setPage(1);
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
    setPage(1);
  }, []);

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (actionFilter !== "all") params.set("action", actionFilter);
      if (targetFilter !== "all") params.set("targetType", targetFilter);
      // Date bounds: inclusive on the server. `from` is the start-of-day of the
      // picked date; `to` is pushed to end-of-day so the same day is included.
      if (fromDate) params.set("from", startOfDayISO(fromDate));
      if (toDate) params.set("to", endOfDayISO(toDate));
      const result = await api.get<AuditLogResponse>(
        `/api/admin/audit-logs?${params}`,
      );
      setData(result);
    } catch {
      setError(t("admin.audit.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [page, actionFilter, targetFilter, fromDate, toDate]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const items = data?.items ?? [];

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadLogs} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.audit.title")}
        description={t("admin.audit.description")}
      />
      <DataToolbar>
        <Select
          value={actionFilter}
          onValueChange={(v) => {
            setActionFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger
            className="w-[180px]"
            aria-label={t("admin.audit.filterActions.all")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_FILTER_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {t(`admin.audit.filterActions.${key}` as any)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={targetFilter}
          onValueChange={(v) => {
            setTargetFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger
            className="w-[150px]"
            aria-label={t("admin.audit.filterTargets.all")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TARGET_FILTER_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {t(`admin.audit.filterTargets.${key}` as any)}
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
                  { role: "secondary-text" },
                  { role: "type", key: "action" },
                  { role: "type", key: "target" },
                  { role: "short-id" },
                ]}
              />
              <TableHeader>
                <TableRow>
                  <DataTableHead role="date">
                    {t("admin.audit.columns.time")}
                  </DataTableHead>
                  <DataTableHead role="secondary-text">
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
                      role="secondary-text"
                      className="text-foreground"
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
          {data && (
            <DataTablePagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}
