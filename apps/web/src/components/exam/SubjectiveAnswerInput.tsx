import type { ChangeEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type SubjectiveAnswerInputProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  maxLength?: number;
  minRows?: number;
  readOnly?: boolean;
  error?: string;
  className?: string;
};

export function SubjectiveAnswerInput({
  value,
  onChange,
  label = "主观题答案",
  placeholder = "请输入答案",
  maxLength,
  minRows = 8,
  readOnly = false,
  error,
  className,
}: SubjectiveAnswerInputProps) {
  const inputId = "subjective-answer";
  const helpId = `${inputId}-help`;
  const countLabel = maxLength
    ? `${value.length} / ${maxLength}`
    : `${value.length} 字`;

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="text-sm font-medium">
          {label}
        </label>
        <span className="text-xs text-muted-foreground">{countLabel}</span>
      </div>
      <Textarea
        id={inputId}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        maxLength={maxLength}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? helpId : undefined}
        className="resize-y"
        style={{ minHeight: `${minRows * 1.5}rem` }}
      />
      {error && (
        <p id={helpId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
