import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { fetchAllPickerQuestions } from "@/lib/allQuestions";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { instantToLocalInput } from "@/lib/dateTime";
import { resolveScheduleField, scheduleFieldHint } from "@/lib/scheduleInput";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { ErrorState } from "@/components/shared/ErrorState";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import {
  DataTableCell,
  DataTableSurface,
  DataTableHead,
  DataTableOverflowText,
} from "@/components/shared/DataTableContract";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { TableAllocationRegion } from "@/components/shared/TableScrollSurface";
import { RowActions } from "@/components/shared/RowActions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableBody, TableHeader, TableRow } from "@/components/ui/table";
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
import { PageContainer } from "@/components/shared/PageContainer";

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
  timingMode: "timed_window" | "deadline" | "untimed";
  durationMinutes: number | null;
  openAt: string;
  closeAt: string | null;
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

/**
 * Converts an ISO instant into the scheduling-zone datetime-local fill-back
 * (F-20): the wall clock the stored instant represents in the ORGANIZATION
 * zone, never the browser zone.
 */
function isoToScheduleInput(iso: string, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return instantToLocalInput(d, timeZone);
}

/** Maps a GET exam response into the ExamConfigData form state. */
function examToConfig(
  exam: ExamDetailResponse,
  timeZone: string,
): ExamConfigData {
  return {
    title: exam.title ?? "",
    description: exam.description ?? "",
    courseId: exam.courseId ?? "",
    timingMode: exam.timingMode ?? "timed_window",
    durationMinutes: exam.durationMinutes,
    openAt: isoToScheduleInput(exam.openAt, timeZone),
    closeAt: exam.closeAt ? isoToScheduleInput(exam.closeAt, timeZone) : null,
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
  const { timeZone: scheduleTimeZone } = useProductDateTime();
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
  /** Stored schedule instants from the GET response — the preservation
   * baseline: an untouched field sends these verbatim (F-20). */
  const [originalSchedule, setOriginalSchedule] = useState<{
    openAt: string;
    closeAt: string | null;
  } | null>(null);
  /** Zone the current wall-clock fill-backs were produced in. */
  const [fillTimeZone, setFillTimeZone] = useState<string | null>(null);

  /** Loads the exam (for prefill), available courses, and questions in parallel. */
  const loadData = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const [exam, cData, questions] = await Promise.all([
        api.get<ExamDetailResponse>(`/api/exams/${id}`),
        api.get<PaginatedResponse<CourseRow>>("/api/courses"),
        fetchAllPickerQuestions(),
      ]);
      setConfig(examToConfig(exam, scheduleTimeZone));
      setOriginalSchedule({ openAt: exam.openAt, closeAt: exam.closeAt });
      setFillTimeZone(scheduleTimeZone);
      setExamStatus(exam.status);
      setCourses(cData.items);
      setQuestions(questions);
    } catch {
      setError(t("admin.examEdit.feedback.loadDataFailed"));
    } finally {
      setIsLoading(false);
    }
    // scheduleTimeZone is read once per load; the effect below re-fills
    // untouched fields when the resolved zone changes afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Organization settings can land after the exam GET (independent
  // requests). When the resolved scheduling zone changes, re-fill only the
  // UNTOUCHED schedule fields so the form keeps displaying the same stored
  // instants in the new zone; user edits stay exactly as typed.
  useEffect(() => {
    if (!config || !originalSchedule || !fillTimeZone) return;
    if (scheduleTimeZone === fillTimeZone) return;
    setConfig((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      const openFillOld = originalSchedule.openAt
        ? instantToLocalInput(originalSchedule.openAt, fillTimeZone)
        : "";
      if (prev.openAt === openFillOld) {
        next.openAt = originalSchedule.openAt
          ? instantToLocalInput(originalSchedule.openAt, scheduleTimeZone)
          : "";
      }
      const closeFillOld = originalSchedule.closeAt
        ? instantToLocalInput(originalSchedule.closeAt, fillTimeZone)
        : "";
      if ((prev.closeAt ?? "") === closeFillOld) {
        next.closeAt = originalSchedule.closeAt
          ? instantToLocalInput(originalSchedule.closeAt, scheduleTimeZone)
          : null;
      }
      return next;
    });
    setFillTimeZone(scheduleTimeZone);
  }, [scheduleTimeZone, config, originalSchedule, fillTimeZone]);

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

  /** Live schedule hints for the form fields (DST gap/overlap on edited
   * wall clocks; untouched preserved instants never produce a hint). */
  const scheduleFieldErrors = useMemo(() => {
    if (!config) return undefined;
    const open = resolveScheduleField(
      config.openAt,
      originalSchedule?.openAt ?? null,
      scheduleTimeZone,
    );
    const close = resolveScheduleField(
      config.closeAt ?? "",
      originalSchedule?.closeAt ?? null,
      scheduleTimeZone,
    );
    return {
      openAt: scheduleFieldHint(open.status, scheduleTimeZone, t),
      closeAt: scheduleFieldHint(close.status, scheduleTimeZone, t),
    };
  }, [config, originalSchedule, scheduleTimeZone, t]);

  /** Validates the form, PATCHes the exam, and navigates to the detail page. */
  async function handleSave() {
    if (!id || !config || saving) return;
    // Schedule fields resolve through the seam in the scheduling zone; an
    // untouched field keeps the stored instant (seconds and DST-overlap
    // side included) instead of re-converting its wall clock.
    const open = resolveScheduleField(
      config.openAt,
      originalSchedule?.openAt ?? null,
      scheduleTimeZone,
    );
    const close = resolveScheduleField(
      config.closeAt ?? "",
      originalSchedule?.closeAt ?? null,
      scheduleTimeZone,
    );
    const errors: Record<string, string> = {};
    if (!config.title.trim())
      errors.title = t("admin.examEdit.validation.titleRequired");
    if (!config.courseId)
      errors.courseId = t("admin.examEdit.validation.courseRequired");
    const openHint = scheduleFieldHint(open.status, scheduleTimeZone, t);
    if (openHint) errors.openAt = openHint;
    const closeHint = scheduleFieldHint(close.status, scheduleTimeZone, t);
    if (closeHint) errors.closeAt = closeHint;
    if (
      !openHint &&
      !closeHint &&
      open.instant &&
      close.instant &&
      close.instant <= open.instant
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
            openAt: open.instant ?? undefined,
            closeAt: close.instant ?? undefined,
          }
        : {
            ...config,
            openAt: open.instant ?? undefined,
            closeAt: close.instant ?? null,
          };
      await api.patch(`/api/exams/${id}`, payload);
      toast.success(t("admin.examEdit.feedback.updateSuccess"));
      void navigate(`/admin/exams/${id}`);
    } catch (err) {
      const message = getApiErrorMessage(
        err,
        t,
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
    <PageContainer role="form" className="flex flex-col gap-6">
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
            scheduleFieldErrors={scheduleFieldErrors}
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
            <DataTableShell archetype="embedded-picker">
              <DataTableSurface
                columns={[
                  { role: "type" },
                  { role: "long-text", overflow: "truncate" },
                  { role: "score" },
                  { role: "actions" },
                ]}
              >
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
                      <DataTableCell role="long-text">
                        <DataTableOverflowText
                          mode="truncate"
                          value={q.content}
                        />
                      </DataTableCell>
                      <DataTableCell role="score">{q.score}</DataTableCell>
                      <DataTableCell role="actions">
                        <RowActions
                          row={q}
                          actions={[
                            {
                              id: "remove-question",
                              label: t("admin.examEdit.ariaDeleteQuestion"),
                              icon: Trash2,
                              tone: "destructive",
                              confirm: {
                                title: t("admin.examEdit.confirmRemoveTitle"),
                                description: t(
                                  "admin.examEdit.confirmRemoveDescription",
                                ),
                                destructive: true,
                              },
                              onSelect: () => removeQuestion(q.id),
                            },
                          ]}
                        />
                      </DataTableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTableSurface>
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
        <DialogContent aria-describedby={undefined} size="lg">
          <DialogHeader>
            <DialogTitle>{t("admin.examEdit.dialogTitle")}</DialogTitle>
          </DialogHeader>
          {/* dialog-body owns the vertical scroll; header/footer fixed. */}
          <div data-slot="dialog-body">
            <TableAllocationRegion>
              <DataTableSurface
                columns={[
                  { role: "type" },
                  { role: "long-text", overflow: "truncate" },
                  { role: "score" },
                  { role: "actions" },
                ]}
              >
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
                      <DataTableCell role="long-text">
                        <DataTableOverflowText
                          mode="truncate"
                          value={q.content}
                        />
                      </DataTableCell>
                      <DataTableCell role="score">{q.score}</DataTableCell>
                      <DataTableCell role="actions">
                        {/* embedded-picker exception (P3 §4.4 (issue 445)): dialog
                          picker tables keep a text add action — auto layout,
                          outside the admin shell's icon-only vocabulary. */}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => addQuestion(q.id)}
                        >
                          {t("admin.examEdit.dialogActions.add")}
                        </Button>
                      </DataTableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTableSurface>
            </TableAllocationRegion>
          </div>
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
    </PageContainer>
  );
}
