/**
 * exam-ui/no-arbitrary-typography
 *
 * Global token policy: business pages must not introduce arbitrary typography
 * VALUES. Arbitrary values bypass the semantic typography layer by pinning
 * exact px/rem/line-height/letter-spacing/font-weight/font-family values inline.
 *
 * (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §5, §6, §15, §16): the rule is now built on
 * the shared bracket-aware `parseTailwindCandidate` + `classifyArbitraryValue`,
 * replacing the destructive `stripVariants()` (which corrupted colons inside
 * `[...]`). The exact policy categories are explicit:
 *
 *   ENFORCED (typography): font-size, line-height, letter-spacing, font-weight,
 *     font-family. Covered routes now include:
 *       text-[11px], text-[length:11px]   (font-size)
 *       leading-[1.7], lh-[1.7]           (line-height)
 *       tracking-[0.02em]                 (letter-spacing)
 *       font-[450]                        (font-weight)
 *       font-[family-name:Inter]          (font-family)
 *       [font-size:11px]                  (arbitrary property)
 *       [line-height:1.7], [letter-spacing:..], [font-weight:..], [font-family:..]
 *       text-[11px]/[13px]                (slash line-height modifier)
 *     under any self/descendant/pseudo variant prefix (md:, hover:, group-hover:,
 *     data-[state=open]:, [&>span]:, …) and with the important/negative modifiers.
 *
 *   OUT OF POLICY (color): text-[color:var(--x)], text-[#fff], text-[rgb(..)].
 *     Text color is NOT typography; it is owned by the future color/token
 *     authority. These are deliberately NOT reported here. (Note: a color
 *     utility on a node that also selects a type-* recipe IS a recipe-authority
 *     conflict, reported by `no-typography-authority-conflict` — that is a
 *     different question from the global arbitrary-value ban.)
 *
 *   REVIEW-ONLY (unknown): text-[var(--x)], text-[calc(..)], bare numbers.
 *     Without a data-type hint these cannot be deterministically resolved to a
 *     typography category vs color; reporting them would guess policy. They are
 *     documented but NOT lint-enforced.
 *
 * Detection (AST, not broad text grep): collects className tokens and parses
 * each with `parseTailwindCandidate`; flags those whose classifier returns
 * `typography`.
 *
 * NOT banned: all named text / font / leading / tracking utilities, and the
 * semantic type-* recipes. Semantic typography recipes own the role layer; this
 * rule only gates the arbitrary escape hatch.
 *
 * Existing debt is grandfathered by baseline; the baseline array for this rule
 * is empty (the former ExamTimer text-[11px] entry was removed in W4A).
 * components/ui is excluded by config scope.
 *
 * Diagnostic-only: no autofix.
 */
import { createRule, maybeSuppress, asSuppressable } from "../ruleFactory";
import {
  collectClassNameTokens,
  findClassNameAttribute,
  type ClassNameToken,
} from "../classNameUtils";
import { parseTailwindCandidate } from "../tailwindCandidate";
import {
  propertiesTouchedBy,
  NO_ARBITRARY_TYPOGRAPHY_POLICY_CATEGORIES,
} from "../cssPropertyResolver";

/**
 * True if a parsed candidate is an arbitrary-value/property form that resolves
 * to a TYPOGRAPHY category (font-size / line-height / letter-spacing /
 * font-weight / font-family).
 *
 * The detection delegates to `propertiesTouchedBy` (prefix-aware: `leading-[1.6]`
 * → line-height, `font-[450]` → font-weight, `text-[length:11px]` → font-size)
 * and intersects with the typography policy categories. This correctly handles
 * prefix-disambiguated forms that the value-only classifier must leave UNKNOWN
 * (e.g. `leading-[1.6]` is unambiguously line-height by prefix, while a bare
 * `text-[1.6]` is ambiguous without a hint). Color routes (`text-[color:...]`,
 * `text-[#fff]`) resolve to `{color}` and are OUT of policy here.
 */
function isArbitraryTypographyToken(token: string): boolean {
  const c = parseTailwindCandidate(token);
  if (!c.ok) return false;
  // Only arbitrary-value, arbitrary-property, or arbitrary-slash-modifier forms
  // are policy targets. A named utility with an arbitrary slash modifier
  // (e.g. text-sm/[17px]) still touches typography properties via the base's
  // semantic role + the modifier's override — both are inside policy scope.
  if (
    c.arbitraryValue === undefined &&
    !c.arbitraryProperty &&
    !c.modifier?.startsWith("[")
  )
    return false;
  const touched = propertiesTouchedBy(c);
  for (const prop of touched) {
    if (NO_ARBITRARY_TYPOGRAPHY_POLICY_CATEGORIES.has(prop)) return true;
  }
  return false;
}

export default createRule({
  name: "no-arbitrary-typography",
  meta: {
    type: "problem",
    docs: {
      description:
        "Business pages must not use arbitrary typography values (text-[...], leading-[...], tracking-[...], font-[...], [font-size:...], slash modifiers); use the semantic typography recipe layer.",
    },
    schema: [],
    messages: {
      noArbitraryTypography:
        "Arbitrary typography value {{ token }} is not allowed in business pages. Use the semantic typography recipe (type-*) or, for a specialized runtime component, add a reviewed baseline entry.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      JSXOpeningElement(node) {
        const attr = findClassNameAttribute(node);
        if (!attr || !attr.value) return;

        const tokens: ClassNameToken[] = collectClassNameTokens(attr.value);
        if (tokens.length === 0) return;

        const hits = tokens
          .map((t) => t.value)
          .filter((v) => isArbitraryTypographyToken(v));
        if (hits.length === 0) return;

        maybeSuppress(
          asSuppressable(context),
          "no-arbitrary-typography",
          hits,
          attr,
          "noArbitraryTypography",
          { token: hits[0] },
        );
      },
    };
  },
});
