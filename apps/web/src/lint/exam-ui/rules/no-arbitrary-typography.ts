/**
 * exam-ui/no-arbitrary-typography
 *
 * Prevent new arbitrary typography values in business pages and feature
 * components. Arbitrary typography values bypass the forthcoming semantic
 * typography layer by pinning exact px/rem/line-height/letter-spacing values
 * inline (e.g. text-[11px], leading-[1.6], tracking-[-0.02em]).
 *
 * Detection (AST, not broad text grep): collects className tokens and flags
 * any matching the arbitrary-value forms:
 *
 *   text-[...]      (arbitrary font-size / arbitrary text color in brackets)
 *   leading-[...]
 *   tracking-[...]
 *
 * NOT banned yet (deliberately): all other text-*, font-*, leading-* named
 * utilities. Semantic typography recipes do not exist yet (planned
 * UI-RECIPE-1), so we only gate the arbitrary escape hatch.
 *
 * Existing debt is grandfathered by baseline. Today the only business-code
 * occurrence is ExamTimer.tsx (text-[11px]); components/ui occurrences are
 * excluded by config scope.
 *
 * Diagnostic-only: no autofix.
 */
import { createRule, maybeSuppress, asSuppressable } from "../ruleFactory";
import {
  collectClassNameTokens,
  findClassNameAttribute,
  type ClassNameToken,
} from "../classNameUtils";

const ARBITRARY_PREFIXES = ["text", "leading", "tracking"] as const;

/** True if a token is an arbitrary-value utility for one of the prefixes. */
function isArbitraryTypography(token: string): boolean {
  for (const prefix of ARBITRARY_PREFIXES) {
    if (token.startsWith(prefix + "-[") && token.endsWith("]")) {
      return true;
    }
  }
  return false;
}

export default createRule({
  name: "no-arbitrary-typography",
  meta: {
    type: "problem",
    docs: {
      description:
        "Business pages must not use arbitrary typography values (text-[...], leading-[...], tracking-[...]); await the semantic typography layer.",
    },
    schema: [],
    messages: {
      noArbitraryTypography:
        "Arbitrary typography value {{ token }} is not allowed in business pages. Use the forthcoming semantic typography recipe (UI-RECIPE-1) or, for a specialized runtime component, add a reviewed baseline entry.",
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
          .filter((v) => isArbitraryTypography(v));
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
