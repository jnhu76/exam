import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ExamTopbarProps = {
  title: string;
  remainingTime: ReactNode;
  saveStatus: ReactNode;
  networkStatus: ReactNode;
  className?: string;
};

export function ExamTopbar({
  title,
  remainingTime,
  saveStatus,
  networkStatus,
  className,
}: ExamTopbarProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 border-b bg-background px-4 py-3 lg:flex-row lg:items-center lg:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">
          当前考试
        </div>
        <h1 className="truncate text-lg font-semibold text-foreground">
          {title}
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1.5">
          <span className="text-muted-foreground">剩余</span>
          <span className="font-mono tabular-nums">{remainingTime}</span>
        </Badge>
        <div>{saveStatus}</div>
        <div>{networkStatus}</div>
      </div>
    </header>
  );
}
