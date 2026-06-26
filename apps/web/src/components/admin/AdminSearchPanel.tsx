import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AdminSearchPanelProps {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function AdminSearchPanel({
  children,
  actions,
  className,
}: AdminSearchPanelProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 sm:flex-row sm:items-end sm:flex-wrap",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        {children}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
