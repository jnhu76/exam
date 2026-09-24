import type { DataTableColumnRole } from "@/components/shared/DataTableContract";

/**
 * Hard-floor calibration for the COMPRESSIBLE column roles (issue 601 Phase F
 * convergence).
 *
 * `ROLE_GEOMETRY.floor` is the smallest width at which the role's DECLARED
 * representation is still intentionally usable: below it the table takes the
 * local horizontal scroll instead of squeezing the column further. `basis` is
 * the preferred semantic geometry and the weight of the proportional
 * distribution. The two meanings diverge exactly for the roles that already
 * declare a narrower legal representation, and this module derives their floor
 * instead of copying a number:
 *
 *   representation family            roles                          floor vs basis
 *   ─────────────────────────────────────────────────────────────────────────────
 *   nowrap only (atomic)             status, type, date,             floor == basis
 *                                    date-range, duration, number,
 *                                    score, short-id, action-label,
 *                                    actions
 *   wrap / break-token               primary-text, secondary-text,   floor < basis
 *                                    long-text, tag-list
 *   presenter-bounded                description (truncate /         floor < basis
 *                                    line-clamp-2)
 *
 * Atomic roles have no narrower legal rendering — their capacity is bounded by
 * a value fixture (statusFixture / typeFixture / actionLabelFixture /
 * ROLE_OVERFLOW's single-member domains / the actions control budget), so
 * compressing them would either clip a value the product promises to show
 * whole or shrink a control below its hit-target budget. Their floor and basis
 * are the same token, and only the header channel (headerCapacity.ts) may
 * raise the basis.
 *
 * The compressible floors are calibrated against the SMALLEST READABLE LINE of
 * the role's content class — never against a production row, never measured at
 * runtime, and never content-dependent. The unit is expressed in the widest
 * glyph class the supported locales can deliver (CJK, a full-width 1em
 * advance), so the number is a safe upper bound for ASCII content too.
 */

/**
 * Cell chrome in border-box px: the governed `px-4` padding of BOTH the header
 * and the body cell (apps/web/src/components/ui/table.tsx). Every role token is
 * border-box, so the readable line has to be paid for on top of this.
 */
export const CELL_CHROME_PX = 32;

/** The governed body tier (recipes.css): 0.9375rem. */
export const CELL_TIER_PX = 15;

/** The governed header tier (recipes.css): 0.875rem. */
export const HEADER_TIER_PX = 14;

/**
 * CJK advance as a fraction of the font size. The product font's full-width
 * glyphs advance 1em; the 1.034 factor is the same conservative over-estimate
 * the status fixture uses (measured 12.4px for 12px badge text, issue 445
 * P3-Corrective Appendix M), so an estimator built on it is an upper bound.
 */
export const CJK_ADVANCE_EM = 1.034;

/** Quarter-rem token grid (1rem = 16px at the product root font). */
export const TOKEN_GRID_PX = 4;

/**
 * Sub-pixel/locale slack: one token-grid step. A floor that lands exactly on
 * the measured demand would clip at the first rounding difference between the
 * estimator and the rasterizer.
 */
export const FLOOR_SLACK_PX = 4;

/** Badge chrome inside a tag-list cell (TagBadge padding ×2 + border ×2). */
export const TAG_BADGE_CHROME_PX = 18;

export interface MinReadableLine {
  /** The smallest unit of this role's content class that must stay readable. */
  unit: string;
  /** That unit's width in px, in the widest supported glyph class. */
  px: number;
}

/** ceil to the token grid — the geometry vocabulary has no fractional steps. */
export function tokenGrid(px: number): number {
  return Math.ceil(px / TOKEN_GRID_PX) * TOKEN_GRID_PX;
}

/** Width of `glyphs` full-width glyphs at the body tier, rounded up. */
function glyphRun(glyphs: number): number {
  return Math.ceil(glyphs * CELL_TIER_PX * CJK_ADVANCE_EM);
}

/**
 * The smallest readable line per compressible role. These are the calibration
 * fixtures: each names the unit the floor has to hold and its width. The
 * structural gate re-derives every compressible floor from this table, so
 * changing a floor without changing its fixture (or the reverse) is a red test.
 */
export const MIN_READABLE_LINE = {
  /**
   * Identity values (names, titles, usernames). A 4-glyph fragment is the
   * smallest run that still identifies its row; wrap/break-token make the
   * narrower column legal.
   */
  "primary-text": {
    unit: "4-glyph identity fragment",
    px: glyphRun(4),
  },
  /**
   * Supporting attributes (answers, related counts, proctor names). 3 glyphs:
   * enough to tell two sibling attributes apart in a wrapped cell.
   */
  "secondary-text": {
    unit: "3-glyph attribute fragment",
    px: glyphRun(3),
  },
  /**
   * Long content (question bodies, exam titles). 6 glyphs per line: the
   * representation is wrap (or the declared truncate override, which keeps the
   * full value in the DOM + title), so a narrow column costs lines, not value.
   */
  "long-text": {
    unit: "6-glyph content line",
    px: glyphRun(6),
  },
  /**
   * Descriptions render through the truncate / line-clamp-2 presenters, whose
   * full value stays reachable (title + focus). Same readable line as
   * long-text: a 6-glyph fragment before the ellipsis.
   */
  description: {
    unit: "6-glyph description line",
    px: glyphRun(6),
  },
  /**
   * Tag lists hold badge chips, so the readable unit is one chip: a 3-glyph
   * label plus the badge's own chrome.
   */
  "tag-list": {
    unit: "one 3-glyph tag badge (badge chrome included)",
    px: glyphRun(3) + TAG_BADGE_CHROME_PX,
  },
} as const satisfies Partial<Record<DataTableColumnRole, MinReadableLine>>;

export type CompressibleRole = keyof typeof MIN_READABLE_LINE;

/** Every role whose floor is derived here (the rest are atomic). */
export const COMPRESSIBLE_ROLES = Object.keys(
  MIN_READABLE_LINE,
) as CompressibleRole[];

/**
 * The calibrated hard floor for one compressible role: the cell chrome plus
 * the role's smallest readable line plus one grid step of slack, on the token
 * grid.
 */
export function calibratedFloorPx(role: CompressibleRole): number {
  return tokenGrid(
    CELL_CHROME_PX + MIN_READABLE_LINE[role].px + FLOOR_SLACK_PX,
  );
}

export function isCompressibleRole(
  role: DataTableColumnRole,
): role is CompressibleRole {
  return role in MIN_READABLE_LINE;
}
