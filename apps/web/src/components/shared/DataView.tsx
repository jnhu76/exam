import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * DataView — the orchestrator for a complete data-browsing region.
 *
 * Composition (all regions stay mounted; only their contents swap):
 *
 *   DataView
 *   ├─ toolbar           (DataViewToolbar / ListToolbar — search + filters + actions)
 *   ├─ desktop table     (hidden below lg)   ┐ mutually exclusive by breakpoint
 *   ├─ mobile list       (hidden at lg and up) ┘
 *   └─ pagination        (always mounted)
 *
 * Why this shape: previously each page hand-assembled toolbar + DataTableShell
 * + Table + pagination, and the shell + pagination were swapped in/out on
 * filter changes, throwing the block height between an empty card and the full
 * table — visible jitter. DataView keeps the outer structure (toolbar → table
 * shell → pagination) ALWAYS mounted; only the table body / card list content
 * swaps. The toolbar has a stable min-height so opening a filter dropdown does
 * not shift the search box position.
 *
 * This is a thin orchestrator, NOT a JSON-schema data grid. Pages still own
 * their column defs, fetch state, and row actions; DataView only owns the
 * region skeleton + responsive desktop/mobile switch.
 */
export function DataView({
  toolbar,
  desktopTable,
  mobileList,
  pagination,
  className,
}: {
  /** The toolbar region (search + filters + actions). Always mounted. */
  toolbar?: ReactNode;
  /** The desktop DataTable (rendered inside a DataTableShell). Hidden < lg. */
  desktopTable?: ReactNode;
  /** The mobile MobileRecordList. Hidden >= lg. */
  mobileList?: ReactNode;
  /** Pagination region. Always mounted so it does not jump in/out. */
  pagination?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {toolbar}
      {/* Desktop table — always mounted (shell owns the card + scroll frame). */}
      <div className="hidden lg:block">{desktopTable}</div>
      {/* Mobile cards — shown only below the desktop breakpoint. */}
      <div className="lg:hidden">{mobileList}</div>
      {pagination}
    </div>
  );
}
