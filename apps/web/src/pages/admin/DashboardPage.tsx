import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type { DashboardRecentExam, DashboardResponse } from "@exam/contracts";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { AppIcon } from "@/components/shared/AppIcon";
import { StatsCard } from "@/components/shared/StatsCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DesktopDataTable,
  type DataViewColumnDef,
} from "@/components/shared/DesktopDataTable";
import { MobileRecordList } from "@/components/shared/MobileRecordList";
import { RowActions } from "@/components/shared/RowActions";
import {
  ClipboardList,
  Eye,
  BookOpen,
  Users,
  CalendarCheck,
  Activity,
  PlusCircle,
  Upload,
} from "lucide-react";

/**
 * Admin dashboard page showing summary statistics (question count, active exams,
 * candidate count, today's exams), quick-action buttons, and a table of recent exams.
 *
 * UI-KOI-WEGENT-VISUAL-PIVOT-1: Stats cards with icon containers, admin table
 * with distinct header, clear boundaries, cool-neutral palette.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.get<DashboardResponse>("/api/system/dashboard");
      setData(result);
    } catch {
      setError(t("admin.dashboard.errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("admin.dashboard.title")} />
        <ErrorState message={error} onRetry={loadDashboard} />
      </div>
    );
  }

  // Single-source column declarations (issue 457): desktop table and mobile
  // cards render from the same array.
  const columns: DataViewColumnDef<DashboardRecentExam>[] = [
    {
      id: "title",
      meta: { role: "primary-text" },
      header: t("admin.dashboard.recent.columns.title"),
      cell: ({ row }) => row.original.title,
    },
    {
      id: "status",
      meta: { role: "status" },
      header: t("admin.dashboard.recent.columns.status"),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "participantCount",
      meta: { role: "number" },
      header: t("admin.dashboard.recent.columns.participantCount"),
      cell: ({ row }) => row.original.participantCount,
    },
    {
      id: "actions",
      meta: { role: "actions" },
      header: t("admin.dashboard.recent.columns.actions"),
      cell: ({ row }) => (
        <RowActions
          row={row.original}
          actions={[
            {
              id: "view-exam",
              label: t("admin.dashboard.recent.viewExamLabel", {
                title: row.original.title,
              }),
              icon: Eye,
              onSelect: () => navigate(`/admin/exams/${row.original.id}`),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("admin.dashboard.title")} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          label={t("admin.dashboard.stats.totalQuestions")}
          value={data?.totalQuestions ?? 0}
          icon={<AppIcon icon={BookOpen} size="metric" />}
        />
        <StatsCard
          label={t("admin.dashboard.stats.activeExams")}
          value={data?.activeExams ?? 0}
          icon={<AppIcon icon={Activity} size="metric" />}
        />
        <StatsCard
          label={t("admin.dashboard.stats.totalCandidates")}
          value={data?.totalCandidates ?? 0}
          icon={<AppIcon icon={Users} size="metric" />}
        />
        <StatsCard
          label={t("admin.dashboard.stats.todayExams")}
          value={data?.todayExams ?? 0}
          icon={<AppIcon icon={CalendarCheck} size="metric" />}
        />
      </div>

      <div className="flex gap-3">
        <Button onClick={() => navigate("/admin/exams/new")}>
          <AppIcon icon={PlusCircle} size="inline" />
          {t("admin.dashboard.actions.createExam")}
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate("/admin/questions/import")}
        >
          <AppIcon icon={Upload} size="inline" />
          {t("admin.dashboard.actions.importQuestions")}
        </Button>
      </div>

      <DataTableShell
        title={t("admin.dashboard.recent.title")}
        mobile={
          <MobileRecordList
            columns={columns}
            rows={data?.recentExams ?? []}
            getRowId={(e) => e.id}
            empty={!data?.recentExams || data.recentExams.length === 0}
            emptyTitle={t("admin.dashboard.recent.emptyTitle")}
            emptyDescription={t("admin.dashboard.recent.emptyDescription")}
          />
        }
      >
        <div className="min-w-0">
          {!data?.recentExams || data.recentExams.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<AppIcon icon={ClipboardList} size="state" />}
                title={t("admin.dashboard.recent.emptyTitle")}
                description={t("admin.dashboard.recent.emptyDescription")}
                action={
                  <Button onClick={() => navigate("/admin/exams/new")}>
                    {t("admin.dashboard.actions.createExam")}
                  </Button>
                }
              />
            </div>
          ) : (
            <DesktopDataTable
              columns={columns}
              data={data.recentExams}
              getRowId={(e) => e.id}
            />
          )}
        </div>
      </DataTableShell>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-32" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="surface-content flex flex-col gap-2 p-5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="surface-content flex flex-col gap-4 p-4">
        <Skeleton className="h-6 w-24" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
