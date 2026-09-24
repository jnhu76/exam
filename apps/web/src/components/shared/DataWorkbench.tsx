import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  TableScrollSurface,
  type TableWidthMode,
} from "@/components/shared/TableScrollSurface";
import { isMobileRepresentationAllowed } from "@/components/shared/DataTableShell";
import type { TableArchetype } from "@/table/tableTiers";

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
 *   ├─ TableScrollSurface       // the shared scroll-region contract:
 *   │    ├─ responsive owner    // mobile cards vs desktop measurement branch
 *   │    ├─ table-scroll-frame  // region + allocation scope + fades/hint
 *   │    └─ desktop table
 *   └─ <DataWorkbenchFooter>    // count + pagination, the shell's BOTTOM region
 *
 * The scroll-region contract (measurement, tier negotiation, allocation
 * scope, local scroll, fades/hint) and the viewport representation switch are
 * owned by TableScrollSurface — shared with DataTableShell (issue 601 Phase F);
 * the workbench adds no separate sizing or search behavior. The viewport
 * decides the representation FIRST (issue 457 R2): mobile cards are never
 * descendants of the measurement node.
 */
export function DataWorkbench({
  toolbar,
  desktopTable,
  mobileList,
  footer,
  className,
  archetype = "management-list",
  widthMode = "fill",
}: {
  /** The toolbar band (search + filters + actions). Rendered as the shell top. */
  toolbar?: ReactNode;
  /** The desktop DataTable — the sole content of the scroll region (desktop
   * measurement branch of the responsive owner). */
  desktopTable?: ReactNode;
  /** The mobile MobileRecordList. Rendered as the responsive owner's mobile
   * branch — a sibling of the desktop measurement branch, never inside the
   * measurement node. */
  mobileList?: ReactNode;
  /** The footer band (DataViewFooter, continuous variant). */
  footer?: ReactNode;
  className?: string;
  archetype?: TableArchetype;
  /** The composition's width intent (TableWidthMode). */
  widthMode?: TableWidthMode;
}) {
  const { t } = useTranslation();
  const shellId = useId();

  if (
    import.meta.env.DEV &&
    mobileList !== undefined &&
    !isMobileRepresentationAllowed(archetype, true)
  ) {
    throw new Error(
      `DataWorkbench contract violation: the mobile card slot is a management-list/log-diagnostic mechanism; archetype "${archetype}" keeps horizontal scroll below lg`,
    );
  }

  // Production-safe eligibility (same authority as DataTableShell): only
  // eligible archetypes with an explicit mobileList participate in the CSS
  // viewport switch. Other archetypes safely fall back to desktop/scroll at
  // every width — illegal declarations in production do not change product
  // semantics.
  const mobileEnabled = isMobileRepresentationAllowed(
    archetype,
    mobileList !== undefined,
  );

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
      <TableScrollSurface
        archetype={archetype}
        widthMode={widthMode}
        mobile={mobileEnabled ? mobileList : undefined}
        regionDataSlot="admin-table-shell"
      >
        {desktopTable}
      </TableScrollSurface>
      {footer}
    </section>
  );
}

/**
 * The workbench toolbar band. A passthrough wrapper that marks its child (a
 * DataToolbar) as the shell's top region so workbench.css can flatten its card
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
