/**
 * exam-ui/no-recipe-recomposition
 *
 * UI-STABILIZATION-GOAL-1 (#305): after the secondary/metadata/numeric
 * migration waves closed every legitimate bypass, three raw utility stacks
 * remained that map 1:1 onto registered recipes — unlike the retired
 * `no-raw-typography` (text-{base,lg} + font-{semibold,bold}), whose
 * remaining hits were four distinct unregistered title roles with no sound
 * detector:
 *
 *   - `text-sm text-muted-foreground` replicates `type-secondary` (and drops
 *     its CJK line-height correction);
 *   - `text-xs text-muted-foreground` replicates `type-metadata` (same);
 *   - bare `tabular-nums` recomposes the `type-numeric` owned property —
 *     size/weight/family stay layout-owned and freely composable.
 *
 * Elements that already select a `type-*` recipe are out of scope: a recipe
 * plus conflicting utility is `no-typography-authority-conflict`'s territory,
 * not a recomposition. Weight-emphasized stacks (font-medium/semibold/bold)
 * render a different visual than the weight-400 recipes and stay legal local
 * roles (same unsoundness boundary that retired no-raw-typography). Variant-
 * prefixed utilities (md:text-sm) do not fire — the guard stays narrow rather
 * than guessing role across breakpoints. components/ui (generated shadcn
 * primitives) is excluded by the flat config.
 *
 * Diagnostic-only: no autofix.
 */
import { createRule, asSuppressable } from "../ruleFactory";
import {
  findClassNameAttribute,
  collectClassNameTokens,
  hasToken,
  hasAnyToken,
} from "../classNameUtils";

/** Weight utilities that make a stack a deliberate non-recipe emphasis role. */
const WEIGHT_EMPHASIS = ["font-medium", "font-semibold", "font-bold"];

export default createRule({
  name: "no-recipe-recomposition",
  meta: {
    type: "problem",
    docs: {
      description:
        "Raw recomposition of registered typography recipes: text-sm+text-muted-foreground (type-secondary), text-xs+text-muted-foreground (type-metadata), bare tabular-nums (type-numeric).",
    },
    schema: [],
    messages: {
      useTypeSecondary:
        "`text-sm text-muted-foreground` recomposes the `type-secondary` recipe and drops its CJK line-height. Use `type-secondary`.",
      useTypeMetadata:
        "`text-xs text-muted-foreground` recomposes the `type-metadata` recipe and drops its CJK line-height. Use `type-metadata`.",
      useTypeNumeric:
        "`tabular-nums` recomposes the `type-numeric` owned property. Use `type-numeric`; size/weight stay layout-owned.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      JSXOpeningElement(node) {
        const attr = findClassNameAttribute(node);
        if (!attr || !attr.value) return;

        const tokens = collectClassNameTokens(attr.value);
        if (tokens.length === 0) return;

        // Recipe-selected nodes are no-typography-authority-conflict's territory.
        if (hasAnyToken(tokens, (v) => v.startsWith("type-"))) return;
        // Deliberate weight emphasis is a different (unregistered) role.
        if (hasAnyToken(tokens, (v) => WEIGHT_EMPHASIS.includes(v))) return;

        if (
          hasToken(tokens, "text-sm") &&
          hasToken(tokens, "text-muted-foreground")
        ) {
          asSuppressable(context).report({
            node: attr,
            messageId: "useTypeSecondary",
          });
          return;
        }
        if (
          hasToken(tokens, "text-xs") &&
          hasToken(tokens, "text-muted-foreground")
        ) {
          asSuppressable(context).report({
            node: attr,
            messageId: "useTypeMetadata",
          });
          return;
        }
        if (hasToken(tokens, "tabular-nums")) {
          asSuppressable(context).report({
            node: attr,
            messageId: "useTypeNumeric",
          });
        }
      },
    };
  },
});
