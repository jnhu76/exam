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
import { DataToolbar, ToolbarFilter } from "@/components/shared/DataToolbar";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/shared/PageContainer";
import { Upload, X } from "lucide-react";
import type { ImportJobLog, ImportLogListResponse } from "@exam/contracts";

type ImportLogResponse = ImportLogListResponse;

const TYPE_FILTERS = [
  { value: "all", labelKey: "admin.importLogs.typeFilters.all" },
  { value: "candidate", labelKey: "admin.importLogs.typeFilters.candidate" },
  { value: "question", labelKey: "admin.importLogs.typeFilters.question" },
];

const TYPE_LABELS: Record<string, string> = {
  candidate: "admin.importLogs.typeLabels.candidate",
  question: "admin.importLogs.typeLabels.question",
};

const STATUS_CONFIG: Record<
  string,
  { labelKey: string; variant: "default" | "secondary" | "destructive" }
> = {
  completed: {
    labelKey: "admin.importLogs.statusConfig.completed",
    variant: "default",
  },
  partial: {
    labelKey: "admin.importLogs.statusConfig.partial",
    variant: "secondary",
  },
  failed: {
    labelKey: "admin.importLogs.statusConfig.failed",
    variant: "destructive",
  },
};

export function ImportLogsPage() {
  const { t } = useTranslation();
  const { formatDateTime } = useProductDateTime();
  const [data, setData] = useState<ImportLogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pageSize = 20;

  const hasActiveFilter = typeFilter !== "all";

  const clearFilters = useCallback(() => {
    setTypeFilter("all");
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
      if (typeFilter !== "all") params.set("type", typeFilter);
      const result = await api.get<ImportLogResponse>(
        `/api/admin/import-logs?${params}`,
      );
      setData(result);
    } catch {
      setError(t("admin.importLogs.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [page, typeFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const items = data?.items ?? [];

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadLogs} />;
  if (!data || data.items.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t("admin.importLogs.title")}
          description={t("admin.importLogs.description")}
        />
        <EmptyState
          icon={<AppIcon icon={Upload} size="state" />}
          title={t("admin.importLogs.empty")}
          description={t("admin.importLogs.emptyDescription")}
        />
      </div>
    );
  }

  return (
    <PageContainer role="admin-standard" className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.importLogs.title")}
        description={t("admin.importLogs.description")}
      />
      <DataToolbar>
        <Select
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v);
            setPage(1);
          }}
        >
          <ToolbarFilter size="narrow">
            <SelectTrigger aria-label={t("admin.importLogs.typeFilter")}>
              <SelectValue />
            </SelectTrigger>
          </ToolbarFilter>
          <SelectContent>
            {TYPE_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {t(f.labelKey as "admin.importLogs.typeFilters.all")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActiveFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground"
          >
            <AppIcon icon={X} size="inline" className="mr-1" />
            {t("admin.importLogs.clearFilter")}
          </Button>
        )}
      </DataToolbar>
      <DataTableShell archetype="log-diagnostic">
        <Table>
          <DataTableColumns
            columns={[
              { role: "date" },
              { role: "type" },
              { role: "status" },
              { role: "number", key: "total" },
              { role: "number", key: "created" },
              { role: "number", key: "updated" },
              { role: "number", key: "errors" },
            ]}
          />
          <TableHeader>
            <TableRow>
              <DataTableHead role="date">
                {t("admin.importLogs.columns.time")}
              </DataTableHead>
              <DataTableHead role="type">
                {t("admin.importLogs.columns.type")}
              </DataTableHead>
              <DataTableHead role="status">
                {t("admin.importLogs.columns.status")}
              </DataTableHead>
              <DataTableHead role="number">
                {t("admin.importLogs.columns.total")}
              </DataTableHead>
              <DataTableHead role="number">
                {t("admin.importLogs.columns.created")}
              </DataTableHead>
              <DataTableHead role="number">
                {t("admin.importLogs.columns.updated")}
              </DataTableHead>
              <DataTableHead role="number">
                {t("admin.importLogs.columns.errors")}
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
                <DataTableCell role="date" className="type-secondary">
                  {formatDateTime(item.createdAt)}
                </DataTableCell>
                <DataTableCell role="type">
                  {t(
                    (TYPE_LABELS[item.type] ??
                      "admin.importLogs.typeFilters.all") as "admin.importLogs.typeLabels.candidate",
                  )}
                </DataTableCell>
                <DataTableCell role="status">
                  <Badge variant={STATUS_CONFIG[item.status]?.variant}>
                    {t(
                      (STATUS_CONFIG[item.status]?.labelKey ??
                        "admin.importLogs.statusConfig.completed") as "admin.importLogs.statusConfig.completed",
                    )}
                  </Badge>
                </DataTableCell>
                <DataTableCell role="number">{item.total}</DataTableCell>
                <DataTableCell role="number">{item.createdCount}</DataTableCell>
                <DataTableCell role="number">{item.updatedCount}</DataTableCell>
                <DataTableCell role="number">{item.errors}</DataTableCell>
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
              {item.errorsDetail && item.errorsDetail.length > 0 && (
                <>
                  <h3 className="mb-2 text-sm font-medium">
                    {t("admin.importLogs.details.errorDetail")}
                  </h3>
                  <pre className="type-code rounded bg-muted p-3">
                    {JSON.stringify(item.errorsDetail, null, 2)}
                  </pre>
                </>
              )}
              {Object.keys(item.metadata).length > 0 && (
                <>
                  <h3 className="mb-2 mt-3 text-sm font-medium">
                    {t("admin.importLogs.details.metadata")}
                  </h3>
                  <pre className="type-code rounded bg-muted p-3">
                    {JSON.stringify(item.metadata, null, 2)}
                  </pre>
                </>
              )}
            </div>
          );
        })()}
      <DataTablePagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        onPageChange={setPage}
      />
    </PageContainer>
  );
}
