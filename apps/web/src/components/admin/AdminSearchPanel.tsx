import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AdminSearchPanelProps {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Inline search/filter toolbar (Wegent list-toolbar semantic): borderless,
 * transparent, gap-based flex layout. Intended to live INSIDE an AdminTableShell
 * (list-card) as the card's top toolbar, so search and table share one card
 * rhythm — NOT a standalone gray box. Use `className` to add an inner divider
 * (e.g. "border-b border-border") when nested in a card.
 */
export function AdminSearchPanel({
  children,
  actions,
  className,
}: AdminSearchPanelProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:flex-wrap",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
        {children}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
