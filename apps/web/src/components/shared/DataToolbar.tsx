import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Horizontal toolbar for data table pages, providing slots for filter children,
 * action buttons, and a summary line with responsive layout.
 */
export function DataToolbar({
  children,
  actions,
  summary,
  "aria-label": ariaLabel = "数据工具栏",
  className,
}: {
  children?: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
  "aria-label"?: string;
  className?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        {children}
      </div>
      {(summary || actions) && (
        <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
          {summary && (
            <div className="text-sm text-muted-foreground">{summary}</div>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
