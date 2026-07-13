/**
 * Typography recipe ownership registry — the SINGLE canonical machine-readable
 * authority for the semantic typography layer (UI-TYPOGRAPHY-AUTHORITY-RECON-1
 * §8, §9).
 *
 * Authority chain (this file is canonical; everything else derives/validates):
 *
 *   recipeRegistry.ts (THIS)         ← canonical machine-readable authority
 *       ↓ re-exports public names/types
 *   typography-vocabulary.ts         ← public API surface, no ownership data
 *       ↓ human mirror; registry table GENERATED, equality-tested
 *   typography-vocabulary.md
 *       ↓ implementation; CSS↔registry drift tested bidirectionally
 *   recipes.css
 *
 * Why this file owns authority (and not the CSS or the Markdown): a single
 * machine-readable record per recipe lets the conflict rule reason about
 * ownership deterministically, and lets one drift test catch divergence between
 * the registry, the CSS implementation, and the Markdown documentation.
 *
 * Cascade policy A (PROVEN, §7): unlayered `.type-*` recipes WIN over all
 * layered Tailwind utilities. Therefore:
 *   - a recipe's `ownedProperties` CANNOT be overridden by business utilities;
 *   - there is NO `allowedStateOverrides` field: it would record a permission
 *     that cannot take effect at runtime.
 *
 * Resolved contradiction (long-response `min-height`): the Markdown vocabulary
 * previously listed min-height as OWNED, but recipes.css did not declare it and
 * the consumer (GradingDetailPage) uses `min-h-16`. Recorded here as
 * LAYOUT-OWNED — aligning CSS + consumer; the Markdown is corrected in C3.
 */
import type { RecipeOwnedProperty } from "../lint/exam-ui/cssPropertyResolver";

/**
 * One recipe's authority. `ownedProperties` are pinned by the recipe and cannot
 * be overridden by business utilities (cascade policy A). `layoutOwnedProperties`
 * are explicitly composable — the layout may set them per consumer (e.g. metric
 * size varies by stat-card scale).
 */
export type RecipeAuthority = {
  /** The semantic role name (matches the `type-NAME` CSS class and vocabulary). */
  name: string;
  /** Short semantic purpose. */
  purpose: string;
  /** Properties the recipe pins; business utilities touching these CONFLICT. */
  ownedProperties: readonly RecipeOwnedProperty[];
  /** Properties the layout may set; business utilities touching these are OK. */
  layoutOwnedProperties: readonly RecipeOwnedProperty[];
};

/**
 * The canonical registry. Order matches `recipes.css` and `typography-vocabulary`.
 *
 * Property abbreviations used below map to RecipeOwnedProperty:
 *   "font-family" "font-size" "line-height" "font-weight" "letter-spacing"
 *   "color" "font-variant-numeric" "white-space" "min-height" "overflow-x"
 */
export const RECIPE_REGISTRY: readonly RecipeAuthority[] = [
  {
    name: "page-title",
    purpose: "The single title of a page; strongest non-numeric hierarchy.",
    ownedProperties: [
      "font-family",
      "font-size",
      "line-height",
      "font-weight",
      "letter-spacing",
      "color",
    ],
    layoutOwnedProperties: [],
  },
  {
    name: "page-description",
    purpose: "Subtitle/lede directly under a page or section title.",
    ownedProperties: [
      "font-family",
      "font-size",
      "line-height",
      "font-weight",
      "color",
    ],
    layoutOwnedProperties: [],
  },
  {
    name: "section-title",
    purpose: "Title of a content section / card / panel within a page.",
    ownedProperties: [
      "font-family",
      "font-size",
      "line-height",
      "font-weight",
      "color",
    ],
    layoutOwnedProperties: [],
  },
  {
    name: "body",
    purpose: "Default running UI text.",
    ownedProperties: [
      "font-family",
      "font-size",
      "line-height",
      "font-weight",
      "color",
    ],
    layoutOwnedProperties: [],
  },
  {
    name: "secondary",
    purpose: "De-emphasized running text (descriptive, not a factual record).",
    ownedProperties: [
      "font-family",
      "font-size",
      "line-height",
      "font-weight",
      "color",
    ],
    layoutOwnedProperties: [],
  },
  {
    name: "metadata",
    purpose:
      "Compact supporting factual information: timestamps, identifiers, record facts.",
    ownedProperties: [
      "font-family",
      "font-size",
      "line-height",
      "font-weight",
      "color",
    ],
    layoutOwnedProperties: [],
  },
  {
    name: "reading",
    purpose: "Sustained reading of a long passage / long question stem.",
    ownedProperties: [
      "font-family",
      "font-size",
      "line-height",
      "font-weight",
      "color",
    ],
    layoutOwnedProperties: [],
  },
  {
    name: "long-response",
    purpose:
      "Read-only long candidate/source text that may wrap many lines; preserves whitespace.",
    ownedProperties: [
      "font-family",
      "font-size",
      "line-height",
      "font-weight",
      "color",
      "white-space",
    ],
    // RESOLVED (RECON-1 §8): min-height is LAYOUT-OWNED. recipes.css does not
    // declare it; the consumer uses min-h-16 as a layout companion.
    layoutOwnedProperties: ["min-height"],
  },
  {
    name: "metric",
    purpose: "A KPI/stat numeric value; the prominent number of a stat card.",
    ownedProperties: [
      "font-family",
      "font-size",
      "line-height",
      "font-weight",
      "color",
      "font-variant-numeric",
    ],
    layoutOwnedProperties: [],
  },
  {
    name: "numeric",
    purpose:
      "Tabular numeric alignment for tables/timers/counts (not the metric).",
    ownedProperties: ["font-variant-numeric"],
    // Size, family, weight remain layout-owned.
    layoutOwnedProperties: [
      "font-size",
      "line-height",
      "font-family",
      "font-weight",
    ],
  },
  {
    name: "code",
    purpose: "Monospaced code / log / JSON dump presentation.",
    ownedProperties: [
      "font-family",
      "font-size",
      "line-height",
      "font-weight",
      "white-space",
      "overflow-x",
    ],
    layoutOwnedProperties: [],
  },
];

/** The full set of recipe role names, in canonical order. */
export const RECIPE_NAMES = RECIPE_REGISTRY.map(
  (r) => r.name,
) as readonly string[];

/** Lookup a recipe authority by name. Returns undefined for unknown recipes. */
export function getRecipeAuthority(name: string): RecipeAuthority | undefined {
  return RECIPE_REGISTRY.find((r) => r.name === name);
}

/**
 * True if `name` is a registered recipe role. (Re-exported as the public
 * `isConfirmedRecipe` by typography-vocabulary.ts so existing callers are
 * unaffected.)
 */
export function isRegisteredRecipe(name: string): boolean {
  return RECIPE_REGISTRY.some((r) => r.name === name);
}
