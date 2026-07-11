/**
 * Typography semantic vocabulary — machine-readable mirror of
 * typography-vocabulary.md (UI-VOCAB-1T).
 *
 * This is the source of truth for the confirmed semantic typography recipe
 * names. Do not add a name here without first documenting its semantic purpose
 * in typography-vocabulary.md.
 *
 * Rejected roles (`field-error`, `status`) are intentionally absent: they are
 * component-owned authorities (FieldError, StatusBadge), not typography recipes.
 *
 * Note: a structural lint proxy for these recipes (`exam-ui/no-raw-typography`)
 * was retired in UI-MIGRATE-N-W3 §12 — it could not deterministically
 * distinguish section-title ownership from topbar/question/overlay title roles.
 * Recipe authority is enforced by semantic migration review and the recipe
 * authority tests (typography/recipes.test.ts), not by a structural lint proxy.
 */

export type TypographyRecipeName =
  | "page-title"
  | "page-description"
  | "section-title"
  | "body"
  | "secondary"
  | "metadata"
  | "reading"
  | "long-response"
  | "metric"
  | "numeric"
  | "code";

/** Confirmed semantic typography recipe names (one public recipe per role). */
export const CONFIRMED_RECIPES: readonly TypographyRecipeName[] = [
  "page-title",
  "page-description",
  "section-title",
  "body",
  "secondary",
  "metadata",
  "reading",
  "long-response",
  "metric",
  "numeric",
  "code",
];

/** True if `name` is a confirmed semantic typography recipe. */
export function isConfirmedRecipe(name: string): name is TypographyRecipeName {
  return (CONFIRMED_RECIPES as readonly string[]).includes(name);
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
