import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldError } from "@/components/shared/FieldError";
import { FieldGroup, Field, FieldRow } from "@/components/shared/FieldGroup";
import { FormSection } from "@/components/shared/FormSection";
import { isOverridden } from "@/lib/wizardPolicyPreview";
import type { WizardProfileLike } from "@/lib/wizardPolicyPreview";
import type { ExamProfilePolicyDefaults } from "@exam/domain";
import type { WizardState } from "./wizardState";
import { WIZARD_CODE_DEFAULTS } from "./wizardState";

/**
 * Step 2 — exam policy fields. Renders the 10 profile-safe, runtime-enforced
 * dimensions ONLY. Latent control flags (shuffle / tab-detect / copy-paste /
 * queue / IP / lockdown) are deliberately NOT shown: they are not enforced
 * today and must not be marketed as exam controls in the new product entry.
 *
 * When a profile is selected, each field shows a provenance badge
 * (来自「模板名」 / 已自定义) and a 恢复模板值 button to drop the override.
 */
export function WizardPolicyFields({
  state,
  selectedProfile,
  fieldErrors,
  setOverride,
  clearOverride,
}: {
  state: WizardState;
  selectedProfile: WizardProfileLike | null;
  fieldErrors: Record<string, string>;
  setOverride: (
    field: keyof ExamProfilePolicyDefaults,
    value: ExamProfilePolicyDefaults[keyof ExamProfilePolicyDefaults] | null,
  ) => void;
  clearOverride: (field: keyof ExamProfilePolicyDefaults) => void;
}) {
  const { t } = useTranslation();
  const profileName = selectedProfile?.name ?? null;

  // Resolved value for each field: explicit override (incl. null) > profile > code default.
  function resolved<T extends keyof ExamProfilePolicyDefaults>(
    field: T,
  ): ExamProfilePolicyDefaults[T] {
    if (Object.prototype.hasOwnProperty.call(state.overrides, field)) {
      return state.overrides[field] as ExamProfilePolicyDefaults[T];
    }
    if (selectedProfile) return selectedProfile.defaults[field];
    return WIZARD_CODE_DEFAULTS[field];
  }

  function sourceBadge(field: keyof ExamProfilePolicyDefaults) {
    if (!selectedProfile) return null;
    if (isOverridden(state.overrides, field)) {
      return (
        <Badge variant="outline" className="font-normal">
          {t("admin.examWizard.profileSource.customized")}
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="font-normal">
        {t("admin.examWizard.profileSource.fromValue", {
          name: profileName ?? "",
        })}
      </Badge>
    );
  }

  function resetBtn(field: keyof ExamProfilePolicyDefaults) {
    if (!selectedProfile || !isOverridden(state.overrides, field)) return null;
    return (
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={() => clearOverride(field)}
      >
        {t("admin.examWizard.resetToProfile")}
      </Button>
    );
  }

  const retake = resolved("retakePolicy");
  const interruption = resolved("interruptionTimePolicy");
  const timingMode = resolved("timingMode");
  const showMaxAttempts = retake === "max_attempts";
  const showGraceCaps = interruption === "bounded_grace";

  return (
    <FieldGroup>
      <FormSection title={t("admin.examWizard.sections.duration")}>
        <FieldRow>
          <Field>
            <div className="flex items-center justify-between">
              <Label htmlFor="wiz-timingMode">
                {t("admin.forms.exam.timingMode")}
              </Label>
              {sourceBadge("timingMode")}
            </div>
            <Select
              value={timingMode}
              onValueChange={(v) => {
                if (v === "timed_window") {
                  // timed_window needs a duration — drop any null override so
                  // the profile/code default (or a fresh entry) applies.
                  clearOverride("durationMinutes");
                } else {
                  // deadline/untimed carry NO personal duration; null is the
                  // semantic value and overwrites any stale override.
                  setOverride("durationMinutes", null);
                }
                setOverride(
                  "timingMode",
                  v as ExamProfilePolicyDefaults["timingMode"],
                );
              }}
            >
              <SelectTrigger data-testid="wiz-timing-mode-select">
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
            <p className="text-xs text-muted-foreground">
              {t(`admin.forms.exam.timingModeHint.${timingMode}`)}
            </p>
            {resetBtn("timingMode")}
          </Field>
        </FieldRow>
        {timingMode === "timed_window" && (
          <FieldRow>
            <Field>
              <div className="flex items-center justify-between">
                <Label htmlFor="wiz-durationMinutes">
                  {t("admin.examWizard.fields.durationMinutes")}
                </Label>
                {sourceBadge("durationMinutes")}
              </div>
              <Input
                id="wiz-durationMinutes"
                type="number"
                min={1}
                value={resolved("durationMinutes") ?? ""}
                onChange={(e) => {
                  // Empty input reverts to inheritance — never store 0.
                  if (e.target.value === "") {
                    clearOverride("durationMinutes");
                  } else {
                    setOverride("durationMinutes", Number(e.target.value));
                  }
                }}
              />
              <FieldError>{fieldErrors.durationMinutes}</FieldError>
              {resetBtn("durationMinutes")}
            </Field>
          </FieldRow>
        )}
      </FormSection>

      <FormSection title={t("admin.examWizard.sections.entrySubmit")}>
        <FieldRow>
          <Field>
            <div className="flex items-center justify-between">
              <Label htmlFor="wiz-latestStart">
                {t("admin.examWizard.fields.latestStartOffsetMinutes")}
              </Label>
              {sourceBadge("latestStartOffsetMinutes")}
            </div>
            <Input
              id="wiz-latestStart"
              type="number"
              min={0}
              value={resolved("latestStartOffsetMinutes") ?? ""}
              onChange={(e) =>
                setOverride(
                  "latestStartOffsetMinutes",
                  e.target.value === "" || Number.isNaN(Number(e.target.value))
                    ? null
                    : Number(e.target.value),
                )
              }
              placeholder={t("admin.examWizard.fields.noLimitPlaceholder")}
            />
            <FieldError>{fieldErrors.latestStartOffsetMinutes}</FieldError>
            {resetBtn("latestStartOffsetMinutes")}
          </Field>
          <Field>
            <div className="flex items-center justify-between">
              <Label htmlFor="wiz-minSubmit">
                {t("admin.examWizard.fields.minSubmitAfterStartMinutes")}
              </Label>
              {sourceBadge("minSubmitAfterStartMinutes")}
            </div>
            <Input
              id="wiz-minSubmit"
              type="number"
              min={0}
              value={resolved("minSubmitAfterStartMinutes") ?? ""}
              onChange={(e) =>
                setOverride(
                  "minSubmitAfterStartMinutes",
                  e.target.value === "" || Number.isNaN(Number(e.target.value))
                    ? null
                    : Number(e.target.value),
                )
              }
              placeholder={t("admin.examWizard.fields.noLimitPlaceholder")}
            />
            <FieldError>{fieldErrors.minSubmitAfterStartMinutes}</FieldError>
            {resetBtn("minSubmitAfterStartMinutes")}
          </Field>
        </FieldRow>
      </FormSection>

      <FormSection title={t("admin.examWizard.sections.retakeScoring")}>
        <FieldRow>
          <Field>
            <div className="flex items-center justify-between">
              <Label htmlFor="wiz-retakePolicy">
                {t("admin.examWizard.fields.retakePolicy")}
              </Label>
              {sourceBadge("retakePolicy")}
            </div>
            <Select
              value={resolved("retakePolicy")}
              onValueChange={(v) =>
                setOverride(
                  "retakePolicy",
                  v as ExamProfilePolicyDefaults["retakePolicy"],
                )
              }
            >
              <SelectTrigger
                id="wiz-retakePolicy"
                aria-label={t("admin.examWizard.fields.retakePolicy")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unlimited">
                  {t("admin.examWizard.enumLabels.retakePolicyUnlimited")}
                </SelectItem>
                <SelectItem value="max_attempts">
                  {t("admin.examWizard.enumLabels.retakePolicyMaxAttempts")}
                </SelectItem>
                <SelectItem value="pass_then_stop">
                  {t("admin.examWizard.enumLabels.retakePolicyPassThenStop")}
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldError>{fieldErrors.retakePolicy}</FieldError>
            {resetBtn("retakePolicy")}
          </Field>
          {showMaxAttempts && (
            <Field>
              <div className="flex items-center justify-between">
                <Label htmlFor="wiz-maxAttempts">
                  {t("admin.examWizard.fields.maxAttempts")}
                </Label>
                {sourceBadge("maxAttempts")}
              </div>
              <Input
                id="wiz-maxAttempts"
                type="number"
                min={1}
                value={resolved("maxAttempts")}
                onChange={(e) => {
                  // Empty input reverts to inheritance — never store 0.
                  if (e.target.value === "") {
                    clearOverride("maxAttempts");
                  } else {
                    setOverride("maxAttempts", Number(e.target.value));
                  }
                }}
              />
              <FieldError>{fieldErrors.maxAttempts}</FieldError>
              {resetBtn("maxAttempts")}
            </Field>
          )}
        </FieldRow>
        <FieldRow>
          <Field>
            <div className="flex items-center justify-between">
              <Label htmlFor="wiz-scoreStrategy">
                {t("admin.examWizard.fields.scoreStrategy")}
              </Label>
              {sourceBadge("scoreStrategy")}
            </div>
            <Select
              value={resolved("scoreStrategy")}
              onValueChange={(v) =>
                setOverride(
                  "scoreStrategy",
                  v as ExamProfilePolicyDefaults["scoreStrategy"],
                )
              }
            >
              <SelectTrigger
                id="wiz-scoreStrategy"
                aria-label={t("admin.examWizard.fields.scoreStrategy")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="highest">
                  {t("admin.examWizard.enumLabels.scoreStrategyHighest")}
                </SelectItem>
                <SelectItem value="latest">
                  {t("admin.examWizard.enumLabels.scoreStrategyLatest")}
                </SelectItem>
                <SelectItem value="first">
                  {t("admin.examWizard.enumLabels.scoreStrategyFirst")}
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldError>{fieldErrors.scoreStrategy}</FieldError>
            {resetBtn("scoreStrategy")}
          </Field>
          <Field>
            <div className="flex items-center justify-between">
              <Label htmlFor="wiz-resultPublication">
                {t("admin.examWizard.fields.resultPublicationMode")}
              </Label>
              {sourceBadge("resultPublicationMode")}
            </div>
            <Select
              value={resolved("resultPublicationMode")}
              onValueChange={(v) =>
                setOverride(
                  "resultPublicationMode",
                  v as ExamProfilePolicyDefaults["resultPublicationMode"],
                )
              }
            >
              <SelectTrigger
                id="wiz-resultPublication"
                aria-label={t("admin.examWizard.fields.resultPublicationMode")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">
                  {t("admin.examWizard.enumLabels.resultPublicationImmediate")}
                </SelectItem>
                <SelectItem value="after_grading">
                  {t(
                    "admin.examWizard.enumLabels.resultPublicationAfterGrading",
                  )}
                </SelectItem>
                <SelectItem value="manual">
                  {t("admin.examWizard.enumLabels.resultPublicationManual")}
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldError>{fieldErrors.resultPublicationMode}</FieldError>
            {resetBtn("resultPublicationMode")}
          </Field>
        </FieldRow>
      </FormSection>

      <FormSection title={t("admin.examWizard.sections.interruption")}>
        <FieldGroup>
          <Field>
            <div className="flex items-center justify-between">
              <Label htmlFor="wiz-interruptionPolicy">
                {t("admin.examWizard.fields.interruptionTimePolicy")}
              </Label>
              {sourceBadge("interruptionTimePolicy")}
            </div>
            <Select
              value={resolved("interruptionTimePolicy")}
              onValueChange={(v) =>
                setOverride(
                  "interruptionTimePolicy",
                  v as ExamProfilePolicyDefaults["interruptionTimePolicy"],
                )
              }
            >
              <SelectTrigger
                id="wiz-interruptionPolicy"
                aria-label={t("admin.examWizard.fields.interruptionTimePolicy")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="strict">
                  {t("admin.examWizard.enumLabels.interruptionStrict")}
                </SelectItem>
                <SelectItem value="bounded_grace">
                  {t("admin.examWizard.enumLabels.interruptionBoundedGrace")}
                </SelectItem>
                <SelectItem value="operator_incident">
                  {t(
                    "admin.examWizard.enumLabels.interruptionOperatorIncident",
                  )}
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldError>{fieldErrors.interruptionTimePolicy}</FieldError>
            {resetBtn("interruptionTimePolicy")}
          </Field>
          {showGraceCaps && (
            <FieldRow>
              <Field>
                <div className="flex items-center justify-between">
                  <Label htmlFor="wiz-graceIncident">
                    {t(
                      "admin.examWizard.fields.interruptionGracePerIncidentSeconds",
                    )}
                  </Label>
                  {sourceBadge("interruptionGracePerIncidentSeconds")}
                </div>
                <Input
                  id="wiz-graceIncident"
                  type="number"
                  min={1}
                  value={resolved("interruptionGracePerIncidentSeconds") ?? ""}
                  onChange={(e) =>
                    setOverride(
                      "interruptionGracePerIncidentSeconds",
                      e.target.value === "" ||
                        Number.isNaN(Number(e.target.value))
                        ? null
                        : Number(e.target.value),
                    )
                  }
                />
                <FieldError>
                  {fieldErrors.interruptionGracePerIncidentSeconds}
                </FieldError>
                {resetBtn("interruptionGracePerIncidentSeconds")}
              </Field>
              <Field>
                <div className="flex items-center justify-between">
                  <Label htmlFor="wiz-graceAttempt">
                    {t(
                      "admin.examWizard.fields.interruptionGracePerAttemptSeconds",
                    )}
                  </Label>
                  {sourceBadge("interruptionGracePerAttemptSeconds")}
                </div>
                <Input
                  id="wiz-graceAttempt"
                  type="number"
                  min={1}
                  value={resolved("interruptionGracePerAttemptSeconds") ?? ""}
                  onChange={(e) =>
                    setOverride(
                      "interruptionGracePerAttemptSeconds",
                      e.target.value === "" ||
                        Number.isNaN(Number(e.target.value))
                        ? null
                        : Number(e.target.value),
                    )
                  }
                />
                <FieldError>
                  {fieldErrors.interruptionGracePerAttemptSeconds}
                </FieldError>
                {resetBtn("interruptionGracePerAttemptSeconds")}
              </Field>
            </FieldRow>
          )}
        </FieldGroup>
      </FormSection>
    </FieldGroup>
  );
}
