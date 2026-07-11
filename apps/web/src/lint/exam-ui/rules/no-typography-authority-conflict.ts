/**
 * exam-ui/no-typography-authority-conflict
 *
 * Deterministic, semantic-free recipe-authority conflict gate
 * (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §12).
 *
 * Fires when a JSX node selects a `type-*` recipe AND, on the SAME
 * co-occurrence path, another self-target utility (or an inline-style key)
 * touches one of that recipe's `ownedProperties`.
 *
 * Why this is sound (and the retired `no-raw-typography` was not): this rule
 * does NOT infer semantic roles from text, tag names, or filenames. The
 * presence of a `type-*` class IS the semantic declaration — the author has
 * explicitly selected the recipe. The rule only checks whether a sibling
 * utility or inline style mutates a property the recipe already owns. There is
 * no false-semantic-overlap surface.
 *
 * Model (RECON-1):
 *   - Cascade policy A (PROVEN): unlayered recipes WIN over layered utilities,
 *     so a self-target owned-property utility is a GENUINE conflict — it is
 *     either dead (the recipe overrides it) or, with `!`, authority-piercing.
 *     Either way it must be removed.
 *   - Property BUNDLES, not single utilities: `text-3xl` touches BOTH
 *     font-size and line-height (Tailwind v4 docs); it conflicts only if
 *     EITHER is owned. `type-metric text-3xl` is valid because metric
 *     layout-owns size+line-height.
 *   - Variant TARGET: a descendant/pseudo-element variant
 *     (`[&>span]:`, `before:`, `placeholder:`…) targets a different element or
 *     generated box — it does NOT conflict with the root recipe. Only
 *     `target=self` utilities conflict.
 *   - Co-occurrence PATHS: `cond ? "type-metadata" : "type-metric text-3xl"`
 *     yields TWO paths checked independently; no cross-path false conflict.
 *   - Inline style: on a recipe node, a static inline-style key that maps to an
 *     owned property conflicts (value-agnostic — any inline style on the recipe
 *     node overrides the recipe at runtime). A dynamic `style={x}` /
 *     `style={{...props.style}}` cannot be resolved → not enforced here.
 *   - Color participates: most recipes own `color`, so `text-red-500` or
 *     `style={{color}}` on a recipe node conflicts (color is OUT of the global
 *     arbitrary rule but IN of recipe ownership).
 *   - Multiple recipes on one path → MULTIPLE_TYPE_RECIPES_ON_SAME_PATH error.
 *
 * NOT reported:
 *   - descendant/pseudo-element variant utilities on a recipe node;
 *   - structural utilities (flex, mt-4, rounded-*, p-3, min-h-* when min-height
 *     is layout-owned, …) that touch no owned property;
 *   - fully dynamic className (analyzer returns unknown);
 *   - a dynamic `style={computedStyle}` (cannot resolve keys).
 *
 * Diagnostic-only: no autofix.
 *
 * Scope: business / feature source via ESLint config `files` glob; components/ui
 * is excluded there.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { createRule, maybeSuppress, asSuppressable } from "../ruleFactory";
import { findClassNameAttribute } from "../classNameUtils";
import { analyzeClassExpression } from "../classExpressionAnalyzer";
import { parseTailwindCandidate } from "../tailwindCandidate";
import {
  propertiesTouchedBy,
  propertiesTouchedByInlineKey,
  type RecipeOwnedProperty,
} from "../cssPropertyResolver";
import { getRecipeAuthority } from "../../../typography/recipeRegistry";

/** Recipe class prefix the rule keys on. */
const RECIPE_PREFIX = "type-";

/** Collect static property KEYS present in an inline `style={{...}}` object. */
function collectStaticStyleKeys(styleAttr: TSESTree.JSXAttribute | null): {
  keys: string[];
  fullyDynamic: boolean;
} {
  if (!styleAttr || !styleAttr.value) return { keys: [], fullyDynamic: true };
  const value = styleAttr.value;
  // Only style={{...}} (JSXExpressionContainer wrapping an ObjectExpression) is
  // resolvable. style="..." (string) and style={computedStyle} are not.
  if (value.type !== "JSXExpressionContainer") {
    return { keys: [], fullyDynamic: true };
  }
  const expr = value.expression;
  if (expr.type !== "ObjectExpression") {
    // style={someVar}, style={cond ? a : b}, style={{...props.style}} — dynamic.
    return { keys: [], fullyDynamic: true };
  }
  const keys: string[] = [];
  for (const prop of expr.properties) {
    if (prop.type !== "Property") continue;
    if (prop.computed) {
      // A computed key is not statically resolvable → treat the whole style as
      // dynamic (conservative; do not enforce partial).
      return { keys: [], fullyDynamic: true };
    }
    const keyNode = prop.key;
    if (keyNode.type === "Identifier") {
      keys.push(keyNode.name);
    } else if (
      keyNode.type === "Literal" &&
      typeof keyNode.value === "string"
    ) {
      keys.push(keyNode.value);
    } else {
      return { keys: [], fullyDynamic: true };
    }
  }
  return { keys, fullyDynamic: false };
}

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

/** Convert a touched-property set + recipe ownership into a sorted conflict list. */
function conflictingOwnedProperties(
  touched: Set<RecipeOwnedProperty>,
  owned: readonly RecipeOwnedProperty[],
): RecipeOwnedProperty[] {
  const ownedSet = new Set(owned);
  return [...touched].filter((p) => ownedSet.has(p)).sort();
}

export default createRule({
  name: "no-typography-authority-conflict",
  meta: {
    type: "problem",
    docs: {
      description:
        "A type-* recipe owns its properties; a sibling self-target utility or inline-style key that touches an owned property is an authority conflict.",
    },
    schema: [],
    messages: {
      authorityConflict:
        "{{recipe}} owns {{properties}}. Remove the conflicting utility {{utility}} (the recipe wins under cascade policy A, so the utility is dead — or, with the important modifier, authority-piercing).",
      authorityConflictInlineStyle:
        "{{recipe}} owns {{properties}}. Remove the conflicting inline-style key {{key}} (inline style overrides the recipe at runtime).",
      multipleRecipes:
        "Multiple type-* recipes ({{recipes}}) on one className path. A node must select exactly one typography recipe.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      JSXOpeningElement(node) {
        const classAttr = findClassNameAttribute(node);
        if (!classAttr || !classAttr.value) return;

        // 1. Analyze the className into co-occurrence paths.
        const analysis = analyzeClassExpression(classAttr.value);
        if (analysis.kind === "unknown") return; // dynamic — review-only.

        // 2. Inspect the inline style keys once (shared across paths; static only).
        const styleAttr = findStyleAttribute(node);
        const styleInfo = collectStaticStyleKeys(styleAttr);

        // 3. For each co-occurrence path, find recipe(s) + conflicting utilities.
        let reportedInline = false; // report inline conflict once per node
        for (const path of analysis.alternatives) {
          // Identify recipe classes on this path.
          const recipesOnPath: { token: string; name: string }[] = [];
          for (const token of path) {
            if (token.startsWith(RECIPE_PREFIX)) {
              const name = token.slice(RECIPE_PREFIX.length);
              if (getRecipeAuthority(name)) recipesOnPath.push({ token, name });
            }
          }
          if (recipesOnPath.length === 0) continue;

          // 3a. Multiple recipes on one path → error (report on the className attr).
          if (recipesOnPath.length > 1) {
            maybeSuppress(
              asSuppressable(context),
              "no-typography-authority-conflict",
              recipesOnPath.map((r) => r.token),
              classAttr,
              "multipleRecipes",
              { recipes: recipesOnPath.map((r) => r.token).join(", ") },
            );
            continue; // the multiple-recipe error subsumes per-recipe conflicts.
          }

          const selectedRecipe = recipesOnPath[0];
          if (!selectedRecipe) continue;
          const authority = getRecipeAuthority(selectedRecipe.name);
          if (!authority) continue;
          const owned = authority.ownedProperties;

          // 3b. Check each NON-recipe utility on the path for property overlap.
          for (const token of path) {
            if (token.startsWith(RECIPE_PREFIX)) continue; // the recipe itself
            const candidate = parseTailwindCandidate(token);
            if (!candidate.ok) continue;
            // Only self-target utilities conflict with the root recipe.
            if (candidate.target !== "self") continue;
            const touched = propertiesTouchedBy(candidate);
            const conflictProps = conflictingOwnedProperties(touched, owned);
            if (conflictProps.length === 0) continue;
            maybeSuppress(
              asSuppressable(context),
              "no-typography-authority-conflict",
              [token],
              classAttr,
              "authorityConflict",
              {
                recipe: selectedRecipe.token,
                properties: conflictProps.join(", "),
                utility: token,
              },
            );
          }

          // 3c. Inline-style keys on the recipe node touch owned properties.
          // Report once per node (the keys co-occur as one style object).
          if (!reportedInline && !styleInfo.fullyDynamic && styleAttr) {
            for (const key of styleInfo.keys) {
              const touched = propertiesTouchedByInlineKey(key);
              const conflictProps = conflictingOwnedProperties(touched, owned);
              if (conflictProps.length === 0) continue;
              reportedInline = true;
              maybeSuppress(
                asSuppressable(context),
                "no-typography-authority-conflict",
                [`style:${key}`],
                styleAttr,
                "authorityConflictInlineStyle",
                {
                  recipe: selectedRecipe.token,
                  properties: conflictProps.join(", "),
                  key,
                },
              );
              break; // one inline-style report per node is enough
            }
          }
        }
      },
    };
  },
});
