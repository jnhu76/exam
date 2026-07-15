import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { ErrorState } from "@/components/shared/ErrorState";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { RowActions } from "@/components/shared/RowActions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ExamConfigForm,
  type ExamConfigData,
} from "@/components/exam/ExamConfigForm";
import { Separator } from "@/components/ui/separator";
import { BookOpen, Trash2 } from "lucide-react";
import { getTypeLabel } from "@/lib/constants";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Minimal course representation used in the exam edit form. */
interface CourseRow {
  id: string;
  name: string;
}

/** Minimal question representation used in the exam edit form. */
interface QuestionRow {
  id: string;
  type: string;
  content: string;
  score: number;
}

/** Generic paginated API response wrapper. */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
}

/** Shape of the GET /api/exams/:id response (ExamDTO subset). */
interface ExamDetailResponse {
  id: string;
  title: string;
  description: string;
  courseId: string;
  status: string;
  durationMinutes: number;
  openAt: string;
  closeAt: string;
  passingScore: number;
  totalScore: number;
  questionSelectionMode: string;
  questionIds: string[];
  controlFlags: Record<string, unknown>;
  retakePolicy: string;
  scoreStrategy: string;
  maxAttempts: number;
  latestStartOffsetMinutes: number | null;
  minSubmitAfterStartMinutes: number | null;
  resultPublicationMode: string;
}

/** Converts an ISO datetime string to the local datetime-local input format. */
function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // datetime-local format: YYYY-MM-DDTHH:mm (no seconds, no timezone).
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Maps a GET exam response into the ExamConfigData form state. */
function examToConfig(exam: ExamDetailResponse): ExamConfigData {
  return {
    title: exam.title ?? "",
    description: exam.description ?? "",
    courseId: exam.courseId ?? "",
    durationMinutes: exam.durationMinutes ?? 60,
    openAt: isoToLocalInput(exam.openAt),
    closeAt: isoToLocalInput(exam.closeAt),
    passingScore: exam.passingScore ?? 60,
    totalScore: exam.totalScore ?? 100,
    questionSelectionMode:
      (exam.questionSelectionMode as ExamConfigData["questionSelectionMode"]) ??
      "manual",
    questionIds: exam.questionIds ?? [],
    resultPublicationMode:
      (exam.resultPublicationMode as ExamConfigData["resultPublicationMode"]) ??
      "immediate",
    controlFlags: (exam.controlFlags ?? {}) as ExamConfigData["controlFlags"],
    retakePolicy:
      (exam.retakePolicy as ExamConfigData["retakePolicy"]) ?? "unlimited",
    scoreStrategy:
      (exam.scoreStrategy as ExamConfigData["scoreStrategy"]) ?? "highest",
    maxAttempts: exam.maxAttempts ?? 1,
    latestStartOffsetMinutes: exam.latestStartOffsetMinutes ?? null,
    minSubmitAfterStartMinutes: exam.minSubmitAfterStartMinutes ?? null,
  };
}

/**
 * Admin page for editing an existing exam (draft = full edit; published =
 * schedule-only per backend guard). Reuses ExamConfigForm + question picker
 * from the create page. Saves via PATCH /api/exams/:id.
 */
export function ExamEditPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [examStatus, setExamStatus] = useState<string>("draft");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [questionDialogOpen, setQuestionDialogOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [config, setConfig] = useState<ExamConfigData | null>(null);

  /** Loads the exam (for prefill), available courses, and questions in parallel. */
  const loadData = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const [exam, cData, qData] = await Promise.all([
        api.get<ExamDetailResponse>(`/api/exams/${id}`),
        api.get<PaginatedResponse<CourseRow>>("/api/courses"),
        api.get<PaginatedResponse<QuestionRow>>("/api/questions"),
      ]);
      setConfig(examToConfig(exam));
      setExamStatus(exam.status);
      setCourses(cData.items);
      setQuestions(qData.items);
    } catch {
      setError(t("admin.examEdit.feedback.loadDataFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /** Adds a question to the selected question list if not already present. */
  function addQuestion(qId: string) {
    if (!config || config.questionIds.includes(qId)) return;
    setConfig({ ...config, questionIds: [...config.questionIds, qId] });
  }

  /** Removes a question from the selected question list. */
  function removeQuestion(qId: string) {
    if (!config) return;
    setConfig({
      ...config,
      questionIds: config.questionIds.filter((qid) => qid !== qId),
    });
  }

  /** Validates the form, PATCHes the exam, and navigates to the detail page. */
  async function handleSave() {
    if (!id || !config || saving) return;
    const errors: Record<string, string> = {};
    if (!config.title.trim())
      errors.title = t("admin.examEdit.validation.titleRequired");
    if (!config.courseId)
      errors.courseId = t("admin.examEdit.validation.courseRequired");
    if (
      config.openAt &&
      config.closeAt &&
      new Date(config.closeAt) <= new Date(config.openAt)
    ) {
      errors.time = t("admin.examEdit.validation.timeInvalid");
    }
    if (config.passingScore > config.totalScore) {
      errors.score = t("admin.examEdit.validation.scoreInvalid");
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error(t("admin.examEdit.feedback.fixErrors"));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // For published exams the backend guard only allows schedule fields
      // (openAt/closeAt); strip everything else to avoid a 409 round-trip.
      const scheduleOnly = examStatus === "published";
      const payload = scheduleOnly
        ? {
            openAt: config.openAt
              ? new Date(config.openAt).toISOString()
              : undefined,
            closeAt: config.closeAt
              ? new Date(config.closeAt).toISOString()
              : undefined,
          }
        : {
            ...config,
            openAt: config.openAt
              ? new Date(config.openAt).toISOString()
              : undefined,
            closeAt: config.closeAt
              ? new Date(config.closeAt).toISOString()
              : undefined,
          };
      await api.patch(`/api/exams/${id}`, payload);
      toast.success(t("admin.examEdit.feedback.updateSuccess"));
      void navigate(`/admin/exams/${id}`);
    } catch (err) {
      const message = getApiErrorMessage(
        err,
        t("admin.examEdit.feedback.saveFailed"),
      );
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;
  if (!config)
    return (
      <ErrorState
        message={t("admin.examEdit.feedback.loadConfigFailed")}
        onRetry={loadData}
      />
    );

  const selectedQuestions = questions.filter((q) =>
    config.questionIds.includes(q.id),
  );
  const availableQuestions = questions.filter(
    (q) => !config.questionIds.includes(q.id),
  );
  const scheduleOnly = examStatus === "published";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("admin.examEdit.pageTitle")} />

      {scheduleOnly && (
        <Alert>
          <AlertDescription>
            {t("admin.examEdit.publishedAlert")}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <ExamConfigForm
            courses={courses}
            questions={questions.map((q) => ({ id: q.id, score: q.score }))}
            data={config}
            onChange={setConfig}
          />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              {t("admin.examEdit.selectedQuestions", {
                count: config.questionIds.length,
              })}
            </h3>
            <Button size="sm" onClick={() => setQuestionDialogOpen(true)}>
              {t("admin.examEdit.selectQuestions")}
            </Button>
          </div>
          {selectedQuestions.length === 0 ? (
            <EmptyState
              icon={<AppIcon icon={BookOpen} size="state" />}
              title={t("admin.examEdit.noQuestionsTitle")}
              description={t("admin.examEdit.noQuestionsDescription")}
            />
          ) : (
            <DataTableShell>
              <Table>
                <DataTableColumns
                  columns={[
                    { role: "type" },
                    { role: "long-text" },
                    { role: "score" },
                    { role: "actions" },
                  ]}
                />
                <TableHeader>
                  <TableRow>
                    <DataTableHead role="type">
                      {t("admin.examEdit.tableHeaders.type")}
                    </DataTableHead>
                    <DataTableHead role="long-text">
                      {t("admin.examEdit.tableHeaders.content")}
                    </DataTableHead>
                    <DataTableHead role="score">
                      {t("admin.examEdit.tableHeaders.score")}
                    </DataTableHead>
                    <DataTableHead role="actions">
                      {t("admin.examEdit.tableHeaders.actions")}
                    </DataTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedQuestions.map((q) => (
                    <TableRow key={q.id}>
                      <DataTableCell role="type">
                        <Badge variant="outline">
                          {getTypeLabel(q.type, t) ?? q.type}
                        </Badge>
                      </DataTableCell>
                      <DataTableCell role="long-text" className="truncate">
                        {q.content}
                      </DataTableCell>
                      <DataTableCell role="score">{q.score}</DataTableCell>
                      <DataTableCell role="actions">
                        <RowActions>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeQuestion(q.id)}
                            aria-label={t("admin.examEdit.ariaDeleteQuestion")}
                            data-row-action-tone="destructive"
                          >
                            <AppIcon icon={Trash2} size="inline" />
                          </Button>
                        </RowActions>
                      </DataTableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DataTableShell>
          )}
        </div>
      </div>

      <Separator />
      {saveError && <InlineErrorBanner>{saveError}</InlineErrorBanner>}
      <div className="flex justify-end gap-3 pt-4">
        <Button
          variant="outline"
          onClick={() => void navigate(`/admin/exams/${id}`)}
        >
          {t("admin.examEdit.actions.cancel")}
        </Button>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving
            ? t("admin.examEdit.actions.saving")
            : t("admin.examEdit.actions.save")}
        </Button>
      </div>

      <Dialog open={questionDialogOpen} onOpenChange={setQuestionDialogOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-2xl max-h-[80vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{t("admin.examEdit.dialogTitle")}</DialogTitle>
          </DialogHeader>
          <Table>
            <DataTableColumns
              columns={[
                { role: "type" },
                { role: "long-text" },
                { role: "score" },
                { role: "actions" },
              ]}
            />
            <TableHeader>
              <TableRow>
                <DataTableHead role="type">
                  {t("admin.examEdit.tableHeaders.type")}
                </DataTableHead>
                <DataTableHead role="long-text">
                  {t("admin.examEdit.tableHeaders.content")}
                </DataTableHead>
                <DataTableHead role="score">
                  {t("admin.examEdit.tableHeaders.score")}
                </DataTableHead>
                <DataTableHead role="actions">
                  {t("admin.examEdit.dialogActions.add")}
                </DataTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {availableQuestions.map((q) => (
                <TableRow key={q.id}>
                  <DataTableCell role="type">
                    <Badge variant="outline">
                      {getTypeLabel(q.type, t) ?? q.type}
                    </Badge>
                  </DataTableCell>
                  <DataTableCell role="long-text" className="truncate">
                    {q.content}
                  </DataTableCell>
                  <DataTableCell role="score">{q.score}</DataTableCell>
                  <DataTableCell role="actions">
                    <RowActions>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => addQuestion(q.id)}
                      >
                        {t("admin.examEdit.dialogActions.add")}
                      </Button>
                    </RowActions>
                  </DataTableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setQuestionDialogOpen(false)}
            >
              {t("admin.examEdit.dialogActions.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
