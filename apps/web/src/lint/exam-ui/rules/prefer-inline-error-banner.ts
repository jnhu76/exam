/**
 * exam-ui/prefer-inline-error-banner
 *
 * Detects the inline destructive banner recipe already owned by the shared
 * `InlineErrorBanner` component
 * (`apps/web/src/components/shared/InlineErrorBanner.tsx`):
 *
 *   <div role="alert"
 *        className="rounded-md border border-destructive bg-destructive/10
 *                   px-4 py-3 text-sm text-destructive">
 *     {errorMessage}
 *   </div>
 *
 * High-confidence boundary (NARROWED in UI-MIGRATE-N-W2 §10): a `<div>`
 * carrying ALL of:
 *   - a static `role="alert"` attribute (the authority-owned a11y contract);
 *   - a `rounded-*` utility;
 *   - at least TWO distinct destructive-surface/text utilities.
 *
 * Requiring `role="alert"` is the sound deterministic narrowing that excludes
 * false-semantic-overlap shapes that merely reuse destructive color for
 * non-error control/state surfaces (e.g. a low-time timer chip, a multi-role
 * status message). The InlineErrorBanner authority always renders
 * `role="alert"`; a genuine bypass of its anatomy does too.
 *
 * Not reported:
 *   - InlineErrorBanner itself (exempt by filename);
 *   - a destructive+rounded `<div>` WITHOUT `role="alert"` (a different,
 *     non-banner role — destructive control state, status surface, etc.);
 *   - a `<div>` with only ONE destructive utility (e.g. just text-destructive);
 *   - a `<div>` with destructive utilities but NO rounded utility;
 *   - purely dynamic className or dynamic role values.
 *
 * Diagnostic-only: no autofix.
 *
 * Scope: business / feature source via ESLint config `files` glob;
 * components/ui is excluded there.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { createRule, maybeSuppress, asSuppressable } from "../ruleFactory";
import {
  collectClassNameTokens,
  findClassNameAttribute,
  hasAnyToken,
  type ClassNameToken,
} from "../classNameUtils";

function isRounded(token: string): boolean {
  return /^rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?$/.test(token);
}

/**
 * Returns true iff the element carries a STATIC `role="alert"` attribute.
 * A dynamic role expression (e.g. `role={x}`) is treated as not-an-alert so
 * the rule never reasons about runtime values — it only matches the literal
 * authority anatomy.
 */
function hasStaticAlertRole(node: TSESTree.JSXOpeningElement): boolean {
  for (const attr of node.attributes) {
    if (attr.type !== "JSXAttribute") continue;
    if (attr.name.type !== "JSXIdentifier" || attr.name.name !== "role")
      continue;
    const value = attr.value;
    if (value && value.type === "Literal" && value.value === "alert") {
      return true;
    }
    if (value && value.type === "JSXExpressionContainer") {
      const expr = value.expression;
      if (expr.type === "Literal" && expr.value === "alert") return true;
    }
    return false;
  }
  return false;
}

export default createRule({
  name: "prefer-inline-error-banner",
  meta: {
    type: "problem",
    docs: {
      description:
        "Inline destructive error banners must use the shared InlineErrorBanner component instead of a hand-rolled destructive <div role=alert>.",
    },
    schema: [],
    messages: {
      preferInlineErrorBanner:
        "This inline destructive error banner recipe (a <div role=alert> with a rounded utility + multiple destructive surface utilities) is owned by the shared InlineErrorBanner component. Use <InlineErrorBanner>{...}</InlineErrorBanner> from @/components/shared/InlineErrorBanner instead of recreating it with primitive Tailwind utilities.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (!isHtmlDiv(node)) return;

        // NARROW (UI-MIGRATE-N-W2 §10): require the authority-owned a11y
        // contract. This excludes destructive-color control/state surfaces
        // (timer chips, multi-role status messages) that have no role attr.
        if (!hasStaticAlertRole(node)) return;

        const attr = findClassNameAttribute(node);
        if (!attr || !attr.value) return;

        const tokens: ClassNameToken[] = collectClassNameTokens(attr.value);
        if (tokens.length === 0) return;

        if (!hasAnyToken(tokens, isRounded)) return;

        // Count DISTINCT destructive families present (border / bg / text).
        const families = new Set<string>();
        for (const t of tokens) {
          if (/^border-destructive(\/\d+)?$/.test(t.value))
            families.add("border");
          else if (/^bg-destructive(\/\d+|-soft)?$/.test(t.value))
            families.add("bg");
          else if (/^text-destructive(\/\d+)?$/.test(t.value))
            families.add("text");
        }
        if (families.size < 2) return;

        // Exclude the authority implementation itself.
        if (
          context.filename.endsWith("components/shared/InlineErrorBanner.tsx")
        ) {
          return;
        }

        maybeSuppress(
          asSuppressable(context),
          "prefer-inline-error-banner",
          ["rounded", "destructive-surface"],
          attr,
          "preferInlineErrorBanner",
        );
      },
    };
  },
});

function isHtmlDiv(node: TSESTree.JSXOpeningElement): boolean {
  const name = node.name;
  return name.type === "JSXIdentifier" && name.name === "div";
}
