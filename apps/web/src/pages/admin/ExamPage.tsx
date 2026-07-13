import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTableShell } from "@/components/shared/DataTableShell";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { RowActions } from "@/components/shared/RowActions";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardList, Eye, Plus, Trash2 } from "lucide-react";

/** Row shape returned by the exams list API. */
interface ExamRow {
  id: string;
  title: string;
  status: string;
  openAt: string;
  closeAt: string;
  durationMinutes: number;
  passingScore: number;
  totalScore: number;
  questionIds: string[];
  participantCount: number;
  canDelete: boolean;
  deleteDisabledReason: string | null;
}

/** Generic paginated API response wrapper. */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Admin page for listing, viewing, and deleting exams.
 * UI-KOI-WEGENT-VISUAL-PIVOT-1: Removed empty count strip. Count moved into
 * toolbar summary. Admin table with distinct header, clear boundaries.
 */
export function ExamPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadExams = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<PaginatedResponse<ExamRow>>("/api/exams");
      setExams(data.items);
    } catch {
      setError(t("admin.exams.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/exams/${id}`);
      toast.success(t("admin.exams.toast.deleted"));
      await loadExams();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("admin.exams.toast.deleteFailed"),
      );
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadExams} />;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t("admin.exams.title")}
          actions={
            <Button onClick={() => void navigate("/admin/exams/new")}>
              <AppIcon icon={Plus} size="inline" />
              {t("admin.exams.createBtn")}
            </Button>
          }
        />

        {exams.length === 0 ? (
          <EmptyState
            icon={<AppIcon icon={ClipboardList} size="state" />}
            title={t("admin.exams.empty")}
            description={t("admin.exams.emptyDescription")}
          />
        ) : (
          <>
            <DataTableShell
              title={t("admin.exams.listTitle")}
              description={t("admin.exams.listDescription")}
              toolbar={
                <span className="type-secondary">
                  {t("admin.exams.summary", { count: exams.length })}
                </span>
              }
            >
              <Table>
                <DataTableColumns
                  columns={[
                    { role: "primary-text" },
                    { role: "status" },
                    { role: "date-range" },
                    { role: "duration" },
                    { role: "number", key: "question-count" },
                    { role: "number", key: "participant-count" },
                    { role: "score" },
                    { role: "actions" },
                  ]}
                />
                <TableHeader>
                  <TableRow>
                    <DataTableHead role="primary-text">
                      {t("admin.exams.columns.title")}
                    </DataTableHead>
                    <DataTableHead role="status">
                      {t("admin.exams.columns.status")}
                    </DataTableHead>
                    <DataTableHead role="date-range">
                      {t("admin.exams.columns.timeWindow")}
                    </DataTableHead>
                    <DataTableHead role="duration">
                      {t("admin.exams.columns.duration")}
                    </DataTableHead>
                    <DataTableHead role="number">
                      {t("admin.exams.columns.questionCount")}
                    </DataTableHead>
                    <DataTableHead role="number">
                      {t("admin.exams.columns.participants")}
                    </DataTableHead>
                    <DataTableHead role="score">
                      {t("admin.exams.columns.passingScore")}
                    </DataTableHead>
                    <DataTableHead role="actions">
                      {t("admin.exams.columns.actions")}
                    </DataTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exams.map((exam) => {
                    const deleteButton = (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("admin.exams.deleteLabel")}
                        disabled={!exam.canDelete}
                        data-row-action-tone="destructive"
                      >
                        <AppIcon icon={Trash2} size="inline" />
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
                        <DataTableCell
                          role="date-range"
                          className="text-sm text-muted-foreground"
                        >
                          {new Date(exam.openAt).toLocaleDateString()} -{" "}
                          {new Date(exam.closeAt).toLocaleDateString()}
                        </DataTableCell>
                        <DataTableCell role="duration">
                          {t("admin.exams.duration", {
                            min: exam.durationMinutes,
                          })}
                        </DataTableCell>
                        <DataTableCell role="number">
                          {exam.questionIds.length}
                        </DataTableCell>
                        <DataTableCell role="number">
                          {exam.participantCount}
                        </DataTableCell>
                        <DataTableCell role="score">
                          {exam.passingScore}/{exam.totalScore}
                        </DataTableCell>
                        <DataTableCell role="actions">
                          <RowActions>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                void navigate(`/admin/exams/${exam.id}`)
                              }
                              aria-label={t("admin.exams.viewDetail")}
                            >
                              <AppIcon icon={Eye} size="inline" />
                            </Button>
                            {exam.canDelete ? (
                              <ConfirmDialog
                                trigger={deleteButton}
                                title={t("admin.exams.confirmDelete")}
                                description={t(
                                  "admin.exams.confirmDeleteDescription",
                                  { title: exam.title },
                                )}
                                destructive
                                onConfirm={() => void handleDelete(exam.id)}
                              />
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    tabIndex={0}
                                    aria-label={t("admin.exams.deleteLabel")}
                                  >
                                    {deleteButton}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {exam.deleteDisabledReason ??
                                    t("admin.exams.deleteDisabled")}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </RowActions>
                        </DataTableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </DataTableShell>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
