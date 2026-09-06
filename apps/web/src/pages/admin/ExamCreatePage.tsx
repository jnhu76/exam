import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { getApiErrorMessage, getApiFieldErrors } from "@/lib/apiErrors";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import {
  buildWizardPolicyPreview,
  type WizardProfileLike,
} from "@/lib/wizardPolicyPreview";
import {
  summarizeProfile,
  type ProfileSummaryLabels,
} from "@/lib/examProfileSummary";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { ErrorState } from "@/components/shared/ErrorState";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { FormSection } from "@/components/shared/FormSection";
import { FieldGroup, Field, FieldRow } from "@/components/shared/FieldGroup";
import { FieldError } from "@/components/shared/FieldError";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
} from "@/components/shared/DataTableContract";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { RowActions } from "@/components/shared/RowActions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpen, Trash2 } from "lucide-react";
import { getTypeLabel } from "@/lib/constants";
import { WizardStepper } from "@/components/exam/wizard/WizardStepper";
import { WizardPolicyFields } from "@/components/exam/wizard/WizardPolicyFields";
import {
  buildCreateExamPayload,
  goToStep,
  initialWizardState,
  selectProfile,
  setOverride,
  setInterruptionPolicyOverride,
  clearOverride,
  WIZARD_CODE_DEFAULTS,
  WIZARD_TOTAL_STEPS,
  type WizardState,
} from "@/components/exam/wizard/wizardState";
import type { ExamProfilePolicyDefaults } from "@exam/domain";
import type { ExamProfileDTO } from "@exam/contracts";

interface CourseRow {
  id: string;
  name: string;
}
interface QuestionRow {
  id: string;
  type: string;
  content: string;
  score: number;
}
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  totalPages: number;
}

/**
 * Error keys each wizard step owns: local validation keys plus the server
 * field names `stepForField` may route here. Used to drop stale errors when a
 * step is re-validated, so a fixed field never keeps a ghost error.
 */
const STEP_FIELD_KEYS: Record<number, string[]> = {
  1: ["title", "courseId", "profileId"],
  2: [
    "durationMinutes",
    "latestStartOffsetMinutes",
    "minSubmitAfterStartMinutes",
    "retakePolicy",
    "maxAttempts",
    "scoreStrategy",
    "resultPublicationMode",
    "interruptionTimePolicy",
    "interruptionGracePerIncidentSeconds",
    "interruptionGracePerAttemptSeconds",
  ],
  3: ["score", "questionIds", "totalScore", "passingScore"],
  4: ["time", "openAt", "closeAt"],
  5: [],
};

/** Map a server validation field name to the wizard step that owns it. */
function stepForField(field: string): number {
  for (const [step, keys] of Object.entries(STEP_FIELD_KEYS)) {
    if (keys.includes(field)) return Number(step);
  }
  return 5;
}

/**
 * Resolve the i18n label source for summarizeProfile. Kept here (near the only
 * wizard consumer) to avoid a second hook in the shared lib.
 */
function useSummaryLabels(): ProfileSummaryLabels {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      durationMinutes: (m) =>
        m === null
          ? t("admin.examProfilePages.summaryNoDuration")
          : t("admin.examProfilePages.summaryDuration", { count: m }),
      latestStart: (m) =>
        t("admin.examProfilePages.summaryLatestStart", { count: m }),
      minSubmit: (m) =>
        t("admin.examProfilePages.summaryMinSubmit", { count: m }),
      retake: {
        unlimited: t("admin.examProfilePages.enumLabels.retakePolicyUnlimited"),
        maxAttempts: (n) =>
          t("admin.examProfilePages.summaryMaxAttempts", { count: n }),
        passThenStop: t(
          "admin.examProfilePages.enumLabels.retakePolicyPassThenStop",
        ),
      },
      scoreStrategy: {
        highest: t("admin.examProfilePages.enumLabels.scoreStrategyHighest"),
        latest: t("admin.examProfilePages.enumLabels.scoreStrategyLatest"),
        first: t("admin.examProfilePages.enumLabels.scoreStrategyFirst"),
      },
      resultPublication: {
        immediate: t(
          "admin.examProfilePages.enumLabels.resultPublicationImmediate",
        ),
        afterGrading: t(
          "admin.examProfilePages.enumLabels.resultPublicationAfterGrading",
        ),
        manual: t("admin.examProfilePages.enumLabels.resultPublicationManual"),
      },
      interruption: {
        strict: t("admin.examProfilePages.enumLabels.interruptionStrict"),
        boundedGrace: t(
          "admin.examProfilePages.enumLabels.interruptionBoundedGrace",
        ),
        operatorIncident: t(
          "admin.examProfilePages.enumLabels.interruptionOperatorIncident",
        ),
      },
      separator: " · ",
    }),
    [t],
  );
}

/**
 * P7-M exam creation wizard. A 5-step product flow:
 *   1. 基本信息 (title/course + profile picker)
 *   2. 考试策略 (10 profile-safe fields with override UX)
 *   3. 题目与分数 (manual question picker)
 *   4. 时间安排 (open/close)
 *   5. 检查并创建 (resolved-policy preview → create draft)
 *
 * Latent control flags are NOT shown (P7-M truthfulness: only enforced
 * dimensions surface in the new product entry). Wizard creates a Draft Exam;
 * the existing publish action remains on the exam detail page.
 */
export function ExamCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const summaryLabels = useSummaryLabels();
  const { formatDateTime } = useProductDateTime();

  const [state, setState] = useState<WizardState>(initialWizardState);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [profiles, setProfiles] = useState<ExamProfileDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [questionDialogOpen, setQuestionDialogOpen] = useState(false);
  // Auto-calc totalScore from the selected questions (mirrors the legacy
  // ExamConfigForm behavior); the user may switch to manual entry.
  const [manualTotalScore, setManualTotalScore] = useState(false);
  // The 及格分 default (60) follows the auto-calculated 总分 until the user
  // edits it explicitly (see the auto-calc effect below).
  const [passingScoreTouched, setPassingScoreTouched] = useState(false);

  const loadData = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const [cData, qData, pData] = await Promise.all([
        api.get<PaginatedResponse<CourseRow>>("/api/courses"),
        // Load all selectable questions (API caps pageSize at 100) so the
        // picker is not silently limited to the first page.
        api.get<PaginatedResponse<QuestionRow>>(
          "/api/questions?page=1&pageSize=100",
        ),
        api.get<ExamProfileDTO[]>("/api/exam-profiles"),
      ]);
      setCourses(cData.items);
      setProfiles(pData);
      setState((prev) =>
        prev.courseId ? prev : { ...prev, courseId: cData.items[0]?.id ?? "" },
      );
      // The questions list can span multiple pages (pageSize cap = 100).
      // Fetch the remaining pages and combine so the picker sees every
      // selectable question; a single page short-circuits to page 1 alone.
      const pageCount = Math.max(1, qData.totalPages);
      const restPages = await Promise.all(
        Array.from({ length: pageCount - 1 }, (_, i) =>
          api.get<PaginatedResponse<QuestionRow>>(
            `/api/questions?page=${i + 2}&pageSize=100`,
          ),
        ),
      );
      setQuestions([...qData.items, ...restPages.flatMap((r) => r.items)]);
    } catch {
      setError(t("admin.examWizard.feedback.loadDataFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedProfile: WizardProfileLike | null = useMemo(() => {
    if (!state.profileId) return null;
    const p = profiles.find((x) => x.id === state.profileId);
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      defaults: {
        timingMode: p.timingMode,
        durationMinutes: p.durationMinutes,
        latestStartOffsetMinutes: p.latestStartOffsetMinutes,
        minSubmitAfterStartMinutes: p.minSubmitAfterStartMinutes,
        retakePolicy: p.retakePolicy,
        maxAttempts: p.maxAttempts,
        scoreStrategy: p.scoreStrategy,
        resultPublicationMode: p.resultPublicationMode,
        interruptionTimePolicy: p.interruptionTimePolicy,
        interruptionGracePerIncidentSeconds:
          p.interruptionGracePerIncidentSeconds,
        interruptionGracePerAttemptSeconds:
          p.interruptionGracePerAttemptSeconds,
      },
    };
  }, [state.profileId, profiles]);

  const preview = useMemo(
    () =>
      buildWizardPolicyPreview({
        profile: selectedProfile,
        overrides: state.overrides,
        codeDefaults: WIZARD_CODE_DEFAULTS,
      }),
    [selectedProfile, state.overrides],
  );

  // ── state mutators (thin wrappers over wizardState helpers) ──
  const setStep = (step: number) => setState((s) => goToStep(s, step));
  const onSelectProfile = (id: string | null) =>
    setState((s) => selectProfile(s, id));
  const onSetOverride = (
    field: keyof ExamProfilePolicyDefaults,
    value: ExamProfilePolicyDefaults[keyof ExamProfilePolicyDefaults] | null,
  ) =>
    setState((s) =>
      field === "interruptionTimePolicy"
        ? // Atomic policy write: leaving bounded_grace also nulls both grace
          // caps, so profile-supplied caps can't leak into strict /
          // operator_incident (ADR-013). Mirrors ExamProfileEditPage.
          setInterruptionPolicyOverride(
            s,
            value as ExamProfilePolicyDefaults["interruptionTimePolicy"],
          )
        : // Explicit key type argument: the field narrowing on this branch
          // would otherwise shrink the generic key union and reject the
          // full-union value.
          setOverride<keyof ExamProfilePolicyDefaults>(s, field, value),
    );
  const onClearOverride = (field: keyof ExamProfilePolicyDefaults) =>
    setState((s) => clearOverride(s, field));

  function addQuestion(qId: string) {
    setState((s) =>
      s.questionIds.includes(qId)
        ? s
        : { ...s, questionIds: [...s.questionIds, qId] },
    );
  }
  function removeQuestion(qId: string) {
    setState((s) => ({
      ...s,
      questionIds: s.questionIds.filter((id) => id !== qId),
    }));
  }

  // ── per-step validation ──
  function validateCurrentStep(): boolean {
    const errors: Record<string, string> = {};
    if (state.step === 1) {
      if (!state.title.trim())
        errors.title = t("admin.examWizard.validation.titleRequired");
      if (!state.courseId)
        errors.courseId = t("admin.examWizard.validation.courseRequired");
    }
    if (state.step === 2) {
      // User-supplied policy values must stay in their valid domain; the
      // profile/default fallback is already valid (validated on save).
      if (
        preview.resolved.timingMode === "timed_window" &&
        preview.resolved.durationMinutes !== null &&
        preview.resolved.durationMinutes < 1
      ) {
        errors.durationMinutes = t(
          "admin.examWizard.validation.durationRequired",
        );
      }
      if (
        preview.resolved.retakePolicy === "max_attempts" &&
        preview.resolved.maxAttempts < 1
      ) {
        errors.maxAttempts = t(
          "admin.examWizard.validation.maxAttemptsInvalid",
        );
      }
    }
    if (state.step === 3) {
      if (state.passingScore > state.totalScore)
        errors.score = t("admin.examWizard.validation.scoreInvalid");
    }
    if (state.step === 4) {
      if (
        preview.resolved.timingMode !== "untimed" &&
        (!state.openAt || !state.closeAt)
      )
        errors.time = t("admin.examWizard.validation.timeRequired");
      else if (new Date(state.closeAt) <= new Date(state.openAt))
        errors.time = t("admin.examWizard.validation.timeInvalid");
    }
    // Drop this step's stale errors (local + server field names) before
    // merging the fresh result, so a fixed field never keeps a ghost error.
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const key of STEP_FIELD_KEYS[state.step] ?? []) delete next[key];
      return { ...next, ...errors };
    });
    return Object.keys(errors).length === 0;
  }

  function next() {
    if (!validateCurrentStep()) {
      toast.error(t("admin.examWizard.feedback.fixErrors"));
      return;
    }
    setStep(state.step + 1);
  }
  function prev() {
    setStep(state.step - 1);
  }

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    setFieldErrors({});
    try {
      const payload = buildCreateExamPayload(state, preview.resolved);
      const exam = await api.post<{ id: string }>("/api/exams", payload);
      toast.success(t("admin.examWizard.feedback.createSuccess"));
      void navigate(`/admin/exams/${exam.id}`);
    } catch (err) {
      const fieldMap = getApiFieldErrors(err);
      if (Object.keys(fieldMap).length > 0) {
        setFieldErrors(fieldMap);
        // Route the user to the relevant step for the first mapped field.
        const firstField = Object.keys(fieldMap)[0];
        if (firstField) setStep(stepForField(firstField));
      }
      const message = getApiErrorMessage(
        err,
        t,
        t("admin.examWizard.feedback.createFailed"),
      );
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const selectedQuestions = questions.filter((q) =>
    state.questionIds.includes(q.id),
  );
  const availableQuestions = questions.filter(
    (q) => !state.questionIds.includes(q.id),
  );
  const computedTotal = selectedQuestions.reduce((sum, q) => sum + q.score, 0);
  const hasQuestions = state.questionIds.length > 0;

  // Auto-calc totalScore from the selected questions whenever the selection
  // changes (mirrors the legacy ExamConfigForm behavior). The publish gate
  // requires totalScore === sum(question scores); auto-calc prevents
  // avoidable publish-time 400s. The user may switch to manual entry.
  useEffect(() => {
    if (!hasQuestions || manualTotalScore || computedTotal <= 0) return;
    setState((s) => {
      let next = s;
      if (s.totalScore !== computedTotal) {
        next = { ...next, totalScore: computedTotal };
      }
      // While the 及格分 has not been explicitly edited, it tracks the auto
      // total at the 60% convention (like the default for a 100-point exam).
      // Without this, the untouched default (60) can exceed a small total and
      // leave step 3 born in an error state; explicit user edits are never
      // overwritten.
      if (!passingScoreTouched) {
        const defaultPassing = Math.max(1, Math.round(computedTotal * 0.6));
        if (next.passingScore !== defaultPassing) {
          next = { ...next, passingScore: defaultPassing };
        }
      }
      return next;
    });
  }, [computedTotal, hasQuestions, manualTotalScore, passingScoreTouched]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.examWizard.pageTitle")}
        description={t("admin.examWizard.pageDescription")}
      />

      <WizardStepper current={state.step} onNavigate={(s) => setStep(s)} />

      {/* Step 1 — basic info + profile picker */}
      {state.step === 1 && (
        <FieldGroup>
          <FormSection title={t("admin.examWizard.steps.basic")}>
            <Field>
              <Label htmlFor="wiz-title">
                {t("admin.examWizard.fields.title")}
              </Label>
              <Input
                id="wiz-title"
                value={state.title}
                onChange={(e) =>
                  setState((s) => ({ ...s, title: e.target.value }))
                }
                placeholder={t("admin.examWizard.fields.titlePlaceholder")}
              />
              <FieldError>{fieldErrors.title}</FieldError>
            </Field>
            <FieldRow>
              <Field>
                <Label htmlFor="wiz-course">
                  {t("admin.examWizard.fields.course")}
                </Label>
                <Select
                  value={state.courseId}
                  onValueChange={(v) =>
                    setState((s) => ({ ...s, courseId: v }))
                  }
                >
                  <SelectTrigger
                    id="wiz-course"
                    aria-label={t("admin.examWizard.fields.course")}
                  >
                    <SelectValue
                      placeholder={t(
                        "admin.examWizard.fields.coursePlaceholder",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError>{fieldErrors.courseId}</FieldError>
              </Field>
            </FieldRow>
            <Field>
              <Label htmlFor="wiz-description">
                {t("admin.examWizard.fields.description")}
              </Label>
              <Input
                id="wiz-description"
                value={state.description}
                onChange={(e) =>
                  setState((s) => ({ ...s, description: e.target.value }))
                }
                placeholder={t(
                  "admin.examWizard.fields.descriptionPlaceholder",
                )}
              />
            </Field>
          </FormSection>

          <FormSection
            title={t("admin.examWizard.steps.policy")}
            description={t("admin.examWizard.copyOnApplyHint")}
          >
            <Field>
              <Label>
                {t("admin.examWizard.profileSource.existingProfile")}
              </Label>
              <Select
                value={state.profileId ?? "__none__"}
                onValueChange={(v) =>
                  onSelectProfile(v === "__none__" ? null : v)
                }
              >
                <SelectTrigger
                  aria-label={t(
                    "admin.examWizard.profileSource.existingProfile",
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    {t("admin.examWizard.profileSource.none")}
                  </SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="type-metadata">
                {state.profileId
                  ? t("admin.examWizard.copyOnApplyHint")
                  : t("admin.examWizard.noProfileHint")}
              </p>
            </Field>
          </FormSection>
        </FieldGroup>
      )}

      {/* Step 2 — policy fields (10 profile-safe, enforced dimensions only) */}
      {state.step === 2 && (
        <WizardPolicyFields
          state={state}
          selectedProfile={selectedProfile}
          fieldErrors={fieldErrors}
          setOverride={onSetOverride}
          clearOverride={onClearOverride}
        />
      )}

      {/* Step 3 — questions + scores */}
      {state.step === 3 && (
        <FieldGroup>
          <FormSection title={t("admin.examWizard.steps.questions")}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {t("admin.examWizard.questions.selectedCount", {
                  count: state.questionIds.length,
                })}
              </p>
              <Button size="sm" onClick={() => setQuestionDialogOpen(true)}>
                {t("admin.examWizard.questions.selectQuestions")}
              </Button>
            </div>
            {selectedQuestions.length === 0 ? (
              <EmptyState
                icon={<AppIcon icon={BookOpen} size="state" />}
                title={t("admin.examWizard.questions.noQuestionsTitle")}
                description={t(
                  "admin.examWizard.questions.noQuestionsDescription",
                )}
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
                        {t("admin.examWizard.questions.tableHeaders.type")}
                      </DataTableHead>
                      <DataTableHead role="long-text">
                        {t("admin.examWizard.questions.tableHeaders.content")}
                      </DataTableHead>
                      <DataTableHead role="score">
                        {t("admin.examWizard.questions.tableHeaders.score")}
                      </DataTableHead>
                      <DataTableHead role="actions">
                        {t("admin.examWizard.questions.tableHeaders.actions")}
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
                          <RowActions
                            row={q}
                            actions={[
                              {
                                id: "remove-question",
                                label: t(
                                  "admin.examWizard.questions.ariaDeleteQuestion",
                                ),
                                icon: Trash2,
                                tone: "destructive",
                                confirm: {
                                  title: t(
                                    "admin.examWizard.questions.confirmRemoveTitle",
                                  ),
                                  description: t(
                                    "admin.examWizard.questions.confirmRemoveDescription",
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
                </Table>
              </DataTableShell>
            )}
          </FormSection>
          <FormSection title={t("admin.examWizard.questions.totalScore")}>
            <FieldRow>
              <Field>
                <div className="flex items-center justify-between">
                  <Label htmlFor="wiz-totalScore">
                    {t("admin.examWizard.questions.totalScore")}
                  </Label>
                  {hasQuestions && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => {
                        if (manualTotalScore) {
                          setManualTotalScore(false);
                          if (computedTotal > 0) {
                            setState((s) => ({
                              ...s,
                              totalScore: computedTotal,
                            }));
                          }
                        } else {
                          setManualTotalScore(true);
                        }
                      }}
                    >
                      {manualTotalScore
                        ? t("admin.examWizard.questions.autoCalc")
                        : t("admin.examWizard.questions.manualInput")}
                    </Button>
                  )}
                </div>
                <Input
                  id="wiz-totalScore"
                  type="number"
                  min={1}
                  value={state.totalScore}
                  readOnly={hasQuestions && !manualTotalScore}
                  aria-label={t("admin.examWizard.questions.totalScore")}
                  onChange={(e) => {
                    // Empty input keeps the previous value — never store 0.
                    if (e.target.value === "") return;
                    setState((s) => ({
                      ...s,
                      totalScore: Number(e.target.value),
                    }));
                  }}
                />
                {hasQuestions && !manualTotalScore && (
                  <p className="type-metadata">
                    {t("admin.examWizard.questions.autoCalcLabel", {
                      score: computedTotal,
                    })}
                  </p>
                )}
                {hasQuestions &&
                  manualTotalScore &&
                  state.totalScore !== computedTotal && (
                    <p className="text-xs text-destructive">
                      {t("admin.examWizard.questions.scoreMismatch", {
                        score: computedTotal,
                      })}
                    </p>
                  )}
              </Field>
              <Field>
                <Label htmlFor="wiz-passingScore">
                  {t("admin.examWizard.questions.passingScore")}
                </Label>
                <Input
                  id="wiz-passingScore"
                  data-testid="passingScore-input"
                  type="number"
                  min={0}
                  value={state.passingScore}
                  onChange={(e) => {
                    // Empty input keeps the previous value — never store 0.
                    if (e.target.value === "") return;
                    setPassingScoreTouched(true);
                    setState((s) => ({
                      ...s,
                      passingScore: Number(e.target.value),
                    }));
                  }}
                />
                {fieldErrors.score && (
                  <FieldError>{fieldErrors.score}</FieldError>
                )}
              </Field>
            </FieldRow>
          </FormSection>
        </FieldGroup>
      )}

      {/* Step 4 — schedule */}
      {state.step === 4 && (
        <FormSection title={t("admin.examWizard.steps.schedule")}>
          <FieldRow>
            <Field>
              <Label htmlFor="wiz-openAt">
                {t("admin.examWizard.schedule.startTime")}
              </Label>
              <Input
                id="wiz-openAt"
                type="datetime-local"
                value={state.openAt}
                onChange={(e) =>
                  setState((s) => ({ ...s, openAt: e.target.value }))
                }
              />
            </Field>
            {/* Untimed (Phase A2 (Issue 291)) is open-ended — no close time to pick. */}
            {preview.resolved.timingMode !== "untimed" && (
              <Field>
                <Label htmlFor="wiz-closeAt">
                  {t("admin.examWizard.schedule.endTime")}
                </Label>
                <Input
                  id="wiz-closeAt"
                  type="datetime-local"
                  value={state.closeAt}
                  onChange={(e) =>
                    setState((s) => ({ ...s, closeAt: e.target.value }))
                  }
                />
              </Field>
            )}
            {preview.resolved.timingMode === "untimed" && (
              <p className="type-secondary">
                {t("admin.examWizard.schedule.untimedHint")}
              </p>
            )}
          </FieldRow>
          {/* Local validation key + server-routed field names both render. */}
          <FieldError>{fieldErrors.time}</FieldError>
          <FieldError>{fieldErrors.openAt}</FieldError>
          <FieldError>{fieldErrors.closeAt}</FieldError>
        </FormSection>
      )}

      {/* Step 5 — review */}
      {state.step === 5 && (
        <FieldGroup>
          <FormSection title={t("admin.examWizard.review.title")}>
            <div>
              <h3 className="type-section-title">
                {t("admin.examWizard.review.summaryHeading")}
              </h3>
              <p className="mt-1 type-secondary">
                {summarizeProfile(preview.resolved, summaryLabels)}
              </p>
            </div>
            <Separator />
            <div>
              <h3 className="type-section-title">
                {t("admin.examWizard.review.basicHeading")}
              </h3>
              <dl className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                <dt className="text-muted-foreground">
                  {t("admin.examWizard.fields.title")}
                </dt>
                <dd>{state.title || "—"}</dd>
                <dt className="text-muted-foreground">
                  {t("admin.examWizard.fields.course")}
                </dt>
                <dd>
                  {courses.find((c) => c.id === state.courseId)?.name ?? "—"}
                </dd>
              </dl>
            </div>
            <Separator />
            <div>
              <h3 className="type-section-title">
                {t("admin.examWizard.review.scheduleHeading")}
              </h3>
              <dl className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                <dt className="text-muted-foreground">
                  {t("admin.examWizard.schedule.startTime")}
                </dt>
                <dd>{state.openAt ? formatDateTime(state.openAt) : "—"}</dd>
                <dt className="text-muted-foreground">
                  {t("admin.examWizard.schedule.endTime")}
                </dt>
                <dd>{state.closeAt ? formatDateTime(state.closeAt) : "—"}</dd>
              </dl>
            </div>
            <Separator />
            <div>
              <h3 className="type-section-title">
                {t("admin.examWizard.review.scoringHeading")}
              </h3>
              <dl className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                <dt className="text-muted-foreground">
                  {t("admin.examWizard.questions.totalScore")}
                </dt>
                <dd>{state.totalScore}</dd>
                <dt className="text-muted-foreground">
                  {t("admin.examWizard.questions.passingScore")}
                </dt>
                <dd>{state.passingScore}</dd>
                {selectedQuestions.length > 0 &&
                  state.totalScore !== computedTotal && (
                    <>
                      <dt className="text-destructive">
                        {t("admin.examWizard.review.warningsHeading")}
                      </dt>
                      <dd className="text-destructive">
                        {t("admin.examWizard.review.scoreMismatchWarning", {
                          score: computedTotal,
                        })}
                      </dd>
                    </>
                  )}
              </dl>
            </div>
            <Separator />
            <div>
              <h3 className="type-section-title">
                {t("admin.examWizard.review.questionsHeading")}
              </h3>
              <p className="mt-1 text-sm">
                {state.questionIds.length === 0
                  ? t("admin.examWizard.review.noQuestionsWarning")
                  : t("admin.examWizard.questions.selectedCount", {
                      count: state.questionIds.length,
                    })}
              </p>
            </div>
          </FormSection>
        </FieldGroup>
      )}

      {/* Save errors render on every step (server routing may land anywhere). */}
      {saveError && <InlineErrorBanner>{saveError}</InlineErrorBanner>}

      {/* Navigation */}
      <Separator />
      <div className="flex flex-wrap justify-between gap-3 pt-2">
        <Button variant="outline" onClick={() => void navigate("/admin/exams")}>
          {t("admin.examWizard.actions.cancel")}
        </Button>
        <div className="flex gap-3">
          {state.step > 1 && (
            <Button variant="outline" onClick={prev}>
              {t("admin.examWizard.prev")}
            </Button>
          )}
          {state.step < WIZARD_TOTAL_STEPS && (
            <Button onClick={next}>{t("admin.examWizard.next")}</Button>
          )}
          {state.step === WIZARD_TOTAL_STEPS && (
            <Button onClick={() => void handleCreate()} disabled={saving}>
              {saving
                ? t("admin.examWizard.actions.creating")
                : t("admin.examWizard.actions.createDraft")}
            </Button>
          )}
        </div>
      </div>

      {/* Question picker dialog (unchanged contract, wizard-local). The
          footer close button is this dialog's single close control, so the
          built-in corner X is suppressed to avoid a duplicated accessible
          name. */}
      <Dialog open={questionDialogOpen} onOpenChange={setQuestionDialogOpen}>
        <DialogContent
          aria-describedby={undefined}
          showCloseButton={false}
          className="max-w-2xl max-h-[80vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>
              {t("admin.examWizard.questions.dialogTitle")}
            </DialogTitle>
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
                  {t("admin.examWizard.questions.tableHeaders.type")}
                </DataTableHead>
                <DataTableHead role="long-text">
                  {t("admin.examWizard.questions.tableHeaders.content")}
                </DataTableHead>
                <DataTableHead role="score">
                  {t("admin.examWizard.questions.tableHeaders.score")}
                </DataTableHead>
                <DataTableHead role="actions">
                  {t("admin.examWizard.questions.dialogActions.add")}
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
                    {/* embedded-picker exception (P3 §4.4 (issue 445)): dialog
                        picker tables keep a text add action — auto layout,
                        outside the admin shell's icon-only vocabulary. */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => addQuestion(q.id)}
                    >
                      {t("admin.examWizard.questions.dialogActions.add")}
                    </Button>
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
              {t("admin.examWizard.questions.dialogActions.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
