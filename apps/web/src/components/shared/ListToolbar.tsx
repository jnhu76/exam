import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ListToolbarProps = {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
  className?: string;
  "aria-label"?: string;
};

export function ListToolbar({
  search,
  filters,
  actions,
  summary,
  className,
  "aria-label": ariaLabel = "列表工具栏",
}: ListToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-3 lg:flex-row lg:items-center lg:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        {search && <div className="min-w-0 flex-1">{search}</div>}
        {filters && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {filters}
          </div>
        )}
      </div>
      {(summary || actions) && (
        <div className="flex shrink-0 items-center justify-between gap-2 lg:justify-end">
          {summary && (
            <div className="text-sm text-muted-foreground">{summary}</div>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
    </div>
  );
}
