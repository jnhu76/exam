/**
 * exam-ui/no-arbitrary-inline-typography
 *
 * Global token policy: business pages must not set one-off typography values
 * via inline JSX `style={{ ... }}`. Inline styles bypass the semantic
 * typography layer the same way arbitrary-value brackets do, and they cannot be
 * governed by the recipe-conflict rule unless a `type-*` recipe is also
 * selected on the same node.
 *
 * (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §15, §16): detects a STATIC inline-style
 * property whose key maps to a typography category (font-size / line-height /
 * letter-spacing / font-weight / font-family). Only static LITERAL values are
 * reported — a dynamic value (`style={{ fontSize: size }}`) is not statically
 * resolvable as "one-off" and is left to review (it may be a computed scaling
 * value). The `font` shorthand is included (it sets multiple typography props).
 *
 * De-dup with the conflict rule: when a node ALSO selects a `type-*` recipe and
 * the inline-style key touches a property that recipe OWNS, the
 * `no-typography-authority-conflict` rule reports the more specific
 * authority-conflict diagnostic instead. This rule still reports a typography
 * one-off that the recipe does NOT own (e.g. `type-numeric`'s size is
 * layout-owned, so `style={{ fontSize: 11 }}` is still an arbitrary one-off).
 *
 * NOT reported:
 *   - a dynamic style value on a typography key (review-only);
 *   - a static non-typography inline style (display, margin, …);
 *   - a dynamic `style={computedStyle}` / `style={{...props.style}}` (cannot
 *     resolve keys);
 *   - `components/ui` (excluded by config scope).
 *
 * Zero existing debt (verified: no inline-style typography exists in lint scope).
 *
 * Diagnostic-only: no autofix.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { createRule, maybeSuppress, asSuppressable } from "../ruleFactory";
import {
  collectClassNameTokens,
  findClassNameAttribute,
  type ClassNameToken,
} from "../classNameUtils";
import { propertiesTouchedByInlineKey } from "../cssPropertyResolver";
import { getRecipeAuthority } from "../../../typography/recipeRegistry";

const RECIPE_PREFIX = "type-";

/** Typography categories this rule enforces on inline styles. */
const INLINE_TYPOGRAPHY_KEYS = new Set([
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "fontWeight",
  "fontFamily",
  "font", // shorthand → expands to multiple typography props
]);

/** Find the static `style` JSXAttribute on a JSXOpeningElement, if any. */
function findStyleAttribute(
  node: TSESTree.JSXOpeningElement,
): TSESTree.JSXAttribute | null {
  for (const attr of node.attributes) {
    if (
      attr.type === "JSXAttribute" &&
      attr.name.type === "JSXIdentifier" &&
      attr.name.name === "style"
    ) {
      return attr;
    }
  }
  return null;
}

/** Read a static property key from an ObjectExpression Property, or null. */
function staticKey(prop: TSESTree.Property): string | null {
  if (prop.computed) return null;
  const key = prop.key;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

/**
 * Collect the recipe names selected on the node's className, so we can de-dup
 * against the conflict rule (yield when the recipe owns the touched property).
 * Only statically-resolvable recipe tokens are considered.
 */
function recipeNamesOnNode(
  classAttr: TSESTree.JSXAttribute | null,
): Set<string> {
  const out = new Set<string>();
  if (!classAttr || !classAttr.value) return out;
  // Reuse the flat extractor for recipe-name presence (recipes are static).
  const tokens: ClassNameToken[] = collectClassNameTokens(classAttr.value);
  for (const t of tokens) {
    if (t.value.startsWith(RECIPE_PREFIX)) {
      const name = t.value.slice(RECIPE_PREFIX.length);
      if (getRecipeAuthority(name)) out.add(name);
    }
  }
  return out;
}

export default createRule({
  name: "no-arbitrary-inline-typography",
  meta: {
    type: "problem",
    docs: {
      description:
        "Business pages must not set one-off typography via inline style (fontSize/lineHeight/letterSpacing/fontWeight/fontFamily); use the semantic typography recipe layer.",
    },
    schema: [],
    messages: {
      noArbitraryInlineTypography:
        "Arbitrary inline typography style {{ key }} is not allowed in business pages. Use the semantic typography recipe (type-*) instead of a one-off inline value.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      JSXOpeningElement(node) {
        const styleAttr = findStyleAttribute(node);
        if (!styleAttr || !styleAttr.value) return;
        const value = styleAttr.value;
        // Only style={{...}} (ObjectExpression) is resolvable.
        if (value.type !== "JSXExpressionContainer") return;
        const expr = value.expression;
        if (expr.type !== "ObjectExpression") return; // dynamic — review-only.

        const recipes = recipeNamesOnNode(findClassNameAttribute(node));

        for (const prop of expr.properties) {
          if (prop.type !== "Property") continue;
          const key = staticKey(prop);
          if (!key) continue; // computed key → not statically resolvable.
          if (!INLINE_TYPOGRAPHY_KEYS.has(key)) continue; // non-typography.
          // Only a STATIC literal value is a "one-off" the policy forbids. A
          // dynamic value (identifier/member/call) may be a computed scaling
          // value → review-only, not lint-enforced.
          if (prop.value.type !== "Literal") continue;

          // De-dup: if a recipe on this node OWNS the touched property, the
          // conflict rule reports the authority-conflict diagnostic instead.
          const touched = propertiesTouchedByInlineKey(key);
          const ownedByRecipe = [...recipes].some((name) => {
            const authority = getRecipeAuthority(name);
            return authority
              ? [...authority.ownedProperties].some((p) => touched.has(p))
              : false;
          });
          if (ownedByRecipe) continue; // conflict rule owns this diagnostic.

          maybeSuppress(
            asSuppressable(context),
            "no-arbitrary-inline-typography",
            [`style:${key}`],
            prop,
            "noArbitraryInlineTypography",
            { key },
          );
        }
      },
    };
  },
});
