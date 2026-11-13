import { Permission } from "@exam/authz";
import {
  CELL_CHROME_PX,
  CELL_TIER_PX,
  TOKEN_GRID_PX,
  tokenGrid,
} from "@/table/roleCalibration";
import { headerGlyphRun } from "@/table/headerCapacity";

/**
 * Permission-matrix geometry — the named specialized authority for
 * /admin/permissions.
 *
 * The permission matrix is not a record list: its columns are roles, its rows
 * are capability keys, and its cells are grants. Forcing it into the ordinary
 * DataTable role vocabulary would make that model dishonest (there is no
 * `primary-text` column whose value vocabulary bounds a machine capability key,
 * and no `status` column). What it must NOT do is own ad-hoc geometry at the
 * page.
 *
 * So the matrix keeps its own semantics HERE, in one named module, and
 * composes the SHARED surface for everything else: TableScrollSurface owns the
 * scroll region, the overflow facts and the local-scroll affordance, the ui
 * Table primitives + recipes.css own typography, cell padding and the grid
 * borders, and the detail-comparison archetype pins the key column during
 * horizontal scroll (the matrix's row identity must not scroll away).
 */

/**
 * Mono advance for the capability keys, derived from the tier the cells
 * actually render at. recipes.css is unlayered, so its governed body-cell
 * tier (0.9375rem = CELL_TIER_PX) wins over any page `text-*` utility on a
 * matrix cell — the key renders at THAT size, and the column must budget the
 * mono run against it (budgeting a smaller assumed tier made the widest key
 * paint across the sticky boundary onto the grant column). MONO_ADVANCE_EM is
 * a conservative upper bound over the `--font-mono-stack` fleet (ui-monospace
 * → DejaVu Sans Mono / Liberation Mono on Linux at 0.602em; Menlo/Consolas
 * narrower).
 */
export const MONO_ADVANCE_EM = 0.62;

/** Mono advance in px at the governed body cell tier. */
export const MATRIX_MONO_ADVANCE_PX =
  Math.ceil(CELL_TIER_PX * MONO_ADVANCE_EM * 10) / 10;

/** Width of `glyphs` full-width glyphs at the mono cell tier, rounded up. */
function monoGlyphRun(glyphs: number): number {
  return Math.ceil(glyphs * MATRIX_MONO_ADVANCE_PX);
}

/**
 * The capability-key column's floor: the derived width is `max(220px legacy
 * floor, widest catalog key + cell chrome)`, so a new catalog key wider than the
 * current widest grows the column instead of being clipped, while a narrower new
 * key changes nothing.
 */
export const MATRIX_KEY_COLUMN_FLOOR_PX = 220;

/** The capability-key column: the widest catalog key, plus cell chrome. */
export function matrixKeyColumnPx(): number {
  const widest = Object.values(Permission).reduce(
    (max, key) => (key.length > max.length ? key : max),
    "",
  );
  return tokenGrid(
    Math.max(
      MATRIX_KEY_COLUMN_FLOOR_PX,
      monoGlyphRun(widest.length) + CELL_CHROME_PX + TOKEN_GRID_PX,
    ),
  );
}

/** The widest catalog capability key (the fixture's oracle). */
export function widestPermissionKey(): string {
  return Object.values(Permission).reduce(
    (max, key) => (key.length > max.length ? key : max),
    "",
  );
}

/**
 * One role column: a grant icon or a dash. Its floor is the grant cell (one
 * inline icon plus cell chrome); its width also has to hold the role's own
 * header label, which is a bounded static vocabulary (the assignable presets).
 */
export function matrixRoleColumnPx(labels: readonly string[]): number {
  const iconCell = 16 + CELL_CHROME_PX + TOKEN_GRID_PX;
  const widestLabel = Math.max(
    0,
    ...labels.map(
      (label) => headerGlyphRun([...label].length) + CELL_CHROME_PX,
    ),
  );
  return tokenGrid(Math.max(iconCell, widestLabel));
}

/** The matrix's intrinsic table width (key column + one column per role). */
export function matrixTableWidth(labels: readonly string[]): number {
  return matrixKeyColumnPx() + labels.length * matrixRoleColumnPx(labels);
}
