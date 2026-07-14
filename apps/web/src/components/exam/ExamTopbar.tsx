import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Props for the ExamTopbar component. */
type ExamTopbarProps = {
  title: string;
  remainingTime: ReactNode;
  saveStatus: ReactNode;
  networkStatus: ReactNode;
  className?: string;
};

/**
 * Top navigation bar for the exam runtime, displaying the exam title,
 * remaining time badge, save status, and network status indicators.
 */
export function ExamTopbar({
  title,
  remainingTime,
  saveStatus,
  networkStatus,
  className,
}: ExamTopbarProps) {
  const { t } = useTranslation();
  return (
    <header
      className={cn(
        "flex flex-col gap-3 border-b bg-background px-4 py-3 lg:flex-row lg:items-center lg:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">
          {t("candidateRuntime.header.currentExam")}
        </div>
        <h1 className="truncate text-lg font-medium text-foreground">
          {title}
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1.5">
          <span className="text-muted-foreground">
            {t("candidateRuntime.header.remaining")}
          </span>
          <span className="font-mono tabular-nums">{remainingTime}</span>
        </Badge>
        <div>{saveStatus}</div>
        <div>{networkStatus}</div>
      </div>
    </header>
  );
}
