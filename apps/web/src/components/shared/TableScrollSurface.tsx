import { createContext, useContext, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useOverflowObservation } from "@/hooks/useOverflowObservation";
import { cn } from "@/lib/utils";
import { ResponsiveRepresentation } from "@/components/shared/ResponsiveRepresentation";
import {
  ARCHETYPE_TIER_BOUNDS,
  negotiateTier,
  type TableArchetype,
} from "@/table/tableTiers";

/**
 * The width intent a composition declares for the table inside it
 * (issue 601 Phase F convergence). It is NOT an archetype property: the
 * archetype names the semantic table kind (management-list, log-diagnostic,
 * detail-comparison, embedded-picker), while the width intent belongs to
 * whoever composes the surface.
 *
 *   fill      — the table fills the region it was given, growing up to the
 *               table-level expansion cap. Ordinary page data views, the
 *               exam-edit inline selected-question panel and the import
 *               preview all fill.
 *   intrinsic — the table renders at its preferred width (cap = 1) inside
 *               whatever container it has; the embedded question-picker dialog
 *               is the production case.
 */
export type TableWidthMode = "fill" | "intrinsic";

/**
 * The measured geometry one shell publishes to the column allocator
 * (issue 601 Phase F). `availableWidth` is the scroll region's EXACT content-box
 * width (fractional — the space a table may occupy before the region
 * overflows; the allocator floors it). `widthMode` is the composition's width
 * intent — the allocator never guesses it.
 */
export interface TableAllocationScope {
  availableWidth: number;
  widthMode: TableWidthMode;
}

export const TableAllocationContext =
  createContext<TableAllocationScope | null>(null);

/**
 * The allocation scope for governed tables that live OUTSIDE a data-view
 * shell — the dialog question pickers, which render at their preferred width.
 * Measures its own container exactly like the shells' scroll region; pages
 * never use this to escape shell composition (the structural guards keep
 * shell-less governed tables confined to the picker dialogs).
 */
export function TableAllocationRegion({
  children,
  className,
  widthMode = "intrinsic",
}: {
  children: ReactNode;
  className?: string;
  widthMode?: TableWidthMode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const overflow = useOverflowObservation(ref);
  return (
    <div
      ref={ref}
      data-slot="table-allocation-region"
      className={cn("min-w-0", className)}
    >
      <TableAllocationContext.Provider
        value={{ availableWidth: overflow.contentWidth, widthMode }}
      >
        {children}
      </TableAllocationContext.Provider>
    </div>
  );
}

/**
 * TableScrollSurface — the single scroll-region contract shared by
 * DataTableShell and DataWorkbench (issue 601 Phase F ownership convergence).
 *
 * It owns, for BOTH shells:
 *   - the container measurement (useOverflowObservation — facts only) and the
 *     tier negotiation driven by it;
 *   - the column-allocation scope published to the table's colgroup
 *     (see table/columnAllocation.ts — the single sizing authority);
 *   - the local horizontal scroll region, the scroll fades and the hint band;
 *   - the geometry vocabulary on the region element (`data-table-archetype`,
 *     `data-table-tier`, overflow state) — the single carrier both CSS and
 *     runtime probes read, since shells differ in which element carries
 *     `data-slot="admin-table-shell"`.
 *
 * The viewport representation switch (mobile cards vs this surface) is the
 * ResponsiveRepresentation owner's (issue 457): when `mobile` is provided (and the
 * archetype is eligible), the desktop measurement branch below is the
 * responsive owner's desktop region — mobile cards are never descendants of
 * the measurement node.
 *
 * `regionDataSlot` preserves the historical DOM: DataTableShell's region is a
 * plain `table-scroll-region` inside its `admin-table-shell` section, while
 * the workbench's continuous surface marks the region itself as
 * `admin-table-shell` (workbench.css keys on that scope).
 */
export function TableScrollSurface({
  archetype,
  mobile,
  children,
  contentClassName,
  regionDataSlot = "table-scroll-region",
  widthMode = "fill",
}: {
  archetype: TableArchetype;
  /** Mobile card representation; rendered only for eligible archetypes. */
  mobile?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  regionDataSlot?: "table-scroll-region" | "admin-table-shell";
  /** The composition's width intent (see TableWidthMode). */
  widthMode?: TableWidthMode;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const overflow = useOverflowObservation(scrollRef);

  // The negotiated tier is the archetype's density signal on the region
  // (probes + E2E read it); it does not feed a table-width floor — width is
  // the allocator's three-regime rule over the measured box.
  const tier =
    archetype === "embedded-picker"
      ? null
      : negotiateTier(
          overflow.containerWidth,
          ARCHETYPE_TIER_BOUNDS[archetype].min,
          ARCHETYPE_TIER_BOUNDS[archetype].max,
        );
  const scope: TableAllocationScope = {
    availableWidth: overflow.contentWidth,
    widthMode,
  };

  const desktopRegion = (
    <div data-slot="table-scroll-frame" className="relative min-w-0">
      <div
        ref={scrollRef}
        data-slot={regionDataSlot}
        data-table-archetype={archetype}
        {...(tier ? { "data-table-tier": tier } : {})}
        data-overflow-owner="local"
        data-overflowing={String(overflow.overflowing)}
        data-scroll-start={String(overflow.atStart)}
        data-scroll-end={String(overflow.atEnd)}
        className={cn("min-w-0 overflow-x-auto", contentClassName)}
      >
        <TableAllocationContext.Provider value={scope}>
          {children}
        </TableAllocationContext.Provider>
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
  );

  if (mobile === undefined) return desktopRegion;
  return <ResponsiveRepresentation mobile={mobile} desktop={desktopRegion} />;
}
