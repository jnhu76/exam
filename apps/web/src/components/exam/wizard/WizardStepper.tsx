import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { WizardStep } from "./wizardState";

const STEP_KEYS = [
  "basic",
  "policy",
  "questions",
  "schedule",
  "review",
] as const;

/**
 * Accessible step indicator for the exam-creation wizard. Steps are buttons
 * (keyboard-reachable); the current step carries aria-current="step". This is
 * a plain composition over Button — NOT a generic stepper framework.
 *
 * Forward validation must not be bypassable: FUTURE steps are disabled —
 * reaching them requires the 下一步 flow, which runs each step's validation
 * gate. Past/current steps stay clickable so the user can go back and edit.
 */
export function WizardStepper({
  current,
  onNavigate,
}: {
  current: WizardStep;
  onNavigate: (step: WizardStep) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("admin.examWizard.stepperLabel")}>
      <ol className="flex flex-wrap items-center gap-2">
        {STEP_KEYS.map((key, idx) => {
          const step = (idx + 1) as WizardStep;
          const isCurrent = step === current;
          const isPast = step < current;
          const isFuture = step > current;
          return (
            <li key={key} className="flex items-center gap-2">
              <Button
                type="button"
                variant={isCurrent ? "default" : "outline"}
                size="sm"
                disabled={isFuture}
                aria-current={isCurrent ? "step" : undefined}
                // Explicit label: the visible number + label would otherwise
                // concatenate without a separator for assistive technology.
                aria-label={`${step} ${t(`admin.examWizard.steps.${key}`)}`}
                onClick={() => onNavigate(step)}
                className={cn(isPast && !isCurrent && "opacity-70")}
              >
                <span className="tabular-nums">{step}</span>
                <span>{t(`admin.examWizard.steps.${key}`)}</span>
              </Button>
              {idx < STEP_KEYS.length - 1 && (
                <span aria-hidden="true" className="text-muted-foreground">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("admin.examWizard.stepOf", {
          current,
          total: STEP_KEYS.length,
        })}
      </p>
    </nav>
  );
}
