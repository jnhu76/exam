import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DesktopDataTable,
  type DataViewColumnDef,
} from "@/components/shared/DesktopDataTable";
import { MobileRecordList } from "@/components/shared/MobileRecordList";
import { RowActions } from "@/components/shared/RowActions";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PageContainer } from "@/components/shared/PageContainer";
import { Gauge, Eye } from "lucide-react";
import type { ScoreViewDisabledReasonCode } from "@exam/contracts";
import { scoreViewDisabledReasonKey } from "@/lib/examDisabledReasons";

/** Exam row shape as returned by the exams list API, including score-view permissions. */
interface ExamRow {
  id: string;
  title: string;
  status: string;
  openAt: string;
  closeAt: string;
  passingScore: number;
  totalScore: number;
  gradedAttemptCount: number;
  canViewScores: boolean;
  scoreViewDisabledReasonCode: ScoreViewDisabledReasonCode | null;
  /** Legacy natural-language sibling — compatibility fallback only (D0.8). */
  scoreViewDisabledReason: string | null;
}

/** Admin page for browsing published/closed exams and navigating to their score lists. */
export function ResultsOverviewPage() {
  const { t } = useTranslation();
  const { formatDateTime } = useProductDateTime();
  const navigate = useNavigate();
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fetches exams and filters to those whose scores may be viewable. */
  const loadExams = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<{ items: ExamRow[] }>("/api/exams");
      const visible = data.items.filter(
        (e) =>
          e.status === "published" ||
          e.status === "open" ||
          e.status === "closed" ||
          e.status === "archived",
      );
      setExams(visible);
    } catch {
      setError(t("admin.resultsOverview.errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadExams();
  }, [loadExams]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadExams} />;

  /** Returns whether the admin can view scores for the given exam. */
  function gradable(exam: ExamRow) {
    return exam.canViewScores;
  }

  /**
   * Returns the tooltip explanation why scores cannot be viewed. The machine
   * DisabledReasonCode is authoritative (D0.8); the legacy natural-language
   * wire field only covers unknown future codes.
   */
  function gradableReason(exam: ExamRow): string {
    const code = exam.scoreViewDisabledReasonCode;
    if (code) {
      const key = scoreViewDisabledReasonKey(code);
      if (key) return t(key);
    }
    return exam.scoreViewDisabledReason ?? "";
  }

  // Single-source column declarations (issue 457): desktop table and mobile
  // cards render from the same array.
  const columns: DataViewColumnDef<ExamRow>[] = [
    {
      id: "title",
      meta: { role: "primary-text" },
      header: t("admin.resultsOverview.columns.title"),
      cell: ({ row }) => row.original.title,
    },
    {
      id: "status",
      meta: { role: "status" },
      header: t("admin.resultsOverview.columns.status"),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "time",
      meta: { role: "date" },
      header: t("admin.resultsOverview.columns.time"),
      cell: ({ row }) =>
        row.original.openAt ? formatDateTime(row.original.openAt) : "-",
    },
    {
      id: "gradedCount",
      meta: { role: "number" },
      header: t("admin.resultsOverview.columns.gradedCount"),
      cell: ({ row }) => row.original.gradedAttemptCount ?? 0,
    },
    {
      id: "actions",
      meta: { role: "actions" },
      header: t("admin.resultsOverview.columns.actions"),
      cell: ({ row }) => {
        const exam = row.original;
        const canView = gradable(exam);
        const reason = gradableReason(exam);
        return (
          <RowActions
            row={exam}
            actions={[
              {
                id: "view-scores",
                label: t("admin.resultsOverview.actions.viewScores"),
                icon: Eye,
                disabled: canView ? false : { reason },
                onSelect: () => void navigate(routes.admin.examScores(exam.id)),
              },
            ]}
          />
        );
      },
    },
  ];

  return (
    <TooltipProvider>
      <PageContainer role="admin-standard" className="flex flex-col gap-6">
        <PageHeader title={t("admin.resultsOverview.title")} />

        <DataTableShell
          title={t("admin.resultsOverview.cardTitle")}
          mobile={
            <MobileRecordList
              columns={columns}
              rows={exams}
              getRowId={(e) => e.id}
              empty={exams.length === 0}
              emptyTitle={t("admin.resultsOverview.empty.title")}
              emptyDescription={t("admin.resultsOverview.empty.description")}
            />
          }
        >
          {exams.length === 0 ? (
            <EmptyState
              icon={<AppIcon icon={Gauge} size="hero" />}
              title={t("admin.resultsOverview.empty.title")}
              description={t("admin.resultsOverview.empty.description")}
            />
          ) : (
            <DesktopDataTable
              columns={columns}
              data={exams}
              getRowId={(e) => e.id}
            />
          )}
        </DataTableShell>
      </PageContainer>
    </TooltipProvider>
  );
}
