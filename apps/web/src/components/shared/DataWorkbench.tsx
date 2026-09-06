import { useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useOverflowObservation } from "@/hooks/useOverflowObservation";
import { cn } from "@/lib/utils";
import {
  ARCHETYPE_TIER_BOUNDS,
  isMobileRepresentationAllowed,
  negotiateTier,
  type TableArchetype,
} from "@/components/shared/DataTableShell";
import { ResponsiveRepresentation } from "@/components/shared/ResponsiveRepresentation";

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
 *   ├─ ResponsiveRepresentation // the single lg-breakpoint policy owner
 *   │    ├─ mobile cards        // sibling of the desktop measurement branch
 *   │    └─ desktop region      // owns the table measurement branch:
 *   │         ├─ table-scroll-frame
 *   │         ├─ admin-table-shell (scrollRef, tier attrs, overflow-x-auto)
 *   │         ├─ desktop table
 *   │         └─ scroll fades/hint
 *   └─ <DataWorkbenchFooter>    // count + pagination, the shell's BOTTOM region
 *
 * The viewport decides the representation FIRST (UI-TABLE-MOBILE-1 R2): only
 * the desktop branch enters table measurement — mobile cards are never
 * descendants of admin-table-shell / the overflow-x-auto measurement node, so
 * they cannot participate in useOverflowObservation or tier negotiation.
 *
 * Mobile eligibility reuses the single authority from DataTableShell
 * (isMobileRepresentationAllowed): only management-list with an explicit
 * mobileList participates in the viewport switch; other archetypes keep the
 * desktop/scroll representation at every viewport (DEV fails loud on the
 * illegal combination).
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
  archetype = "management-list",
}: {
  /** The toolbar band (search + filters + actions). Rendered as the shell top. */
  toolbar?: ReactNode;
  /** The desktop DataTable — the sole content of the admin-table-shell scroll
   * region (desktop measurement branch of the responsive owner). */
  desktopTable?: ReactNode;
  /** The mobile MobileRecordList. Rendered as the responsive owner's mobile
   * branch — a sibling of the desktop measurement branch, never inside
   * admin-table-shell. */
  mobileList?: ReactNode;
  /** The footer band (count + pagination). Rendered as the shell bottom. */
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  archetype?: TableArchetype;
}) {
  const { t } = useTranslation();
  const shellId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const overflow = useOverflowObservation(scrollRef);

  if (
    import.meta.env.DEV &&
    mobileList !== undefined &&
    archetype !== "management-list"
  ) {
    throw new Error(
      `DataWorkbench contract violation: the mobile card slot is a management-list mechanism; archetype "${archetype}" keeps horizontal scroll below lg`,
    );
  }

  // Production-safe eligibility (same authority as DataTableShell): only
  // management-list with an explicit mobileList participates in the CSS
  // viewport switch. Other archetypes safely fall back to desktop/scroll at
  // every width — illegal declarations in production do not change product
  // semantics.
  const mobileEnabled = isMobileRepresentationAllowed(
    archetype,
    mobileList !== undefined,
  );

  const tier =
    archetype === "embedded-picker"
      ? null
      : negotiateTier(
          overflow.containerWidth,
          ARCHETYPE_TIER_BOUNDS[archetype].min,
          ARCHETYPE_TIER_BOUNDS[archetype].max,
        );

  const titleId = `${shellId}-label`;

  // The desktop measurement branch: everything that observes overflow lives
  // here (scrollRef, tier attributes, local scroll, fades/hint). When mobile
  // is enabled this whole branch is the responsive owner's desktop region;
  // otherwise it is the only representation.
  const desktopRegion = (
    <div data-slot="table-scroll-frame" className="relative min-w-0">
      <div
        ref={scrollRef}
        data-slot="admin-table-shell"
        data-table-archetype={archetype}
        {...(tier ? { "data-table-tier": tier } : {})}
        data-overflow-owner="local"
        data-overflowing={String(overflow.overflowing)}
        data-scroll-start={String(overflow.atStart)}
        data-scroll-end={String(overflow.atEnd)}
        className={cn("min-w-0 overflow-x-auto", contentClassName)}
      >
        {desktopTable}
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
      {mobileEnabled ? (
        <ResponsiveRepresentation mobile={mobileList} desktop={desktopRegion} />
      ) : (
        desktopRegion
      )}
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
