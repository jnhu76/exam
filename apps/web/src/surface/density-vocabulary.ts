/**
 * Density semantic vocabulary — machine-readable mirror of the density
 * vocabulary documented in docs/standards/ui-system.md.
 *
 * Density describes INFORMATION density (how tightly a region packs content),
 * NOT raw padding values. Per the surface vocabulary §6, component layout
 * owns the exact padding/gap within its density role, because a role
 * legitimately spans a range (compact = p-3/p-4; default = p-5; comfortable =
 * p-6). For that reason density is a VOCABULARY of named roles + value ranges,
 * NOT a set of CSS classes: a `.density-compact` class would falsely pin one
 * value where the component may legitimately choose p-3 or p-4 by context.
 *
 * This module is the authority for the three confirmed density names. Future
 * surface recipes (e.g. a `.surface-content` follow-on) MAY encode a density
 * alongside bg/border/radius only when a single value is justified; until then
 * the component owns the value within its density role.
 *
 * Rejected variants (must remain absent): density-p4, density-p5,
 * density-card, density-table, and finer p-2-vs-p-3 / p-5-vs-p-6 tiers.
 * "Do not abstract every padding value" (surface vocabulary §6).
 */
export type DensityRecipeName = "compact" | "default" | "comfortable";

/** Confirmed semantic density roles (one name per information-density tier). */
export const CONFIRMED_DENSITIES: readonly DensityRecipeName[] = [
  "compact",
  "default",
  "comfortable",
];

/** True if `name` is a confirmed density role. */
export function isConfirmedDensity(name: string): name is DensityRecipeName {
  return (CONFIRMED_DENSITIES as readonly string[]).includes(name);
}

/**
 * Documented padding/gap range each density role resolves to. These are the
 * authoritative ranges from the surface vocabulary §6, exposed for reference
 * and documentation generation; components select the concrete value within a
 * range by layout context.
 */
export const DENSITY_RANGES: Record<
  DensityRecipeName,
  { padding: string; gap: string; note: string }
> = {
  compact: {
    padding: "p-3 / p-4 (12–16px)",
    gap: "gap-2 / gap-3",
    note: "dense data rows, table cells, toolbars, choice tiles, block feedback",
  },
  default: {
    padding: "p-5 (20px)",
    gap: "gap-4",
    note: "standard section body — PageSection/DataTableShell/FormSection body",
  },
  comfortable: {
    padding: "p-6 (24px)",
    gap: "gap-4 / gap-6",
    note: "prominent content tile — Card content, StatsCard",
  },
};
