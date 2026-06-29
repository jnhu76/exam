import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("admin.resultsOverview.cardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {exams.length === 0 ? (
              <EmptyState
                icon={<Gauge className="size-12" />}
                title={t("admin.resultsOverview.empty.title")}
                description={t("admin.resultsOverview.empty.description")}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("admin.resultsOverview.columns.title")}
                    </TableHead>
                    <TableHead>
                      {t("admin.resultsOverview.columns.status")}
                    </TableHead>
                    <TableHead>
                      {t("admin.resultsOverview.columns.time")}
                    </TableHead>
                    <TableHead>
                      {t("admin.resultsOverview.columns.gradedCount")}
                    </TableHead>
                    <TableHead>
                      {t("admin.resultsOverview.columns.actions")}
                    </TableHead>
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
                        <Eye data-icon="inline-start" />
                        {t("admin.resultsOverview.actions.viewScores")}
                      </Button>
                    );
                    return (
                      <TableRow key={exam.id}>
                        <TableCell className="font-medium">
                          {exam.title}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={exam.status} />
                        </TableCell>
                        <TableCell>
                          {exam.openAt
                            ? new Date(exam.openAt).toLocaleString()
                            : "-"}
                        </TableCell>
                        <TableCell>{exam.gradedAttemptCount ?? 0}</TableCell>
                        <TableCell>
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
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
