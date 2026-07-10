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
 * High-confidence boundary: a `<div>` carrying a `rounded-*` utility AND at
 * least TWO distinct destructive-surface/text utilities. Requiring a
 * combination (not a single color class) avoids treating every destructive
 * surface as a banner — e.g. a delete icon (`text-destructive` alone) or a
 * single destructive border is not flagged.
 *
 * Not reported:
 *   - InlineErrorBanner itself (exempt by filename);
 *   - a `<div>` with only ONE destructive utility (e.g. just text-destructive);
 *   - a `<div>` with destructive utilities but NO rounded utility (that is a
 *     different, weaker signal — left to a future rule);
 *   - purely dynamic className values.
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

/** Destructive surface/text utility families that make up the banner recipe. */
function isDestructiveSurface(token: string): boolean {
  return (
    /^border-destructive(\/\d+)?$/.test(token) ||
    /^bg-destructive(\/\d+|-soft)?$/.test(token) ||
    /^text-destructive(\/\d+)?$/.test(token)
  );
}

export default createRule({
  name: "prefer-inline-error-banner",
  meta: {
    type: "problem",
    docs: {
      description:
        "Inline destructive error banners must use the shared InlineErrorBanner component instead of a hand-rolled destructive <div>.",
    },
    schema: [],
    messages: {
      preferInlineErrorBanner:
        "This inline destructive error banner recipe (a <div> with a rounded utility + multiple destructive surface utilities) is owned by the shared InlineErrorBanner component. Use <InlineErrorBanner>{...}</InlineErrorBanner> from @/components/shared/InlineErrorBanner instead of recreating it with primitive Tailwind utilities.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (!isHtmlDiv(node)) return;

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
