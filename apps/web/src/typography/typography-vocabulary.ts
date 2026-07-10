/**
 * Typography semantic vocabulary — machine-readable mirror of
 * typography-vocabulary.md (UI-VOCAB-1T).
 *
 * This is the source of truth for the confirmed semantic typography recipe
 * names. Future UI-LINT-2 (`exam-ui/no-raw-typography`) synchronizes its
 * allowed-recipe list against `CONFIRMED_RECIPES`. Do not add a name here
 * without first documenting its semantic purpose in typography-vocabulary.md.
 *
 * Rejected roles (`field-error`, `status`) are intentionally absent: they are
 * component-owned authorities (FieldError, StatusBadge), not typography recipes.
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
