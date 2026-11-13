import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MATRIX_MONO_ADVANCE_PX,
  matrixKeyColumnPx,
  widestPermissionKey,
} from "./permissionMatrix";
import { CELL_CHROME_PX, CELL_TIER_PX, TOKEN_GRID_PX } from "./roleCalibration";

const here = dirname(fileURLToPath(import.meta.url));
const recipesCss = readFileSync(join(here, "recipes.css"), "utf8");

/**
 * The advance of the mono fonts the product's `--font-mono-stack` actually
 * resolves to on the deployment fleet (ui-monospace → DejaVu Sans Mono /
 * Liberation Mono on Linux, both 0.602em; Menlo/Consolas 0.55–0.552em). This
 * is the REAL lower bound a key must be budgeted against, not the estimator's
 * own claim.
 */
const REAL_MONO_ADVANCE_EM = 0.602;

/** The rendered body-cell font size, read back from recipes.css (rem). */
function recipesCellFontSizePx(): number {
  const m = /\[data-slot="table-cell"\]\s*\{[^}]*font-size:\s*([\d.]+)rem/.exec(
    recipesCss,
  );
  if (!m) throw new Error("recipes.css body-cell font-size rule not found");
  return Number(m[1]) * 16;
}

describe("permission matrix geometry", () => {
  it("budgets the capability-key column against the REAL rendered cell tier", () => {
    // recipes.css is unlayered: its 0.9375rem body tier wins over any page
    // `text-*` utility on a matrix cell, so THAT is the size the key renders
    // at. The estimator's per-glyph advance must cover this tier's mono run
    // for the widest catalog key, or the key paints across the sticky
    // boundary onto the grant column (audit screenshots at 375/1280).
    const tierPx = recipesCellFontSizePx();
    expect(tierPx).toBe(CELL_TIER_PX);

    const textBudget = matrixKeyColumnPx() - CELL_CHROME_PX - TOKEN_GRID_PX;
    const widest = widestPermissionKey();
    const realTextWidth = widest.length * tierPx * REAL_MONO_ADVANCE_EM;

    expect(MATRIX_MONO_ADVANCE_PX).toBeGreaterThanOrEqual(
      tierPx * REAL_MONO_ADVANCE_EM,
    );
    expect(textBudget).toBeGreaterThanOrEqual(realTextWidth);
  });
});
