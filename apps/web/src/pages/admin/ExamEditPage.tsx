import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { fetchAllPickerQuestions } from "@/lib/allQuestions";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { useScheduleSessionTimeZone } from "@/contexts/DateTimeContext";
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
 * Maps a GET exam response into the ExamConfigData form state, filling the
 * schedule back as the wall clock of the ORGANIZATION zone (F-20), never the
 * browser zone.
 */
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
    openAt: instantToLocalInput(exam.openAt, timeZone),
    closeAt: exam.closeAt ? instantToLocalInput(exam.closeAt, timeZone) : null,
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
  /** The form session's frozen scheduling zone; null until settings settle. */
  const sessionTimeZone = useScheduleSessionTimeZone();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [examStatus, setExamStatus] = useState<string>("draft");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [questionDialogOpen, setQuestionDialogOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadedExam, setLoadedExam] = useState<ExamDetailResponse | null>(null);
  const [config, setConfig] = useState<ExamConfigData | null>(null);
  /** Stored schedule instants from the GET response — the preservation
   * baseline: an untouched field sends these verbatim (F-20). */
  const [originalSchedule, setOriginalSchedule] = useState<{
    openAt: string;
    closeAt: string | null;
  } | null>(null);

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
      setLoadedExam(exam);
      setOriginalSchedule({ openAt: exam.openAt, closeAt: exam.closeAt });
      setExamStatus(exam.status);
      setCourses(cData.items);
      setQuestions(questions);
    } catch {
      setError(t("admin.examEdit.feedback.loadDataFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // The schedule prefill opens only once the form session's zone is fixed
  // (first settings read settled). Until then the schedule inputs are not
  // rendered at all, so a late settings response can never reinterpret a
  // wall clock the user already typed (F-20 review A). There is deliberately
  // no "re-fill when the zone changes" effect: the session zone is frozen.
  useEffect(() => {
    if (!loadedExam || !sessionTimeZone) return;
    setConfig(examToConfig(loadedExam, sessionTimeZone));
  }, [loadedExam, sessionTimeZone]);

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

  /**
   * ONE resolution of the schedule fields per form state (F-20): the live
   * field hints and the save validation/payload all consume this result —
   * no surface re-parses the wall clocks under another zone.
   */
  const schedule = useMemo(() => {
    if (!config || !sessionTimeZone) return null;
    return {
      open: resolveScheduleField(
        config.openAt,
        originalSchedule?.openAt ?? null,
        sessionTimeZone,
      ),
      close: resolveScheduleField(
        config.closeAt ?? "",
        originalSchedule?.closeAt ?? null,
        sessionTimeZone,
      ),
    };
  }, [config, originalSchedule, sessionTimeZone]);

  /** Live schedule hints for the form fields (DST gap/overlap on edited
   * wall clocks; untouched preserved instants never produce a hint). */
  const scheduleFieldErrors = useMemo(() => {
    if (!schedule || !sessionTimeZone) return undefined;
    return {
      openAt: scheduleFieldHint(schedule.open.status, sessionTimeZone, t),
      closeAt: scheduleFieldHint(schedule.close.status, sessionTimeZone, t),
    };
  }, [schedule, sessionTimeZone, t]);

  const timeInvalid =
    schedule !== null &&
    schedule.open.instant !== null &&
    schedule.close.instant !== null &&
    schedule.close.instant <= schedule.open.instant;

  /** Validates the form, PATCHes the exam, and navigates to the detail page. */
  async function handleSave() {
    if (!id || !config || !schedule || saving) return;
    // Schedule fields resolve through the seam in the form session's zone;
    // an untouched field keeps the stored instant (seconds and DST-overlap
    // side included) instead of re-converting its wall clock.
    const { open, close } = schedule;
    const errors: Record<string, string> = {};
    if (!config.title.trim())
      errors.title = t("admin.examEdit.validation.titleRequired");
    if (!config.courseId)
      errors.courseId = t("admin.examEdit.validation.courseRequired");
    const openHint = scheduleFieldErrors?.openAt;
    if (openHint) errors.openAt = openHint;
    const closeHint = scheduleFieldErrors?.closeAt;
    if (closeHint) errors.closeAt = closeHint;
    if (!openHint && !closeHint && timeInvalid) {
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
  if (!loadedExam)
    return (
      <ErrorState
        message={t("admin.examEdit.feedback.loadConfigFailed")}
        onRetry={loadData}
      />
    );
  // The schedule inputs (and the rest of the prefilled form) open only once
  // the form session's zone is fixed; until then a late settings response
  // could still change the zone under the user's wall clocks.
  if (!sessionTimeZone || !config) return <LoadingState />;

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
            scheduleTimeZone={sessionTimeZone}
            timeInvalid={timeInvalid}
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
