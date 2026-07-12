/**
 * Shared Tailwind candidate parser (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §6).
 *
 * Parses ONE static Tailwind candidate (a single whitespace-delimited token
 * from a className) into its structural regions WITHOUT fully validating it as
 * Tailwind, and WITHOUT damaging bracket/parenthesis contents.
 *
 * Why this exists: the prior `stripVariants()` in `no-arbitrary-typography.ts`
 * peeled variant prefixes with `indexOf(":")` in a loop and had NO bracket
 * awareness. It corrupted arbitrary values that contain colons inside brackets:
 *
 *   text-[length:11px]   → peeled the inner ":11px]" off as a "variant"
 *   [&>span]:text-lg     → mangled the arbitrary descendant variant
 *   group-[.is-published]:block → wrong
 *
 * This parser tracks balanced `[]`/`()` so a colon INSIDE brackets is treated as
 * data-type/value content (never a variant separator), and a slash INSIDE
 * brackets is never a modifier. Unbalanced input returns `ok: false` (UNKNOWN);
 * the caller must never invent meaning from a failed parse.
 *
 * Parser principles (authority record §6):
 *   colon outside balanced brackets/parentheses → may separate variants
 *   colon inside [...]                          → data-type/value content
 *   slash outside balanced brackets             → may be a modifier
 *   escaped delimiter (\:)                      → not structural
 *   unbalanced syntax                           → ok:false (UNKNOWN)
 *
 * This is NOT a Tailwind compiler. It preserves only the structure the
 * repository's deterministic rules need: variants, target, important, negative,
 * base utility, arbitrary value, arbitrary property, data-type hint, modifier.
 */
export type CandidateTarget =
  | "self"
  | "descendant"
  | "pseudo-element"
  | "unknown";

export type ParsedTailwindCandidate = {
  /** The original candidate string. */
  original: string;
  /** False when the input is unbalanced/garbled; callers must treat it as UNKNOWN. */
  ok: boolean;
  /** Variant prefix segments WITHOUT the trailing colon, in source order. */
  variants: string[];
  /**
   * Where a variant (or the absence of one) targets relative to the element
   * that owns the className. `self` = the element itself (hover/focus/responsive
   * /data/aria/group/peer/theme/supports); `descendant` = a child/descendant
   * (`[&>span]:`, `*:`, `[&_p]:`); `pseudo-element` = a generated box
   * (`before:`/`after:`/`placeholder:`/`marker:`/`first-letter:`/`selection:`);
   * `unknown` = an unparseable arbitrary variant.
   */
  target: CandidateTarget;
  /** True if the candidate ends with the important modifier `!`. */
  important: boolean;
  /** True if the candidate has a leading `-` (negative utility). */
  negative: boolean;
  /**
   * The base utility stem, e.g. "text", "leading", "tracking", "font",
   * "whitespace", "min-h", "overflow-x", "tabular-nums". Empty string when the
   * WHOLE token is an arbitrary property (`[font-size:11px]`).
   */
  utility: string;
  /** Arbitrary-value CONTENT (brackets stripped) for a `utility-[...]` form. */
  arbitraryValue?: string;
  /** Data-type hint inside an arbitrary value, e.g. "length" in `text-[length:11px]`. */
  dataTypeHint?: string;
  /** Parsed arbitrary-property form `[prop:val]` (whole-token bracketed). */
  arbitraryProperty?: { property: string; value: string };
  /** Slash modifier content (after the `/`), e.g. "13px" or "[13px]". */
  modifier?: string;
};

/** Sentinel returned for unparseable input. */
const UNKNOWN = (original: string): ParsedTailwindCandidate => ({
  original,
  ok: false,
  variants: [],
  target: "unknown",
  important: false,
  negative: false,
  utility: "",
});

/**
 * Find the index of `sep` that is OUTSIDE any balanced `[]`/`()` region, or -1.
 * Escaped characters (`\x`) are skipped. This is the core bracket-awareness
 * helper that replaces naive `indexOf`/`split`.
 */
function indexOfTopLevel(s: string, sep: string, start = 0): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++; // skip the escaped char
      continue;
    }
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") {
      depth--;
      if (depth < 0) return -1; // unbalanced → caller bails
    } else if (depth === 0 && s.startsWith(sep, i)) {
      return i;
    }
  }
  return depth === 0 ? -1 : -1; // unbalanced dangling opener
}

/** True if the bracket/parenthesis structure of `s` is balanced. */
function isBalanced(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/** Check for a descendant/child combinator at the top level (outside parens/brackets). */
function hasTopLevelCombinator(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && /[ >+~]/.test(ch)) return true;
    else if (depth === 0 && ch === "_" && i > 0) return true;
  }
  return false;
}

/** Classify a single variant prefix (without trailing colon) into a target. */
function variantTarget(variant: string): CandidateTarget {
  // Arbitrary descendant variants wrap a selector that targets a child/descendant:
  //   [&>span] [&_p] [.is-published &]  → descendant
  // Arbitrary variants that select the element itself in a special state:
  //   [&:hover] [&[data-open]]          → self (handled by pseudo-class detection)
  if (variant.startsWith("[") && variant.endsWith("]")) {
    const inner = variant.slice(1, -1);
    // A combinator (>, +, ~) or a descendant space targets a descendant/child —
    // NOT the recipe-owning element itself. Inside a Tailwind arbitrary variant,
    // `_` is the whitespace escape (so `[&_p]` ⇒ `& p` ⇒ descendant).
    // Check only top-level combinators — spaces inside parentheses (e.g.
    // `:has(.foo .bar)`) are selector arguments, not descendant combinators.
    if (hasTopLevelCombinator(inner)) return "descendant";
    return "self";
  }
  // Pseudo-element generators target a generated box, not the element's own text.
  if (
    variant === "before" ||
    variant === "after" ||
    variant === "placeholder" ||
    variant === "marker" ||
    variant === "first-letter" ||
    variant === "selection" ||
    variant === "file-selector-button"
  ) {
    return "pseudo-element";
  }
  // `*` / `**` universal-target variants and child combinators target descendants.
  if (variant === "*" || variant === "**") return "descendant";
  // All other named variants (hover, focus, disabled, data-[…], aria-…,
  // group-*, peer-*, dark, responsive, supports-*, container, print,…) target
  // the element itself.
  return "self";
}

/**
 * Parse a static Tailwind candidate into its structural regions.
 * Returns `ok: false` (UNKNOWN) for unbalanced/garbled input.
 */
export function parseTailwindCandidate(raw: string): ParsedTailwindCandidate {
  if (!raw) return UNKNOWN(raw);
  if (!isBalanced(raw)) return UNKNOWN(raw);

  let rest = raw;
  const variants: string[] = [];
  let target: CandidateTarget = "self";

  // 1. Peel variant prefixes: a top-level ":" outside brackets separates a
  //    variant from the rest. Stop when no top-level colon remains.
  while (true) {
    const colon = indexOfTopLevel(rest, ":");
    if (colon <= 0) break; // no variant separator (or leading ":" — malformed)
    const variant = rest.slice(0, colon);
    if (!variant) break; // empty variant → stop, treat remainder as-is
    // The overall target is the MOST-SPECIFIC non-self target among variants:
    // a descendant/pseudo-element variant means the utility does NOT apply to
    // the recipe-owning element's own properties.
    const vt = variantTarget(variant);
    if (vt !== "self" && target === "self") target = vt;
    if (vt === "unknown") target = "unknown";
    variants.push(variant);
    rest = rest.slice(colon + 1);
    if (!rest) return UNKNOWN(raw); // variant with nothing after it
  }

  // 2. Important modifier: trailing "!".
  let important = false;
  if (rest.endsWith("!")) {
    important = true;
    rest = rest.slice(0, -1);
    if (!rest) return UNKNOWN(raw);
  }

  // 3. Negative utility: leading "-" (but not a standalone "-").
  let negative = false;
  if (rest.startsWith("-")) {
    negative = true;
    rest = rest.slice(1);
    if (!rest) return UNKNOWN(raw);
  }

  // 4. Whole-token arbitrary PROPERTY form: [prop:val] (or [prop]).
  if (rest.startsWith("[") && rest.endsWith("]")) {
    const inner = rest.slice(1, -1);
    const propSep = indexOfTopLevel(inner, ":");
    if (propSep >= 0) {
      return {
        original: raw,
        ok: true,
        variants,
        target,
        important,
        negative,
        utility: "",
        arbitraryProperty: {
          property: inner.slice(0, propSep),
          value: inner.slice(propSep + 1),
        },
      };
    }
    // [val] with no property — treat as arbitrary value on an empty utility
    // (rare; e.g. a bare arbitrary property without a known prefix). Still ok.
    return {
      original: raw,
      ok: true,
      variants,
      target,
      important,
      negative,
      utility: "",
      arbitraryValue: inner,
    };
  }

  // 5. Slash modifier: a top-level "/" outside brackets separates the modifier.
  let modifier: string | undefined;
  const slash = indexOfTopLevel(rest, "/");
  let base = rest;
  if (slash > 0) {
    modifier = rest.slice(slash + 1);
    base = rest.slice(0, slash);
    if (!base || !modifier) return UNKNOWN(raw);
  }

  // 6. Utility + optional arbitrary value: "utility-[arbitrary]" or "utility-stem".
  const bracketOpen = base.indexOf("-[");
  if (bracketOpen >= 0) {
    const utility = base.slice(0, bracketOpen);
    const arb = base.slice(bracketOpen + 2);
    if (!arb.endsWith("]")) return UNKNOWN(raw);
    const value = arb.slice(0, -1);
    if (!utility) return UNKNOWN(raw);
    // data-type hint? "length:11px" → hint "length", value "11px".
    const hintSep = indexOfTopLevel(value, ":");
    if (hintSep >= 0) {
      return {
        original: raw,
        ok: true,
        variants,
        target,
        important,
        negative,
        utility,
        arbitraryValue: value.slice(hintSep + 1),
        dataTypeHint: value.slice(0, hintSep),
        modifier,
      };
    }
    return {
      original: raw,
      ok: true,
      variants,
      target,
      important,
      negative,
      utility,
      arbitraryValue: value,
      modifier,
    };
  }

  // 7. Plain named utility (e.g. "text-sm", "leading-tight", "font-mono",
  //    "tabular-nums", "min-h-16"). No arbitrary value.
  if (!base) return UNKNOWN(raw);
  return {
    original: raw,
    ok: true,
    variants,
    target,
    important,
    negative,
    utility: base,
    modifier,
  };
}
