/**
 * Tier primitives — the density vocabulary negotiated per archetype
 * (#454 P3-Corrective §C/§5.4). The negotiation stays container-driven and
 * pure. #601 Phase F: the negotiated tier is the region's density signal
 * (`data-table-tier`, read by probes and E2E); it no longer feeds a
 * table-width floor — column width is the allocator's two-state rule over
 * Σ semantic minima vs the measured box (table/columnAllocation.ts), and
 * whether a table fills its container is the archetype's decision.
 */

export type DataTableTier = "compact" | "standard" | "wide";

/**
 * Closed table archetype vocabulary (issue 445 P3-Corrective §C). Pages
 * declare the archetype; the shell derives the effective tier from the
 * measured container width. `embedded-picker` is the tier-less composition:
 * allocation still governs it, with floor 0.
 */
export type TableArchetype =
  | "management-list"
  | "log-diagnostic"
  | "detail-comparison"
  | "embedded-picker";

/** Physical tier floors in px (45rem / 61.25rem / 75rem). */
export const TIER_MIN_WIDTH_PX: Record<DataTableTier, number> = {
  compact: 720,
  standard: 980,
  wide: 1200,
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
 *   surface measures pre-paint so the first painted width is already
 *   negotiated).
 *
 * `minTier` caps how low a table degrades, `maxTier` caps how wide it may
 * grow (management-list must never upgrade to wide on a huge container).
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
