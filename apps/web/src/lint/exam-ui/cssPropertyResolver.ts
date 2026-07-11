/**
 * CSS property resolver + arbitrary-value classifier
 * (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §5, §6, §9).
 *
 * Two responsibilities, kept distinct:
 *
 * 1. `propertiesTouchedBy(candidate)` — map a parsed Tailwind candidate (or an
 *    inline-style property key) to the FULL set of CSS properties it touches.
 *    Critical: named `text-{size}` utilities touch BOTH font-size AND
 *    line-height (verified against Tailwind v4 docs), so a utility must never be
 *    modeled as size-only. This bundle drives the recipe-conflict rule.
 *
 * 2. `classifyArbitraryValue(...)` — classify an arbitrary-value bracket form
 *    as typography | color | other | unknown. Used by the global
 *    `no-arbitrary-typography` rule to enforce ONLY typography categories and
 *    leave color to the future color/token authority.
 *
 * Layering: this is a LEAF logic module. It consumes `ParsedTailwindCandidate`
 * from `tailwindCandidate.ts` and the property vocabulary below. It does NOT
 * know about recipes (that is `recipeRegistry.ts`). Policy is decided here; the
 * parser (`tailwindCandidate.ts`) only returns structure.
 */
import type { ParsedTailwindCandidate } from "./tailwindCandidate";

/**
 * The full set of CSS properties a recipe may own or a utility may touch.
 * Intentionally broader than "typography": recipes also own white-space,
 * min-height, overflow-x (see `type-code`, `type-long-response`).
 */
export type RecipeOwnedProperty =
  | "font-family"
  | "font-size"
  | "line-height"
  | "font-weight"
  | "letter-spacing"
  | "color"
  | "font-variant-numeric"
  | "white-space"
  | "min-height"
  | "overflow-x";

/** The categories the global arbitrary-typography policy forbids. */
export const NO_ARBITRARY_TYPOGRAPHY_POLICY_CATEGORIES: ReadonlySet<RecipeOwnedProperty> =
  new Set<RecipeOwnedProperty>([
    "font-size",
    "line-height",
    "letter-spacing",
    "font-weight",
    "font-family",
  ]);

/**
 * Inline-style property keys that map to a recipe-owned property, OR the special
 * `"font"` marker for the CSS `font` shorthand (expanded by the caller).
 */
const INLINE_STYLE_PROPERTY_MAP: Record<string, RecipeOwnedProperty | "font"> =
  {
    fontFamily: "font-family",
    fontSize: "font-size",
    lineHeight: "line-height",
    fontWeight: "font-weight",
    letterSpacing: "letter-spacing",
    color: "color",
    fontVariantNumeric: "font-variant-numeric",
    whiteSpace: "white-space",
    minHeight: "min-height",
    overflowX: "overflow-x",
    // CSS shorthand: the `font` shorthand sets family/size/line-height/weight.
    font: "font",
  };

/** Named Tailwind text-size scale utilities (each sets BOTH font-size + line-height). */
const TEXT_SIZE_UTILITIES = new Set([
  "text-xs",
  "text-sm",
  "text-base",
  "text-lg",
  "text-xl",
  "text-2xl",
  "text-3xl",
  "text-4xl",
  "text-5xl",
  "text-6xl",
  "text-7xl",
  "text-8xl",
  "text-9xl",
]);

/** Named leading utilities → line-height. */
const LEADING_NAMED =
  /^(?:leading|lh)-(?:none|tight|snug|normal|relaxed|loose|\d+(?:\.\d+)?)$/;

/** Named tracking utilities → letter-spacing. */
const TRACKING_NAMED = /^tracking-(?:tighter|tight|normal|wide|wider|widest)$/;

/** Named font-weight utilities → font-weight. */
const WEIGHT_NAMED =
  /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;

/** Named font-family utilities → font-family. */
const FAMILY_NAMED = /^font-(?:sans|serif|mono)$/;

/** whitespace-* → white-space; truncate → white-space + overflow + text-overflow. */
const WHITESPACE_NAMED =
  /^whitespace-(?:normal|nowrap|pre|pre-line|pre-wrap|break-spaces)$/;

/** overflow-x-* → overflow-x. */
const OVERFLOW_X_NAMED = /^overflow-x-(?:auto|hidden|clip|visible|scroll)$/;

/**
 * Map a parsed Tailwind candidate to the set of CSS properties it touches.
 * Returns the empty set for candidates that touch no recipe-owned property
 * (structural utilities like flex/mt-4/rounded-…).
 */
export function propertiesTouchedBy(
  candidate: ParsedTailwindCandidate,
): Set<RecipeOwnedProperty> {
  const out = new Set<RecipeOwnedProperty>();
  if (!candidate.ok) return out;

  // Arbitrary property form: [prop:val] — map by the CSS property name.
  if (candidate.arbitraryProperty) {
    collectCssProperty(candidate.arbitraryProperty.property, out);
    return out;
  }

  const u = candidate.utility;

  // text-{size} → font-size + line-height (BOTH, per Tailwind v4 docs).
  if (TEXT_SIZE_UTILITIES.has(u)) {
    out.add("font-size");
    out.add("line-height");
    return out;
  }
  // text-[...] arbitrary value: depends on the data-type hint / classifier.
  if (u === "text" && candidate.arbitraryValue !== undefined) {
    const cls = classifyArbitraryValue(
      candidate.arbitraryValue,
      candidate.dataTypeHint,
    );
    if (cls.kind === "typography") {
      for (const p of cls.properties) out.add(p);
    } else if (cls.kind === "color") {
      out.add("color");
    }
    // unknown/other → touches nothing resolvable here.
    return out;
  }
  // text-align / text-decoration / text-transform etc. start with "text-" but
  // are NOT typography-owned (align/decoration/transform). They touch no
  // recipe-owned property. (e.g. text-center, text-underline, text-red-500 color.)
  // Named text COLOR utilities: text-{color} and text-{color}/{shade}.
  if (u === "text" || u.startsWith("text-")) {
    // A named text-* with no arbitrary value: could be a color (text-red-500,
    // text-muted-foreground, text-destructive/30) OR text-align/decoration.
    // Color names are open-ended tokens; conservatively, a `text-*` named token
    // that is NOT a known size and has no arbitrary value is treated as color
    // ONLY when it matches a color-ish shape. We resolve color here so the
    // recipe-conflict rule catches color overrides; non-color text-* utilities
    // (align/decoration/transform) simply touch no owned property.
    if (looksLikeTextColor(u)) out.add("color");
    return out;
  }

  // leading-* → line-height.
  if (u === "leading" || u.startsWith("leading-") || LEADING_NAMED.test(u)) {
    out.add("line-height");
    return out;
  }
  // leading-[...] arbitrary.
  if (
    (u === "leading" || u === "lh") &&
    candidate.arbitraryValue !== undefined
  ) {
    out.add("line-height");
    return out;
  }

  // tracking-* → letter-spacing.
  if (u === "tracking" || u.startsWith("tracking-") || TRACKING_NAMED.test(u)) {
    out.add("letter-spacing");
    return out;
  }

  // font-weight / font-family / font-numeric.
  if (WEIGHT_NAMED.test(u)) {
    out.add("font-weight");
    return out;
  }
  if (FAMILY_NAMED.test(u)) {
    out.add("font-family");
    return out;
  }
  if (u === "font" && candidate.arbitraryValue !== undefined) {
    // font-[450] → weight; font-[family-name:...] → family; font-[var(--x)] → unknown.
    const cls = classifyFontArbitrary(
      candidate.arbitraryValue,
      candidate.dataTypeHint,
    );
    if (cls.kind === "typography") for (const p of cls.properties) out.add(p);
    return out;
  }

  // tabular-nums / other font-variant-numeric utilities.
  if (u === "tabular-nums" || isFontVariantNumeric(u)) {
    out.add("font-variant-numeric");
    return out;
  }

  // whitespace-* → white-space.
  if (WHITESPACE_NAMED.test(u)) {
    out.add("white-space");
    return out;
  }
  // truncate → white-space + overflow + text-overflow (overflow-x covered).
  if (u === "truncate") {
    out.add("white-space");
    out.add("overflow-x");
    return out;
  }
  // overflow-x-* → overflow-x.
  if (OVERFLOW_X_NAMED.test(u)) {
    out.add("overflow-x");
    return out;
  }
  // min-h-* → min-height.
  if (u === "min-h" || /^min-h-/.test(u)) {
    out.add("min-height");
    return out;
  }

  // Everything else (flex, mt-4, rounded-*, p-3, gap-4, …) touches no owned prop.
  return out;
}

/** Map a CSS property name (from an arbitrary-property or inline-style key). */
function collectCssProperty(
  cssProp: string,
  out: Set<RecipeOwnedProperty>,
): void {
  const p = cssProp.trim();
  switch (p) {
    case "font-family":
      out.add("font-family");
      return;
    case "font-size":
      out.add("font-size");
      return;
    case "line-height":
      out.add("line-height");
      return;
    case "font-weight":
      out.add("font-weight");
      return;
    case "letter-spacing":
      out.add("letter-spacing");
      return;
    case "color":
      out.add("color");
      return;
    case "font-variant-numeric":
      out.add("font-variant-numeric");
      return;
    case "white-space":
      out.add("white-space");
      return;
    case "min-height":
      out.add("min-height");
      return;
    case "overflow-x":
      out.add("overflow-x");
      return;
    case "font":
      // The `font` shorthand sets family/size/line-height/weight.
      out.add("font-family");
      out.add("font-size");
      out.add("line-height");
      out.add("font-weight");
      return;
    default:
      return;
  }
}

/**
 * Resolve an inline-style property key (camelCase or CSS) to its owned-property
 * bundle. Returns empty for unknown keys. `font` expands to its sub-properties.
 */
export function propertiesTouchedByInlineKey(
  key: string,
): Set<RecipeOwnedProperty> {
  const out = new Set<RecipeOwnedProperty>();
  const mapped = INLINE_STYLE_PROPERTY_MAP[key];
  if (!mapped) return out;
  if (mapped === "font") {
    collectCssProperty("font", out);
  } else {
    out.add(mapped);
  }
  return out;
}

/** A font-variant-numeric utility (ordinal/slashed-zero/lining/oldstyle/…). */
function isFontVariantNumeric(u: string): boolean {
  return (
    u === "normal-nums" ||
    u === "ordinal" ||
    u === "slashed-zero" ||
    u === "lining-nums" ||
    u === "oldstyle-nums" ||
    u === "proportional-nums" ||
    u === "tabular-nums" ||
    u === "diagonal-fractions" ||
    u === "stacked-fractions"
  );
}

/**
 * Heuristic: does a named `text-*` token (non-arbitrary) look like a TEXT COLOR
 * rather than text-align/decoration/transform? Color tokens in Tailwind are
 * open-ended, but text-align/decoration/transform are a small known set.
 */
function looksLikeTextColor(u: string): boolean {
  // text-align / decoration / transform / wrap/balance/pretty — NOT color.
  const NON_COLOR = new Set([
    "text-center",
    "text-left",
    "text-right",
    "text-justify",
    "text-start",
    "text-end",
    "text-wrap",
    "text-nowrap",
    "text-balance",
    "text-pretty",
    "text-underline",
    "text-overline",
    "text-line-through",
    "text-no-underline",
    "text-uppercase",
    "text-lowercase",
    "text-capitalize",
    "text-normal-case",
  ]);
  if (NON_COLOR.has(u)) return false;
  // Anything else under text-* (text-red-500, text-muted-foreground, …) is a color.
  return true;
}

export type CandidateClassification =
  | { kind: "typography"; properties: RecipeOwnedProperty[] }
  | { kind: "color" }
  | { kind: "other" }
  | { kind: "unknown"; reason: string };

/**
 * Classify an arbitrary-value bracket form (the content inside `[...]` of a
 * `text-[…]` / `leading-[…]` / `tracking-[…]` / `font-[…]` utility) into
 * typography | color | other | unknown.
 *
 * The classifier NEVER guesses policy: a `var(--x)` without a data-type hint is
 * `unknown` (could be size or color), which the global rule treats as
 * review-only.
 */
export function classifyArbitraryValue(
  value: string,
  dataTypeHint?: string,
): CandidateClassification {
  // Explicit data-type hint wins: length:11px → font-size; color:#fff → color.
  if (dataTypeHint === "length" || dataTypeHint === "size")
    return { kind: "typography", properties: ["font-size"] };
  if (dataTypeHint === "color") return { kind: "color" };
  if (dataTypeHint === "number" || dataTypeHint === "integer")
    return { kind: "typography", properties: ["font-weight"] };
  if (dataTypeHint === "percentage")
    return { kind: "typography", properties: ["font-size"] };
  if (dataTypeHint === "family-name")
    return { kind: "typography", properties: ["font-family"] };
  if (dataTypeHint === "absolute-length" || dataTypeHint === "resolution")
    return { kind: "typography", properties: ["font-size"] };

  // No hint → infer from the value shape.
  // Color literals: hex, rgb()/hsl()/oklch(), named CSS colors.
  if (/^#([0-9a-fA-F]{3,8})$/.test(value)) return { kind: "color" };
  if (/^(rgb|hsl|oklch|oklab|lab|lch|color)\(/i.test(value)) {
    return { kind: "color" };
  }
  // CSS variable shorthand (Tailwind v4 `text-(--my-var)` form) is ambiguous.
  if (/^var\(/i.test(value) || /^--[\w-]+$/.test(value)) {
    return { kind: "unknown", reason: "requires-type-hint" };
  }
  // calc()/clamp() without a hint is ambiguous (could be length or color-mix).
  if (/^(calc|clamp|min|max)\(/i.test(value)) {
    return { kind: "unknown", reason: "requires-type-hint" };
  }
  // Length-looking value: number+unit (px/rem/em/pt/pc/in/cm/mm/vw/vh…).
  if (
    /^-?\d*\.?\d+(px|rem|em|ex|ch|pt|pc|in|cm|mm|vw|vh|vmin|vmax|q)$/i.test(
      value,
    )
  ) {
    return { kind: "typography", properties: ["font-size"] };
  }
  // Bare number (font-weight is unitless; line-height can be unitless too).
  // Without a hint a bare number on `text-[…]` is most likely a size in px-less
  // form rarely; we treat a bare number as ambiguous to avoid guessing.
  if (/^-?\d*\.?\d+$/.test(value)) {
    return { kind: "unknown", reason: "requires-type-hint" };
  }
  // A bare unit-less keyword that is a known CSS color name.
  if (IS_NAMED_COLOR.has(value.toLowerCase())) return { kind: "color" };
  // Anything else: review-only / other.
  return { kind: "other" };
}

/** Classify a `font-[…]` arbitrary value (weight vs family). */
function classifyFontArbitrary(
  value: string,
  dataTypeHint?: string,
): CandidateClassification {
  if (dataTypeHint === "family-name" || dataTypeHint === "font-family")
    return { kind: "typography", properties: ["font-family"] };
  if (dataTypeHint === "number" || dataTypeHint === "integer")
    return { kind: "typography", properties: ["font-weight"] };
  if (dataTypeHint === "weight")
    return { kind: "typography", properties: ["font-weight"] };
  // A bare number 1–1000 → font-weight (CSS allows any integer weight).
  if (
    /^\d{1,3}(\.\d+)?$/.test(value) &&
    Number(value) >= 1 &&
    Number(value) <= 1000
  )
    return { kind: "typography", properties: ["font-weight"] };
  if (/^var\(/i.test(value) || /^--[\w-]+$/.test(value))
    return { kind: "unknown", reason: "requires-type-hint" };
  return { kind: "other" };
}

const IS_NAMED_COLOR = new Set([
  "red",
  "orange",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "black",
  "white",
  "gray",
  "grey",
  "brown",
  "transparent",
  "currentColor",
  "currentcolor",
]);
