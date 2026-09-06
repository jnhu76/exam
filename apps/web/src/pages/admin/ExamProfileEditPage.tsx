import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { getApiErrorMessage, getApiFieldErrors } from "@/lib/apiErrors";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { FormSection } from "@/components/shared/FormSection";
import { FieldGroup, Field, FieldRow } from "@/components/shared/FieldGroup";
import { FieldError } from "@/components/shared/FieldError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { PageContainer } from "@/components/shared/PageContainer";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ExamProfileDTO } from "@exam/contracts";
import {
  STARTER_PROFILE_RECIPES,
  type ExamProfilePolicyDefaults,
  type StarterProfileRecipeKey,
} from "@exam/domain";

/** Form state for the profile editor — the 10 profile-safe fields + identity. */
interface ProfileFormState {
  name: string;
  description: string;
  timingMode: ExamProfilePolicyDefaults["timingMode"];
  // Null for deadline/untimed profiles (no personal duration).
  durationMinutes: number | null;
  latestStartOffsetMinutes: number | null;
  minSubmitAfterStartMinutes: number | null;
  retakePolicy: ExamProfilePolicyDefaults["retakePolicy"];
  maxAttempts: number;
  scoreStrategy: ExamProfilePolicyDefaults["scoreStrategy"];
  resultPublicationMode: ExamProfilePolicyDefaults["resultPublicationMode"];
  interruptionTimePolicy: ExamProfilePolicyDefaults["interruptionTimePolicy"];
  interruptionGracePerIncidentSeconds: number | null;
  interruptionGracePerAttemptSeconds: number | null;
}

/** Empty/default form state for the create path. */
function emptyForm(): ProfileFormState {
  return {
    name: "",
    description: "",
    timingMode: "timed_window",
    durationMinutes: 60,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    retakePolicy: "unlimited",
    maxAttempts: 1,
    scoreStrategy: "highest",
    resultPublicationMode: "immediate",
    interruptionTimePolicy: "strict",
    interruptionGracePerIncidentSeconds: null,
    interruptionGracePerAttemptSeconds: null,
  };
}

/** Prefill form state from a starter recipe's defaults. */
function formFromRecipe(key: StarterProfileRecipeKey): ProfileFormState {
  const recipe = STARTER_PROFILE_RECIPES.find((r) => r.key === key);
  if (!recipe) return emptyForm();
  return { name: "", description: "", ...recipe.defaults };
}

/** Map a fetched profile DTO to form state (edit path). */
function formFromProfile(p: ExamProfileDTO): ProfileFormState {
  return {
    name: p.name,
    description: p.description,
    timingMode: p.timingMode,
    durationMinutes: p.durationMinutes,
    latestStartOffsetMinutes: p.latestStartOffsetMinutes,
    minSubmitAfterStartMinutes: p.minSubmitAfterStartMinutes,
    retakePolicy: p.retakePolicy,
    maxAttempts: p.maxAttempts,
    scoreStrategy: p.scoreStrategy,
    resultPublicationMode: p.resultPublicationMode,
    interruptionTimePolicy: p.interruptionTimePolicy,
    interruptionGracePerIncidentSeconds: p.interruptionGracePerIncidentSeconds,
    interruptionGracePerAttemptSeconds: p.interruptionGracePerAttemptSeconds,
  };
}

/**
 * Build the POST/PATCH body. For create, every field is explicit. For update,
 * send only the fields that changed (plus name/description). Nullable fields
 * are sent as `null` (explicit), which the PATCH contract treats as "clear".
 */
function buildCreateBody(s: ProfileFormState) {
  return {
    name: s.name.trim(),
    description: s.description,
    timingMode: s.timingMode,
    durationMinutes: s.durationMinutes,
    latestStartOffsetMinutes: s.latestStartOffsetMinutes,
    minSubmitAfterStartMinutes: s.minSubmitAfterStartMinutes,
    retakePolicy: s.retakePolicy,
    maxAttempts: s.maxAttempts,
    scoreStrategy: s.scoreStrategy,
    resultPublicationMode: s.resultPublicationMode,
    interruptionTimePolicy: s.interruptionTimePolicy,
    interruptionGracePerIncidentSeconds: s.interruptionGracePerIncidentSeconds,
    interruptionGracePerAttemptSeconds: s.interruptionGracePerAttemptSeconds,
  };
}

/**
 * Create + edit page for exam policy profiles. A profile owns ONLY the 10
 * profile-safe fields (P7-M2). Fields are grouped by user concept, not DB
 * layout. maxAttempts is only meaningful when retakePolicy === "max_attempts";
 * grace caps only when interruptionTimePolicy === "bounded_grace" — those
 * are rendered conditionally to prevent configuring semantically meaningless
 * values. Backend contracts remain authoritative (M1 validator + ADR-013).
 */
export function ExamProfileEditPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<ProfileFormState>(emptyForm);
  const [isLoading, setIsLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [starterDialogOpen, setStarterDialogOpen] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!id) return;
    setError(null);
    setIsLoading(true);
    try {
      const p = await api.get<ExamProfileDTO>(`/api/exam-profiles/${id}`);
      setForm(formFromProfile(p));
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          t,
          t("admin.examProfilePages.feedback.loadOneFailed"),
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    if (isEdit) void loadProfile();
  }, [isEdit, loadProfile]);

  function update(partial: Partial<ProfileFormState>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  /** When retake policy leaves max_attempts, maxAttempts becomes irrelevant. */
  function updateRetakePolicy(value: ProfileFormState["retakePolicy"]) {
    if (value !== "max_attempts") {
      update({ retakePolicy: value, maxAttempts: 1 });
    } else {
      update({
        retakePolicy: value,
        maxAttempts: Math.max(1, form.maxAttempts),
      });
    }
  }

  /**
   * When interruption policy leaves bounded_grace, the grace caps must be
   * cleared (they are meaningless under strict/operator_incident). This keeps
   * the form state consistent with the ADR-013 invariant.
   */
  function updateInterruptionPolicy(
    value: ProfileFormState["interruptionTimePolicy"],
  ) {
    if (value !== "bounded_grace") {
      update({
        interruptionTimePolicy: value,
        interruptionGracePerIncidentSeconds: null,
        interruptionGracePerAttemptSeconds: null,
      });
    } else {
      update({
        interruptionTimePolicy: value,
        interruptionGracePerIncidentSeconds:
          form.interruptionGracePerIncidentSeconds ?? 300,
        interruptionGracePerAttemptSeconds:
          form.interruptionGracePerAttemptSeconds ?? 600,
      });
    }
  }

  /** Parse a nullable-minutes input: empty/NaN → null, else number. */
  function parseNullableMinutes(value: string): number | null {
    if (value === "") return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }

  async function handleSubmit() {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) {
      errors.name = t("admin.examProfilePages.feedback.nameRequired");
    }
    if (
      form.timingMode === "timed_window" &&
      (!form.durationMinutes || form.durationMinutes <= 0)
    ) {
      errors.durationMinutes = t(
        "admin.examProfilePages.feedback.durationRequired",
      );
    }
    // ADR-013 client-side guard: bounded_grace requires both caps, per-incident ≤ per-attempt.
    if (form.interruptionTimePolicy === "bounded_grace") {
      const pi = form.interruptionGracePerIncidentSeconds;
      const pa = form.interruptionGracePerAttemptSeconds;
      if (pi === null || pi <= 0) {
        errors.interruptionGracePerIncidentSeconds = t(
          "admin.examProfilePages.feedback.graceCapRequired",
        );
      }
      if (pa === null || pa <= 0) {
        errors.interruptionGracePerAttemptSeconds = t(
          "admin.examProfilePages.feedback.graceCapRequired",
        );
      } else if (pi !== null && pi > pa) {
        // Ordering error is distinct from missing/non-positive values.
        errors.interruptionGracePerIncidentSeconds = t(
          "admin.examProfilePages.feedback.graceCapOrder",
        );
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error(t("admin.examWizard.feedback.fixErrors"));
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const body = buildCreateBody(form);
      if (isEdit && id) {
        await api.patch<ExamProfileDTO>(`/api/exam-profiles/${id}`, body);
        toast.success(t("admin.examProfilePages.feedback.updateSuccess"));
      } else {
        await api.post<ExamProfileDTO>("/api/exam-profiles", body);
        toast.success(t("admin.examProfilePages.feedback.createSuccess"));
      }
      void navigate("/admin/exam-profiles");
    } catch (err) {
      const fieldMap = getApiFieldErrors(err);
      if (Object.keys(fieldMap).length > 0) {
        setFieldErrors((prev) => ({ ...prev, ...fieldMap }));
      }
      // 409 duplicate name → friendly message (production ApiError shape:
      // status 409 and/or code RESOURCE_CONFLICT — not message parsing).
      const isDuplicate =
        err instanceof ApiError &&
        (err.status === 409 || err.code === "RESOURCE_CONFLICT");
      const message = isDuplicate
        ? t("admin.examProfilePages.feedback.duplicateName")
        : getApiErrorMessage(
            err,
            t,
            t("admin.examProfilePages.feedback.saveFailed"),
          );
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadProfile} />;

  const showMaxAttempts = form.retakePolicy === "max_attempts";
  const showGraceCaps = form.interruptionTimePolicy === "bounded_grace";

  return (
    <PageContainer role="admin-standard" className="flex flex-col gap-6">
      <PageHeader
        title={
          isEdit
            ? t("admin.examProfilePages.editProfilePageTitle")
            : t("admin.examProfilePages.newProfilePageTitle")
        }
        actions={
          !isEdit ? (
            <Button
              variant="outline"
              onClick={() => setStarterDialogOpen(true)}
            >
              {t("admin.examProfilePages.fromStarterBtn")}
            </Button>
          ) : null
        }
      />

      <FormSection title={t("admin.examProfilePages.sections.duration")}>
        <FieldGroup>
          <Field>
            <Label htmlFor="timingMode">
              {t("admin.forms.exam.timingMode")}
            </Label>
            <Select
              value={form.timingMode}
              onValueChange={(v) => {
                const mode = v as ProfileFormState["timingMode"];
                update({
                  timingMode: mode,
                  // Mode switch clears non-applicable fields; deadline/
                  // untimed also force strict (a compensation policy around
                  // a personal deadline cannot apply to them).
                  durationMinutes:
                    mode === "timed_window" ? form.durationMinutes : null,
                  ...(mode !== "timed_window"
                    ? {
                        interruptionTimePolicy: "strict" as const,
                        interruptionGracePerIncidentSeconds: null,
                        interruptionGracePerAttemptSeconds: null,
                      }
                    : {}),
                });
              }}
            >
              <SelectTrigger data-testid="profile-timing-mode-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="timed_window">
                  {t("admin.forms.exam.timingModeValue.timed_window")}
                </SelectItem>
                <SelectItem value="deadline">
                  {t("admin.forms.exam.timingModeValue.deadline")}
                </SelectItem>
                <SelectItem value="untimed">
                  {t("admin.forms.exam.timingModeValue.untimed")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="type-metadata">
              {t(`admin.forms.exam.timingModeHint.${form.timingMode}`)}
            </p>
          </Field>
          {form.timingMode === "timed_window" && (
            <Field>
              <Label htmlFor="durationMinutes">
                {t("admin.examProfilePages.fields.durationMinutes")}
              </Label>
              <Input
                id="durationMinutes"
                type="number"
                min={1}
                value={form.durationMinutes ?? ""}
                onChange={(e) =>
                  update({ durationMinutes: Number(e.target.value) })
                }
              />
              <FieldError>{fieldErrors.durationMinutes}</FieldError>
            </Field>
          )}
        </FieldGroup>
      </FormSection>

      <FormSection title={t("admin.examProfilePages.sections.entrySubmit")}>
        <FieldRow>
          <Field>
            <Label htmlFor="latestStartOffsetMinutes">
              {t("admin.examProfilePages.fields.latestStartOffsetMinutes")}
            </Label>
            <Input
              id="latestStartOffsetMinutes"
              type="number"
              min={0}
              value={form.latestStartOffsetMinutes ?? ""}
              onChange={(e) =>
                update({
                  latestStartOffsetMinutes: parseNullableMinutes(
                    e.target.value,
                  ),
                })
              }
              placeholder={t(
                "admin.examProfilePages.fields.noLimitPlaceholder",
              )}
            />
          </Field>
          <Field>
            <Label htmlFor="minSubmitAfterStartMinutes">
              {t("admin.examProfilePages.fields.minSubmitAfterStartMinutes")}
            </Label>
            <Input
              id="minSubmitAfterStartMinutes"
              type="number"
              min={0}
              value={form.minSubmitAfterStartMinutes ?? ""}
              onChange={(e) =>
                update({
                  minSubmitAfterStartMinutes: parseNullableMinutes(
                    e.target.value,
                  ),
                })
              }
              placeholder={t(
                "admin.examProfilePages.fields.noLimitPlaceholder",
              )}
            />
          </Field>
        </FieldRow>
      </FormSection>

      <FormSection title={t("admin.examProfilePages.sections.retake")}>
        <FieldRow>
          <Field>
            <Label htmlFor="retakePolicy">
              {t("admin.examProfilePages.fields.retakePolicy")}
            </Label>
            <Select
              value={form.retakePolicy}
              onValueChange={(v) =>
                updateRetakePolicy(v as ProfileFormState["retakePolicy"])
              }
            >
              <SelectTrigger
                id="retakePolicy"
                aria-label={t("admin.examProfilePages.fields.retakePolicy")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unlimited">
                  {t("admin.examProfilePages.enumLabels.retakePolicyUnlimited")}
                </SelectItem>
                <SelectItem value="max_attempts">
                  {t(
                    "admin.examProfilePages.enumLabels.retakePolicyMaxAttempts",
                  )}
                </SelectItem>
                <SelectItem value="pass_then_stop">
                  {t(
                    "admin.examProfilePages.enumLabels.retakePolicyPassThenStop",
                  )}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {showMaxAttempts && (
            <Field>
              <Label htmlFor="maxAttempts">
                {t("admin.examProfilePages.fields.maxAttempts")}
              </Label>
              <Input
                id="maxAttempts"
                type="number"
                min={1}
                value={form.maxAttempts}
                onChange={(e) =>
                  update({ maxAttempts: Number(e.target.value) })
                }
              />
            </Field>
          )}
        </FieldRow>
      </FormSection>

      <FormSection title={t("admin.examProfilePages.sections.scoring")}>
        <FieldRow>
          <Field>
            <Label htmlFor="scoreStrategy">
              {t("admin.examProfilePages.fields.scoreStrategy")}
            </Label>
            <Select
              value={form.scoreStrategy}
              onValueChange={(v) =>
                update({
                  scoreStrategy: v as ProfileFormState["scoreStrategy"],
                })
              }
            >
              <SelectTrigger id="scoreStrategy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="highest">
                  {t("admin.examProfilePages.enumLabels.scoreStrategyHighest")}
                </SelectItem>
                <SelectItem value="latest">
                  {t("admin.examProfilePages.enumLabels.scoreStrategyLatest")}
                </SelectItem>
                <SelectItem value="first">
                  {t("admin.examProfilePages.enumLabels.scoreStrategyFirst")}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <Label htmlFor="resultPublicationMode">
              {t("admin.examProfilePages.fields.resultPublicationMode")}
            </Label>
            <Select
              value={form.resultPublicationMode}
              onValueChange={(v) =>
                update({
                  resultPublicationMode:
                    v as ProfileFormState["resultPublicationMode"],
                })
              }
            >
              <SelectTrigger id="resultPublicationMode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">
                  {t(
                    "admin.examProfilePages.enumLabels.resultPublicationImmediate",
                  )}
                </SelectItem>
                <SelectItem value="after_grading">
                  {t(
                    "admin.examProfilePages.enumLabels.resultPublicationAfterGrading",
                  )}
                </SelectItem>
                <SelectItem value="manual">
                  {t(
                    "admin.examProfilePages.enumLabels.resultPublicationManual",
                  )}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </FieldRow>
      </FormSection>

      <FormSection
        title={t("admin.examProfilePages.sections.interruption")}
        description={t("admin.examProfilePages.interruptionHint")}
      >
        <FieldGroup>
          <Field>
            <Label htmlFor="interruptionTimePolicy">
              {t("admin.examProfilePages.fields.interruptionTimePolicy")}
            </Label>
            <Select
              value={form.interruptionTimePolicy}
              onValueChange={(v) =>
                updateInterruptionPolicy(
                  v as ProfileFormState["interruptionTimePolicy"],
                )
              }
            >
              <SelectTrigger
                id="interruptionTimePolicy"
                aria-label={t(
                  "admin.examProfilePages.fields.interruptionTimePolicy",
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="strict">
                  {t("admin.examProfilePages.enumLabels.interruptionStrict")}
                </SelectItem>
                <SelectItem value="bounded_grace">
                  {t(
                    "admin.examProfilePages.enumLabels.interruptionBoundedGrace",
                  )}
                </SelectItem>
                <SelectItem value="operator_incident">
                  {t(
                    "admin.examProfilePages.enumLabels.interruptionOperatorIncident",
                  )}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {showGraceCaps && (
            <FieldRow>
              <Field>
                <Label htmlFor="interruptionGracePerIncidentSeconds">
                  {t(
                    "admin.examProfilePages.fields.interruptionGracePerIncidentSeconds",
                  )}
                </Label>
                <Input
                  id="interruptionGracePerIncidentSeconds"
                  type="number"
                  min={1}
                  value={form.interruptionGracePerIncidentSeconds ?? ""}
                  onChange={(e) =>
                    update({
                      interruptionGracePerIncidentSeconds: parseNullableMinutes(
                        e.target.value,
                      ),
                    })
                  }
                />
                <FieldError>
                  {fieldErrors.interruptionGracePerIncidentSeconds}
                </FieldError>
              </Field>
              <Field>
                <Label htmlFor="interruptionGracePerAttemptSeconds">
                  {t(
                    "admin.examProfilePages.fields.interruptionGracePerAttemptSeconds",
                  )}
                </Label>
                <Input
                  id="interruptionGracePerAttemptSeconds"
                  type="number"
                  min={1}
                  value={form.interruptionGracePerAttemptSeconds ?? ""}
                  onChange={(e) =>
                    update({
                      interruptionGracePerAttemptSeconds: parseNullableMinutes(
                        e.target.value,
                      ),
                    })
                  }
                />
                <FieldError>
                  {fieldErrors.interruptionGracePerAttemptSeconds}
                </FieldError>
              </Field>
            </FieldRow>
          )}
        </FieldGroup>
      </FormSection>

      <Separator />

      <FormSection title={t("admin.examProfilePages.sections.basic")}>
        <FieldGroup>
          <Field>
            <Label htmlFor="name">
              {t("admin.examProfilePages.fields.name")}
            </Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder={t("admin.examProfilePages.fields.namePlaceholder")}
            />
            <FieldError>{fieldErrors.name}</FieldError>
          </Field>
          <Field>
            <Label htmlFor="description">
              {t("admin.examProfilePages.fields.description")}
            </Label>
            <Input
              id="description"
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder={t(
                "admin.examProfilePages.fields.descriptionPlaceholder",
              )}
            />
          </Field>
        </FieldGroup>
      </FormSection>

      {saveError && <InlineErrorBanner>{saveError}</InlineErrorBanner>}
      <div className="flex justify-end gap-3 pt-2">
        <Button
          variant="outline"
          onClick={() => void navigate("/admin/exam-profiles")}
        >
          {t("admin.examProfilePages.actions.cancel")}
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={saving}>
          {saving
            ? t("admin.examProfilePages.actions.saving")
            : t("admin.examProfilePages.actions.save")}
        </Button>
      </div>

      <Dialog open={starterDialogOpen} onOpenChange={setStarterDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("admin.examProfilePages.starterDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.examProfilePages.starterDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {STARTER_PROFILE_RECIPES.map((recipe) => {
              // Recipe keys are snake_case; i18n catalog uses camelCase.
              const i18nKey = recipe.key.replace(/_([a-z])/g, (_, c) =>
                c.toUpperCase(),
              );
              return (
                <div
                  key={recipe.key}
                  data-starter-recipe={recipe.key}
                  className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="type-section-title">
                      {t(`admin.starterProfiles.${i18nKey}.name` as never)}
                    </p>
                    <p className="type-secondary">
                      {t(
                        `admin.starterProfiles.${i18nKey}.description` as never,
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setForm(formFromRecipe(recipe.key));
                      setStarterDialogOpen(false);
                    }}
                  >
                    {t("admin.examProfilePages.starterUse")}
                  </Button>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setStarterDialogOpen(false)}
            >
              {t("admin.examProfilePages.starterCancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
