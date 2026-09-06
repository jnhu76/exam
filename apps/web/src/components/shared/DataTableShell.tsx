import { useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useOverflowObservation } from "@/hooks/useOverflowObservation";
import { cn } from "@/lib/utils";

export type DataTableTier = "compact" | "standard" | "wide";

/**
 * Closed table archetype vocabulary (issue 445 P3-Corrective §C). Pages declare the
 * archetype; the shell derives the effective tier from the measured container
 * width. `embedded-picker` is the named auto-layout exception: it stays inside
 * the shell surface but is NOT governed by fixed-tier negotiation.
 */
export type TableArchetype =
  | "management-list"
  | "log-diagnostic"
  | "detail-comparison"
  | "embedded-picker";

/**
 * Physical tier floors (recipes.css `min-width` on the shell-scoped table).
 * The negotiation is the ONLY consumer of these numbers — no runtime Σmin
 * channel is built (P3-Corrective K2: fixed layout + col min-width +
 * border-collapse physically enforce `renderedTableMin = max(tierMin,
 * contentMin)` in Chromium; Σrole minima is a structural-test oracle only).
 */
export const TIER_MIN_WIDTH_PX: Record<DataTableTier, number> = {
  compact: 720, //   45rem
  standard: 980, // 61.25rem
  wide: 1200, //     75rem
};

const TIER_ORDER: DataTableTier[] = ["compact", "standard", "wide"];

/** Per-archetype tier bounds (P3-Corrective §C / §5.4). */
export const ARCHETYPE_TIER_BOUNDS: Record<
  Exclude<TableArchetype, "embedded-picker">,
  { min: DataTableTier; max: DataTableTier }
> = {
  "management-list": { min: "compact", max: "standard" },
  "log-diagnostic": { min: "compact", max: "wide" },
  "detail-comparison": { min: "compact", max: "compact" },
};

/**
 * Container-driven tier negotiation (pure, testable — no hysteresis):
 *
 *   effective = largest tier in [minTier, maxTier] whose tierMin ≤ container
 *   if none fits → minTier (the initial/unmeasured container falls here; the
 *   hook measures pre-paint so the first painted width is already negotiated).
 *
 * `minTier` caps how low a table degrades, `maxTier` caps how wide it may grow
 * (management-list must never upgrade to wide on a huge container).
 */
export function negotiateTier(
  containerWidth: number,
  minTier: DataTableTier,
  maxTier: DataTableTier,
): DataTableTier {
  const minIndex = TIER_ORDER.indexOf(minTier);
  const maxIndex = TIER_ORDER.indexOf(maxTier);
  let effective: DataTableTier = minTier;
  for (let i = maxIndex; i >= minIndex; i--) {
    const tier = TIER_ORDER[i];
    if (tier !== undefined && TIER_MIN_WIDTH_PX[tier] <= containerWidth) {
      effective = tier;
      break;
    }
  }
  return effective;
}

/**
 * Standard shell for data table pages, providing an optional title, description,
 * toolbar slot, content area, and footer within a bordered card container.
 *
 * The shell owns container-driven tier negotiation (from the archetype's
 * min/max tier bounds and the measured container width) and the overflow
 * affordance; it never computes column widths (that belongs to
 * DataTableContract + recipes.css).
 */
export function DataTableShell({
  title,
  description,
  toolbar,
  children,
  mobile,
  footer,
  className,
  contentClassName,
  archetype = "management-list",
}: {
  title?: string;
  description?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  /**
   * Mobile card list for the management-list archetype (issue 457): a
   * viewport-only (<lg) representation derived from the same column
   * declarations as the desktop table. The switch is pure CSS (`lg:`) — no JS
   * breakpoint. Other archetypes keep horizontal scroll below lg.
   */
  mobile?: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  archetype?: TableArchetype;
}) {
  const { t } = useTranslation();
  const shellId = useId();
  const titleId = title ? `${shellId}-title` : undefined;
  const descriptionId = description ? `${shellId}-description` : undefined;
  const scrollRef = useRef<HTMLDivElement>(null);
  const overflow = useOverflowObservation(scrollRef);

  if (
    import.meta.env.DEV &&
    mobile !== undefined &&
    archetype !== "management-list"
  ) {
    throw new Error(
      `DataTableShell contract violation: the mobile card slot is a management-list mechanism; archetype "${archetype}" keeps horizontal scroll below lg`,
    );
  }

  const tier =
    archetype === "embedded-picker"
      ? null
      : negotiateTier(
          overflow.containerWidth,
          ARCHETYPE_TIER_BOUNDS[archetype].min,
          ARCHETYPE_TIER_BOUNDS[archetype].max,
        );

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-slot="admin-table-shell"
      data-table-archetype={archetype}
      {...(tier ? { "data-table-tier": tier } : {})}
      className={cn("surface-content overflow-hidden", className)}
    >
      {(title || description || toolbar) && (
        <div
          data-slot="data-table-title-band"
          className="flex flex-col gap-3 border-b border-border-divider bg-surface px-4 py-3 lg:flex-row lg:items-start lg:justify-between"
        >
          {(title || description) && (
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
          )}
          {toolbar && <div className="shrink-0">{toolbar}</div>}
        </div>
      )}
      {mobile !== undefined && (
        // Viewport switch is CSS-only (issue 457): below lg the table region
        // is display:none and the card list renders instead. The tier
        // negotiation stays mounted but measures a hidden region (width 0 →
        // min tier), so no JS breakpoint ever drives the representation.
        <div data-slot="table-mobile-region" className="lg:hidden">
          {mobile}
        </div>
      )}
      <div
        data-slot="table-scroll-frame"
        className={
          mobile !== undefined
            ? "relative hidden min-w-0 lg:block"
            : "relative min-w-0"
        }
      >
        <div
          ref={scrollRef}
          data-slot="table-scroll-region"
          data-overflow-owner="local"
          data-overflowing={String(overflow.overflowing)}
          data-scroll-start={String(overflow.atStart)}
          data-scroll-end={String(overflow.atEnd)}
          className={cn("min-w-0 overflow-x-auto", contentClassName)}
        >
          {children}
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
      {footer && (
        <div className="border-t bg-surface-subtle px-4 py-3">{footer}</div>
      )}
    </section>
  );
}
