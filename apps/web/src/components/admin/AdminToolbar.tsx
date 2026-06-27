import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AdminToolbarProps {
  children?: ReactNode;
  actions?: ReactNode;
  summary?: string;
  className?: string;
}

export function AdminToolbar({
  children,
  actions,
  summary,
  className,
}: AdminToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
        {children}
      </div>
      {(summary || actions) && (
        <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
          {summary && (
            <span className="text-xs text-muted-foreground">{summary}</span>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
