import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type QuestionHeaderProps = {
  number: number;
  typeLabel: string;
  score: number;
  description?: ReactNode;
  meta?: ReactNode;
  className?: string;
};

export function QuestionHeader({
  number,
  typeLabel,
  score,
  description,
  meta,
  className,
}: QuestionHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">第 {number} 题</h2>
          <Badge variant="secondary">{typeLabel}</Badge>
          <Badge variant="outline">{score} 分</Badge>
        </div>
        {meta && <div className="text-sm text-muted-foreground">{meta}</div>}
      </div>
      {description && (
        <div className="text-sm text-muted-foreground">{description}</div>
      )}
    </div>
  );
}
