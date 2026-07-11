/**
 * exam-ui/no-arbitrary-typography
 *
 * Global token policy: business pages must not introduce arbitrary typography
 * VALUES. Arbitrary values bypass the semantic typography layer by pinning
 * exact px/rem/line-height/letter-spacing values inline (e.g. text-[11px],
 * leading-[1.6], tracking-[-0.02em]). This is a syntax/token policy, not a
 * semantic-role proxy: the forbidden shape is the arbitrary-value bracket
 * form, regardless of the semantic role the element carries.
 *
 * Detection (AST, not broad text grep): collects className tokens and flags
 * any matching the arbitrary-value forms, after stripping responsive/state
 * variant prefixes so the policy holds under variants too:
 *
 *   text-[...]      (arbitrary font-size / arbitrary text color in brackets)
 *   leading-[...]
 *   tracking-[...]
 *   md:text-[...]   (responsive variant — still an arbitrary value)
 *   hover:leading-[...]
 *
 * NOT banned (deliberately): all other text-*, font-*, leading-* named
 * utilities. Semantic typography recipes own the role layer; this rule only
 * gates the arbitrary escape hatch.
 *
 * Existing debt is grandfathered by baseline. After UI-MIGRATE-N-W4A the
 * ExamTimer text-[11px] baseline entry was removed (the node migrated to the
 * type-metadata recipe), so the baseline array for this rule is empty.
 * components/ui occurrences are excluded by config scope.
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

/**
 * Strip Tailwind variant prefixes (responsive `sm:`/`md:`/`lg:`…, state
 * `hover:`/`focus:`/`active:`…, and stacked variants like `group-hover:`) so
 * the global token policy is enforced regardless of variant. The policy forbids
 * arbitrary typography VALUES; a `md:text-[11px]` is still an arbitrary
 * font-size, so it must be detected.
 */
function stripVariants(token: string): string {
  let rest = token;
  // A variant prefix is `name:` possibly with a trailing value group; we only
  // need to peel colon-terminated segments until a known utility prefix remains.
  while (true) {
    const colon = rest.indexOf(":");
    if (colon <= 0) return rest;
    rest = rest.slice(colon + 1);
  }
}

/** True if a token is an arbitrary-value utility for one of the prefixes. */
function isArbitraryTypography(token: string): boolean {
  const stripped = stripVariants(token);
  for (const prefix of ARBITRARY_PREFIXES) {
    if (stripped.startsWith(prefix + "-[") && stripped.endsWith("]")) {
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
