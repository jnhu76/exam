import { useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useOverflowObservation } from "@/hooks/useOverflowObservation";
import { cn } from "@/lib/utils";
import type { DataTableMinWidth } from "@/components/shared/DataTableShell";

/**
 * DataWorkbench — a single, continuous, compact data shell
 * (UI-TABLE-KOI-COMPACT-1 — "Koi Compact Data Workbench").
 *
 * Unlike DataTableShell pages (which render toolbar / table / pagination as
 * separated stacked surfaces), the workbench renders ONE bordered surface whose
 * toolbar → table header → table body → footer are regions of the same shell.
 * It is the visual authority for the Question Management page; other admin
 * pages keep using DataTableShell directly.
 *
 * Composition (all regions stay mounted; only the table body swaps):
 *
 *   <DataWorkbench>
 *   ├─ <DataWorkbenchToolbar>   // the shell's quiet TOP region (no own card)
 *   ├─ desktop table            // the viewport's scrollable table region
 *   │    (admin-table-shell)    //   (hidden below lg)
 *   ├─ mobile list              // a separate region (hidden at lg+), NOT inside
 *   │                           //   the admin-table-shell scroll region
 *   └─ <DataWorkbenchFooter>    // count + pagination, the shell's BOTTOM region
 *
 * The desktop table lives in the scroll region that emits
 * data-slot="admin-table-shell" (so role-based table/recipes.css +
 * workbench.css keep applying). The mobile list is a SEPARATE region of the
 * shell, separate from the desktop table region, so a query scoped to
 * [data-slot="admin-table-shell"] matches only desktop table content.
 *
 * Overflow facts come from the shared useOverflowObservation hook (the single
 * measurement authority), so the viewport still owns local horizontal scroll
 * and surfaces the same fade/hint affordances as DataTableShell, gated by
 * container overflow facts only.
 */
export function DataWorkbench({
  toolbar,
  desktopTable,
  mobileList,
  footer,
  className,
  contentClassName,
  minTableWidth = "standard",
}: {
  /** The toolbar band (search + filters + actions). Rendered as the shell top. */
  toolbar?: ReactNode;
  /** The desktop DataTable (rendered inside the admin-table-shell scroll region,
   * hidden below lg). */
  desktopTable?: ReactNode;
  /** The mobile MobileRecordList. Rendered as a separate region (hidden at lg+),
   * NOT inside the admin-table-shell scroll region. */
  mobileList?: ReactNode;
  /** The footer band (count + pagination). Rendered as the shell bottom. */
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  minTableWidth?: DataTableMinWidth;
}) {
  const { t } = useTranslation();
  const shellId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const overflow = useOverflowObservation(scrollRef);

  const titleId = `${shellId}-label`;

  return (
    <section
      aria-labelledby={titleId}
      data-slot="data-workbench"
      className={cn("surface-content overflow-hidden", className)}
    >
      <span id={titleId} className="sr-only">
        {t("common.workbench.regionLabel")}
      </span>
      {toolbar}
      <div data-slot="table-scroll-frame" className="relative min-w-0">
        <div
          ref={scrollRef}
          data-slot="admin-table-shell"
          data-table-min-width={minTableWidth}
          data-overflow-owner="local"
          data-overflowing={String(overflow.overflowing)}
          data-scroll-start={String(overflow.atStart)}
          data-scroll-end={String(overflow.atEnd)}
          className={cn("min-w-0 overflow-x-auto", contentClassName)}
        >
          {/* Desktop table — hidden below lg; admin-table-shell owns its grid. */}
          <div className="hidden lg:block">{desktopTable}</div>
        </div>
        {overflow.overflowing && !overflow.atStart && (
          <span data-slot="table-scroll-fade-left" aria-hidden="true" />
        )}
        {overflow.overflowing && !overflow.atEnd && (
          <span data-slot="table-scroll-fade-right" aria-hidden="true" />
        )}
        {overflow.overflowing && (
          <div
            data-slot="table-scroll-hint"
            data-scroll-direction={
              overflow.atStart ? "right" : overflow.atEnd ? "left" : "both"
            }
            className={cn(
              "pointer-events-none flex h-6 items-center border-t border-border-divider bg-surface-soft px-3 text-xs text-text-muted",
              overflow.atStart
                ? "justify-end"
                : overflow.atEnd
                  ? "justify-start"
                  : "justify-center",
            )}
          >
            {t(
              overflow.atStart
                ? "common.table.scrollHintRight"
                : overflow.atEnd
                  ? "common.table.scrollHintLeft"
                  : "common.table.scrollHintBoth",
            )}
          </div>
        )}
      </div>
      {/* Mobile cards — a separate region (NOT inside admin-table-shell), so a
          query scoped to admin-table-shell matches only desktop table content. */}
      <div className="lg:hidden">{mobileList}</div>
      {footer}
    </section>
  );
}

/**
 * The workbench toolbar band. A passthrough wrapper that marks its child (a
 * ListToolbar) as the shell's top region so workbench.css can flatten its card
 * treatment into the continuous shell.
 */
export function DataWorkbenchToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="workbench-toolbar" className={cn(className)}>
      {children}
    </div>
  );
}

/**
 * The workbench footer band. Owns the count summary + pagination as the
 * shell's bottom region. Use this instead of rendering DataTablePagination as
 * a separate floating element.
 */
export function DataWorkbenchFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="workbench-footer"
      className={cn(
        "flex flex-col gap-3 px-3 py-2 type-secondary sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}
