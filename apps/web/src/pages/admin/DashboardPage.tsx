import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type {
  DashboardRecentExam,
  DashboardResponse,
  GradingQueueListResponse,
  RecoveryQueueResponse,
} from "@exam/contracts";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { useAuth } from "@/hooks/useAuth";
import {
  gradingQueueTotalCount,
  unresolvedIncidentCount,
  useAdminTodoCount,
} from "@/hooks/useAdminTodoCount";
import { canSeeGradingQueue, canSeeRecovery } from "@/lib/capabilities";
import { PageHeader } from "@/components/shared/PageHeader";
import { AppIcon } from "@/components/shared/AppIcon";
import { StatsCard } from "@/components/shared/StatsCard";
import { AdminTodoCard } from "@/components/shared/AdminTodoCard";
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
import { PageContainer } from "@/components/shared/PageContainer";
import {
  ClipboardList,
  Eye,
  BookOpen,
  Users,
  CalendarCheck,
  Activity,
  ListChecks,
  LifeBuoy,
  PlusCircle,
  Upload,
} from "lucide-react";

/** Page size 1: the grading card consumes only the authoritative `total`,
 * so the list body is fetched at its minimum bounded cost. */
const GRADING_COUNT_QUERY = "/api/admin/grading-queue?page=1&pageSize=1";
/** Bounded first page: 20 rows decide exact-vs->20 for the incident card. */
const INCIDENT_COUNT_LIMIT = 20;

/**
 * Admin dashboard page showing summary statistics (question count, active exams,
 * candidate count, today's exams), actionable todo queues (pending manual
 * grading, unresolved incidents), quick-action buttons, and a table of recent
 * exams.
 *
 * Stats cards with icon containers, admin table
 * with distinct header, clear boundaries, cool-neutral palette.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  // The dashboard route is gated to Admin server-side, so `user` is present in
  // every authorized render; the null branch only satisfies the type between
  // session restore states and renders no todo surface.
  const canGrade = user ? canSeeGradingQueue(user) : false;
  const canRecover = user ? canSeeRecovery(user) : false;
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

  // Each todo card owns an independent request + state machine: a failed
  // source lands on Unknown/Stale and can never zero or overwrite the other
  // card (partial-failure is the combination, not a shared error state).
  // `enabled` mirrors the render gate so a capability-hidden card neither
  // fires its request nor accumulates a guaranteed 403.
  const gradingTodo = useAdminTodoCount(
    (signal) =>
      api
        .get<GradingQueueListResponse>(GRADING_COUNT_QUERY, { signal })
        .then(gradingQueueTotalCount),
    { enabled: canGrade },
  );
  const incidentTodo = useAdminTodoCount(
    (signal) =>
      api
        .get<RecoveryQueueResponse>(
          `/api/admin/recovery/incidents?unresolvedOnly=true&limit=${INCIDENT_COUNT_LIMIT}`,
          { signal },
        )
        .then((response) =>
          unresolvedIncidentCount(response, INCIDENT_COUNT_LIMIT),
        ),
    { enabled: canRecover },
  );

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
    <PageContainer role="admin-standard" className="flex flex-col gap-6">
      {/* Quick actions live in the PageHeader actions slot — the same idiom
          as the other admin pages — so the primary task anchor is the todo
          section and the actions stay reachable at every scroll depth (#932). */}
      <PageHeader
        title={t("admin.dashboard.title")}
        actions={
          <>
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
          </>
        }
      />

      {/* Todo section: capability-gated like the sidebar entries (UX-only;
          backend authorization stays authoritative). Both cards are hidden
          entirely when neither queue is actionable for this principal. */}
      {(canGrade || canRecover) && (
        <section
          aria-labelledby="admin-todo-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="admin-todo-heading" className="type-section-title">
            {t("admin.dashboard.todo.sectionTitle")}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {canGrade && (
              <AdminTodoCard
                icon={ListChecks}
                href={routes.admin.gradingQueue}
                state={gradingTodo.state}
                onRefresh={gradingTodo.refresh}
                copy={{
                  label: t("admin.dashboard.todo.grading.label"),
                  unit: t("admin.dashboard.todo.grading.unit"),
                  zeroCaption: t("admin.dashboard.todo.grading.zero"),
                  unknownValue: t("admin.dashboard.todo.unknownValue"),
                  staleCaption: t("admin.dashboard.todo.staleCaption"),
                  refreshingCaption: t("admin.dashboard.todo.refreshing"),
                  retryLabel: t("admin.dashboard.todo.retry"),
                  refreshLabel: t("admin.dashboard.todo.refresh"),
                  cta: t("admin.dashboard.todo.grading.cta"),
                }}
              />
            )}
            {canRecover && (
              <AdminTodoCard
                icon={LifeBuoy}
                href={`${routes.admin.recovery}?unresolvedOnly=true`}
                state={incidentTodo.state}
                onRefresh={incidentTodo.refresh}
                copy={{
                  label: t("admin.dashboard.todo.incidents.label"),
                  unit: t("admin.dashboard.todo.incidents.unit"),
                  zeroCaption: t("admin.dashboard.todo.incidents.zero"),
                  unknownValue: t("admin.dashboard.todo.unknownValue"),
                  staleCaption: t("admin.dashboard.todo.staleCaption"),
                  refreshingCaption: t("admin.dashboard.todo.refreshing"),
                  retryLabel: t("admin.dashboard.todo.retry"),
                  refreshLabel: t("admin.dashboard.todo.refresh"),
                  cta: t("admin.dashboard.todo.incidents.cta"),
                }}
              />
            )}
          </div>
        </section>
      )}

      {/* Reference band: asset KPIs sit below the actionable sections and
          above the recent-exams table (todo → KPI → recent). */}
      <section
        aria-labelledby="admin-stats-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="admin-stats-heading" className="type-section-title">
          {t("admin.dashboard.stats.sectionTitle")}
        </h2>
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
      </section>

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
    </PageContainer>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Loading approximation mirrors the page's section order
          (header+actions → todo → KPI → recent). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Skeleton className="h-8 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-20" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="surface-content flex flex-col gap-2 p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-12" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-20" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="surface-content flex flex-col gap-2 p-5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
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
