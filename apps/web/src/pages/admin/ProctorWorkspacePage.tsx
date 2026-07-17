import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type {
  ProctorExamListItem,
  ProctorExamListResponse,
  ProctorExamStatus,
} from "@exam/contracts";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { AppIcon } from "@/components/shared/AppIcon";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { DataToolbar } from "@/components/shared/DataToolbar";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { PageHeader } from "@/components/shared/PageHeader";
import { RowActions } from "@/components/shared/RowActions";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { Monitor } from "lucide-react";

type StatusFilter = "all" | ProctorExamStatus;

const STATUS_FILTERS: readonly StatusFilter[] = [
  "all",
  "published",
  "open",
  "closed",
];

export function ProctorWorkspacePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { formatDateTime } = useProductDateTime();
  const [data, setData] = useState<ProctorExamListResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadExams = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(
        await api.get<ProctorExamListResponse>("/api/admin/proctor/exams"),
      );
    } catch {
      setError(t("admin.proctorWorkspace.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadExams();
  }, [loadExams]);

  const visibleExams = useMemo(() => {
    const items = data?.items ?? [];
    return statusFilter === "all"
      ? items
      : items.filter((exam) => exam.status === statusFilter);
  }, [data?.items, statusFilter]);

  const enterMonitoring = (exam: ProctorExamListItem) => {
    void navigate(routes.admin.examProctorMonitor(exam.examId));
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.proctorWorkspace.title")}
        description={t("admin.proctorWorkspace.description")}
      />
      <DataToolbar>
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
        >
          <SelectTrigger
            className="w-[180px]"
            aria-label={t("admin.proctorWorkspace.statusFilter")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((status) => (
              <SelectItem key={status} value={status}>
                {t(
                  `admin.proctorWorkspace.statusFilters.${status}` as "admin.proctorWorkspace.statusFilters.all",
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </DataToolbar>
      <DataTableShell title={t("admin.proctorWorkspace.tableTitle")}>
        {isLoading ? (
          <LoadingState label={t("admin.proctorWorkspace.loading")} />
        ) : error ? (
          <ErrorState message={error} onRetry={loadExams} />
        ) : visibleExams.length === 0 ? (
          <EmptyState
            icon={<AppIcon icon={Monitor} size="state" />}
            title={t(
              statusFilter === "all"
                ? "admin.proctorWorkspace.empty.title"
                : "admin.proctorWorkspace.empty.filteredTitle",
            )}
            description={t(
              statusFilter === "all"
                ? "admin.proctorWorkspace.empty.description"
                : "admin.proctorWorkspace.empty.filteredDescription",
            )}
          />
        ) : (
          <Table>
            <DataTableColumns
              columns={[
                { role: "primary-text" },
                { role: "status" },
                { role: "date", key: "open" },
                { role: "date", key: "close" },
                { role: "actions" },
              ]}
            />
            <TableHeader>
              <TableRow>
                <DataTableHead role="primary-text">
                  {t("admin.proctorWorkspace.columns.title")}
                </DataTableHead>
                <DataTableHead role="status">
                  {t("admin.proctorWorkspace.columns.status")}
                </DataTableHead>
                <DataTableHead role="date">
                  {t("admin.proctorWorkspace.columns.openAt")}
                </DataTableHead>
                <DataTableHead role="date">
                  {t("admin.proctorWorkspace.columns.closeAt")}
                </DataTableHead>
                <DataTableHead role="actions">
                  {t("admin.proctorWorkspace.columns.actions")}
                </DataTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleExams.map((exam) => (
                <TableRow key={exam.examId}>
                  <DataTableCell role="primary-text">
                    {exam.title}
                  </DataTableCell>
                  <DataTableCell role="status">
                    <StatusBadge status={exam.status} />
                  </DataTableCell>
                  <DataTableCell role="date">
                    {formatDateTime(exam.openAt)}
                  </DataTableCell>
                  <DataTableCell role="date">
                    {formatDateTime(exam.closeAt)}
                  </DataTableCell>
                  <DataTableCell role="actions">
                    <RowActions>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => enterMonitoring(exam)}
                      >
                        {t("admin.proctorWorkspace.actions.enter")}
                      </Button>
                    </RowActions>
                  </DataTableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTableShell>
    </div>
  );
}
