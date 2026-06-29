import { type ChangeEvent, useId } from "react";
import { useTranslation } from "react-i18next";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Props for the SubjectiveAnswerInput component. */
type SubjectiveAnswerInputProps = {
  value?: string | null;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  maxLength?: number;
  readOnly?: boolean;
  error?: string;
  className?: string;
};

/**
 * Textarea input for subjective (open-ended) questions with label,
 * character count, optional maxLength, and error display.
 */
export function SubjectiveAnswerInput({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  readOnly = false,
  error,
  className,
}: SubjectiveAnswerInputProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const inputId = `${generatedId}-subjective-answer`;
  const helpId = `${inputId}-help`;
  const safeValue = value ?? "";
  const countLabel = maxLength
    ? t("candidateRuntime.answer.subjective.charCountWithMax", {
        count: safeValue.length,
        max: maxLength,
      })
    : t("candidateRuntime.answer.subjective.charCount", {
        count: safeValue.length,
      });

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="text-sm font-medium">
          {label ?? t("candidateRuntime.answer.subjective.label")}
        </label>
        <span className="text-xs text-muted-foreground">{countLabel}</span>
      </div>
      <Textarea
        id={inputId}
        value={safeValue}
        onChange={handleChange}
        placeholder={
          placeholder ?? t("candidateRuntime.answer.subjective.placeholder")
        }
        maxLength={maxLength}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? helpId : undefined}
        className="min-h-48 resize-y"
      />
      {error && (
        <p id={helpId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
