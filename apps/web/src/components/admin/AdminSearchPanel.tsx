import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AdminSearchPanelProps {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Inline search/filter panel (koi-style): white card, 8px radius, subtle search
 * tint background, wraps fields left-to-right and action buttons right.
 */
export function AdminSearchPanel({
  children,
  actions,
  className,
}: AdminSearchPanelProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[var(--admin-radius)] border border-admin-border bg-admin-search p-4 sm:flex-row sm:items-end sm:flex-wrap",
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
