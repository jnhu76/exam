import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
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
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { RowActions } from "@/components/shared/RowActions";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Gauge, Eye } from "lucide-react";

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
  scoreViewDisabledReason: string | null;
}

/** Admin page for browsing published/closed exams and navigating to their score lists. */
export function ResultsOverviewPage() {
  const { t } = useTranslation();
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

  /** Returns the reason why scores cannot be viewed, or empty string if allowed. */
  function gradableReason(exam: ExamRow) {
    return exam.scoreViewDisabledReason ?? "";
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        <PageHeader title={t("admin.resultsOverview.title")} />

        <DataTableShell
          title={t("admin.resultsOverview.cardTitle")}
          minTableWidth="compact"
        >
          {exams.length === 0 ? (
            <EmptyState
              icon={<AppIcon icon={Gauge} size="hero" />}
              title={t("admin.resultsOverview.empty.title")}
              description={t("admin.resultsOverview.empty.description")}
            />
          ) : (
            <Table>
              <DataTableColumns
                columns={[
                  { role: "primary-text" },
                  { role: "status" },
                  { role: "date" },
                  { role: "number" },
                  { role: "actions" },
                ]}
              />
              <TableHeader>
                <TableRow>
                  <DataTableHead role="primary-text">
                    {t("admin.resultsOverview.columns.title")}
                  </DataTableHead>
                  <DataTableHead role="status">
                    {t("admin.resultsOverview.columns.status")}
                  </DataTableHead>
                  <DataTableHead role="date">
                    {t("admin.resultsOverview.columns.time")}
                  </DataTableHead>
                  <DataTableHead role="number">
                    {t("admin.resultsOverview.columns.gradedCount")}
                  </DataTableHead>
                  <DataTableHead role="actions">
                    {t("admin.resultsOverview.columns.actions")}
                  </DataTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exams.map((exam) => {
                  const canView = gradable(exam);
                  const reason = gradableReason(exam);
                  const viewButton = (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!canView}
                      onClick={() =>
                        void navigate(routes.admin.examScores(exam.id))
                      }
                    >
                      <AppIcon icon={Eye} size="inline" />
                      {t("admin.resultsOverview.actions.viewScores")}
                    </Button>
                  );
                  return (
                    <TableRow key={exam.id}>
                      <DataTableCell
                        role="primary-text"
                        className="font-medium"
                      >
                        {exam.title}
                      </DataTableCell>
                      <DataTableCell role="status">
                        <StatusBadge status={exam.status} />
                      </DataTableCell>
                      <DataTableCell role="date">
                        {exam.openAt
                          ? new Date(exam.openAt).toLocaleString()
                          : "-"}
                      </DataTableCell>
                      <DataTableCell role="number">
                        {exam.gradedAttemptCount ?? 0}
                      </DataTableCell>
                      <DataTableCell role="actions">
                        <RowActions>
                          {canView ? (
                            viewButton
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span tabIndex={0}>{viewButton}</span>
                              </TooltipTrigger>
                              <TooltipContent>{reason}</TooltipContent>
                            </Tooltip>
                          )}
                        </RowActions>
                      </DataTableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </DataTableShell>
      </div>
    </TooltipProvider>
  );
}
