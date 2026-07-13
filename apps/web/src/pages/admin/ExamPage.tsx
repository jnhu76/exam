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
import { DataToolbar } from "@/components/shared/DataToolbar";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

/** Admin page for listing, viewing, and deleting exams. */
export function ExamPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fetches the exam list from the API and updates local state. */
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

  /** Deletes an exam by id and refreshes the list. */
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
            <DataToolbar
              aria-label={t("admin.exams.toolbarLabel")}
              summary={t("admin.exams.summary", { count: exams.length })}
            />
            <DataTableShell
              title={t("admin.exams.listTitle")}
              description={t("admin.exams.listDescription")}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("admin.exams.columns.title")}</TableHead>
                    <TableHead className="w-20">
                      {t("admin.exams.columns.status")}
                    </TableHead>
                    <TableHead>{t("admin.exams.columns.timeWindow")}</TableHead>
                    <TableHead className="w-16">
                      {t("admin.exams.columns.duration")}
                    </TableHead>
                    <TableHead className="w-16">
                      {t("admin.exams.columns.questionCount")}
                    </TableHead>
                    <TableHead className="w-16">
                      {t("admin.exams.columns.participants")}
                    </TableHead>
                    <TableHead className="w-16">
                      {t("admin.exams.columns.passingScore")}
                    </TableHead>
                    <TableHead className="w-32">
                      {t("admin.exams.columns.actions")}
                    </TableHead>
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
                      >
                        <AppIcon icon={Trash2} size="inline" />
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
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(exam.openAt).toLocaleDateString()} -{" "}
                          {new Date(exam.closeAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {t("admin.exams.duration", {
                            min: exam.durationMinutes,
                          })}
                        </TableCell>
                        <TableCell>{exam.questionIds.length}</TableCell>
                        <TableCell>{exam.participantCount}</TableCell>
                        <TableCell>
                          {exam.passingScore}/{exam.totalScore}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
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
                          </div>
                        </TableCell>
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
