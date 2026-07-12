/**
 * Typography semantic vocabulary — public API surface (UI-VOCAB-1T).
 *
 * DERIVED FROM the canonical `recipeRegistry.ts` (UI-TYPOGRAPHY-AUTHORITY-RECON-1
 * §8). This file deliberately holds NO ownership data of its own — the registry
 * is the single canonical authority. Names and types are re-exported here so
 * existing callers (and `typography-vocabulary.test.ts`) keep their public API.
 *
 * Authority chain:
 *   recipeRegistry.ts (canonical) → this file (names/types) → .md (generated
 *   table) → recipes.css (implementation, drift-tested against the registry).
 *
 * Rejected roles (`field-error`, `status`) are intentionally absent: they are
 * component-owned authorities (FieldError, StatusBadge), not typography recipes.
 *
 * Note: a structural lint proxy for these recipes (`exam-ui/no-raw-typography`)
 * was retired in UI-MIGRATE-N-W3 §12 — it could not deterministically
 * distinguish section-title ownership from topbar/question/overlay title roles.
 * Recipe authority is now enforced by the deterministic
 * `exam-ui/no-typography-authority-conflict` rule (RECON-1 §12, conflict-only
 * where a type-* recipe is explicitly selected) plus the recipe authority tests.
 */
import { RECIPE_NAMES, isRegisteredRecipe } from "./recipeRegistry";

/**
 * The public recipe-name union. Built from the canonical registry so a new
 * recipe cannot be added to the type without also being registered.
 */
export type TypographyRecipeName = (typeof RECIPE_NAMES)[number] extends infer N
  ? N
  : never;

/**
 * Confirmed semantic typography recipe names, in canonical order. Re-exported
 * from the registry; the registry is the source of truth.
 */
export const CONFIRMED_RECIPES: readonly TypographyRecipeName[] =
  RECIPE_NAMES as readonly TypographyRecipeName[];

/** True if `name` is a confirmed semantic typography recipe. */
export function isConfirmedRecipe(name: string): name is TypographyRecipeName {
  return isRegisteredRecipe(name);
}

/**
 * Font-family semantic roles (distinct from recipes). `font.reading` and
 * `font.serif` are separate roles; equating reading with serif is forbidden.
 */
export const FONT_FAMILY_ROLES = [
  "font.ui",
  "font.reading",
  "font.serif",
  "font.mono",
] as const;

export type FontFamilyRole = (typeof FONT_FAMILY_ROLES)[number];
