import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  TableScrollSurface,
  type TableWidthMode,
} from "@/components/shared/TableScrollSurface";
import type { TableArchetype } from "@/table/tableTiers";

/**
 * Production-safe mobile eligibility (issue 457 C2, extended by issue 601 Phase F):
 * management-list and log-diagnostic archetypes with an explicit mobile slot
 * participate in the CSS viewport switch. Other archetypes safely fall back
 * to desktop/scroll at every width. Extracted as a pure function for direct
 * unit testing.
 *
 * The issue 457 freeze (management-list only) is superseded by Phase F evidence:
 * RecoveryQueuePage and ProctorRecoveryPage — log-diagnostic — both shipped
 * hand-rolled `md`-breakpoint card lists, i.e. the product needed a mobile
 * representation the authority refused to provide. Converging them onto
 * MobileRecordList under this eligibility replaces the page-local second
 * implementation instead of preserving the bypass.
 */
export function isMobileRepresentationAllowed(
  archetype: TableArchetype,
  hasMobile: boolean,
): boolean {
  return (
    hasMobile &&
    (archetype === "management-list" || archetype === "log-diagnostic")
  );
}

/**
 * Standard shell for data table pages, providing an optional title,
 * description, toolbar band, content area, and footer within a bordered card
 * container.
 *
 * The scroll region (measurement, tier negotiation, allocation scope, local
 * scroll, fades/hint) and the viewport representation switch are owned by
 * TableScrollSurface — the single shared scroll-region contract that
 * DataWorkbench composes too. That region element is also the single carrier
 * of the geometry vocabulary (`data-table-archetype` + the negotiated
 * `data-table-tier`) for both shells, so CSS and runtime probes read one
 * element that always exists in either composition.
 */
export function DataTableShell({
  title,
  description,
  meta,
  toolbar,
  children,
  mobile,
  footer,
  className,
  archetype = "management-list",
  widthMode = "fill",
}: {
  title?: string;
  description?: string;
  /**
   * Title-band metadata — a count/context line that belongs WITH the title,
   * rendered in the band's trailing (right-aligned) slot. This is the frozen
   * baseline position for a data view's summary line; a lone count is not a
   * toolbar and must not open a controls band of its own (issue 601 Phase F
   * corrective: the pre-Phase-F shell put it here).
   */
  meta?: ReactNode;
  /** The data-view toolbar (DataToolbar) — rendered as the shell's band below
   * the title, inside the surface. One composition for search/filter/action
   * controls and the table (issue 601 Phase F). A toolbar band exists only
   * when the dataset has dataset-scoped controls: a page-scoped action belongs
   * in the PageHeader. */
  toolbar?: ReactNode;
  children: ReactNode;
  /**
   * Mobile card list for mobile-eligible archetypes (issue 457, extended by Phase
   * F): a viewport-only (<lg) representation derived from the same column
   * declarations as the desktop table. The switch is pure CSS (`lg:`) — no JS
   * breakpoint. detail-comparison keeps horizontal scroll below lg.
   */
  mobile?: ReactNode;
  /** The data-view footer (DataViewFooter) — count/range + navigation. */
  footer?: ReactNode;
  className?: string;
  archetype?: TableArchetype;
  /**
   * The composition's width intent (TableWidthMode). A page data view fills
   * the region it was given; a table that must render at its preferred width
   * (an embedded picker inside a form) declares `intrinsic`.
   */
  widthMode?: TableWidthMode;
}) {
  const shellId = useId();
  const titleId = title ? `${shellId}-title` : undefined;
  const descriptionId = description ? `${shellId}-description` : undefined;

  if (
    import.meta.env.DEV &&
    mobile !== undefined &&
    !isMobileRepresentationAllowed(archetype, true)
  ) {
    throw new Error(
      `DataTableShell contract violation: the mobile card slot is a management-list/log-diagnostic mechanism; archetype "${archetype}" keeps horizontal scroll below lg`,
    );
  }

  // Production-safe eligibility: only eligible archetypes with an explicit
  // mobile slot participate in the CSS viewport switch. Other archetypes
  // safely fall back to desktop/scroll at every width — illegal declarations
  // in production do not change product semantics.
  const mobileEnabled = isMobileRepresentationAllowed(
    archetype,
    mobile !== undefined,
  );

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-slot="admin-table-shell"
      className={cn("surface-content overflow-hidden", className)}
    >
      {(title || description || meta) && (
        <div
          data-slot="data-table-title-band"
          className="flex flex-col gap-3 border-b border-border-divider bg-surface px-4 py-3 lg:flex-row lg:items-start lg:justify-between"
        >
          <div className="min-w-0">
            {title && (
              <h2 id={titleId} className="type-section-title">
                {title}
              </h2>
            )}
            {description && (
              <p
                id={descriptionId}
                className={cn("type-secondary", title && "mt-1")}
              >
                {description}
              </p>
            )}
          </div>
          {meta && (
            <div data-slot="data-table-title-meta" className="shrink-0">
              {meta}
            </div>
          )}
        </div>
      )}
      {toolbar && (
        <div
          data-slot="data-table-toolbar-band"
          className="border-b border-border-divider"
        >
          {toolbar}
        </div>
      )}
      <TableScrollSurface
        archetype={archetype}
        widthMode={widthMode}
        mobile={mobileEnabled ? mobile : undefined}
      >
        {children}
      </TableScrollSurface>
      {footer && (
        <div
          data-slot="data-table-footer-band"
          className="border-t bg-surface-subtle"
        >
          {footer}
        </div>
      )}
    </section>
  );
}
