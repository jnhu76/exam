import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Props for the QuestionHeader component. */
type QuestionHeaderProps = {
  number: number;
  typeLabel: string;
  score: number;
  description?: ReactNode;
  meta?: ReactNode;
  className?: string;
};

/**
 * Displays the question number, type badge, score badge, and optional
 * description/meta line above the question content area.
 */
export function QuestionHeader({
  number,
  typeLabel,
  score,
  description,
  meta,
  className,
}: QuestionHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">
            {t("candidateRuntime.question.number", { number })}
          </h2>
          <Badge variant="secondary">{typeLabel}</Badge>
          <Badge variant="outline">
            {t("candidateRuntime.question.score", { score })}
          </Badge>
        </div>
        {meta && <div className="text-sm text-muted-foreground">{meta}</div>}
      </div>
      {description && (
        <div className="text-sm text-muted-foreground">{description}</div>
      )}
    </div>
  );
}
