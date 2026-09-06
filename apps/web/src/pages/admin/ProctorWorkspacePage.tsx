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
  DesktopDataTable,
  type DataViewColumnDef,
} from "@/components/shared/DesktopDataTable";
import { MobileRecordList } from "@/components/shared/MobileRecordList";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { DataToolbar, ToolbarFilter } from "@/components/shared/DataToolbar";
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
import { Monitor, MonitorPlay } from "lucide-react";

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

  // Single-source column declarations (issue 457): desktop table and mobile
  // cards render from the same array.
  const columns: DataViewColumnDef<ProctorExamListItem>[] = [
    {
      id: "title",
      meta: { role: "primary-text" },
      header: t("admin.proctorWorkspace.columns.title"),
      cell: ({ row }) => row.original.title,
    },
    {
      id: "status",
      meta: { role: "status" },
      header: t("admin.proctorWorkspace.columns.status"),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "open",
      meta: { role: "date" },
      header: t("admin.proctorWorkspace.columns.openAt"),
      cell: ({ row }) => formatDateTime(row.original.openAt),
    },
    {
      id: "close",
      meta: { role: "date" },
      header: t("admin.proctorWorkspace.columns.closeAt"),
      cell: ({ row }) =>
        row.original.closeAt === null
          ? "—"
          : formatDateTime(row.original.closeAt),
    },
    {
      id: "actions",
      meta: { role: "actions" },
      header: t("admin.proctorWorkspace.columns.actions"),
      cell: ({ row }) => (
        <RowActions
          row={row.original}
          actions={[
            {
              id: "enter-monitoring",
              label: t("admin.proctorWorkspace.actions.enter"),
              icon: MonitorPlay,
              onSelect: () => enterMonitoring(row.original),
            },
          ]}
        />
      ),
    },
  ];

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
          <ToolbarFilter size="narrow">
            <SelectTrigger
              aria-label={t("admin.proctorWorkspace.statusFilter")}
            >
              <SelectValue />
            </SelectTrigger>
          </ToolbarFilter>
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
      <DataTableShell
        title={t("admin.proctorWorkspace.tableTitle")}
        mobile={
          <MobileRecordList
            columns={columns}
            rows={visibleExams}
            getRowId={(e) => e.examId}
            loading={isLoading}
            error={error}
            empty={visibleExams.length === 0}
            emptyTitle={t(
              statusFilter === "all"
                ? "admin.proctorWorkspace.empty.title"
                : "admin.proctorWorkspace.empty.filteredTitle",
            )}
            emptyDescription={t(
              statusFilter === "all"
                ? "admin.proctorWorkspace.empty.description"
                : "admin.proctorWorkspace.empty.filteredDescription",
            )}
          />
        }
      >
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
          <DesktopDataTable
            columns={columns}
            data={visibleExams}
            getRowId={(e) => e.examId}
          />
        )}
      </DataTableShell>
    </div>
  );
}
