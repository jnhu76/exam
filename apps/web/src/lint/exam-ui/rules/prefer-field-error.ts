/**
 * exam-ui/prefer-field-error
 *
 * Detects the inline field-error recipe already owned by the shared
 * `FieldError` component (`apps/web/src/components/shared/FieldError.tsx`):
 *
 *   <p className="... text-destructive ... text-sm ...">{errorMessage}</p>
 *
 * i.e. a `<p>` whose className carries a destructive text utility together
 * with a text-size utility. That combination is the high-confidence inline
 * field-error appearance that `FieldError` owns.
 *
 * Not reported (deliberately, to avoid false positives):
 *   - the FieldError implementation itself (exempt by filename);
 *   - destructive text on non-`<p>` elements (icons, required-asterisk spans,
 *     score numbers, large page-level error text);
 *   - a `<p>` with `text-destructive` but NO size utility;
 *   - purely dynamic className values (we only reason about static segments).
 *
 * Diagnostic-only: no autofix (replacement is not always structurally safe —
 * the error text may be a ternary, and FieldError swallows falsy children
 * differently than a raw `<p>`).
 *
 * Scope: applied to business / feature source via the ESLint config `files`
 * glob; `components/ui` (generated shadcn primitives) is excluded there.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { createRule, maybeSuppress, asSuppressable } from "../ruleFactory";
import {
  collectClassNameTokens,
  findClassNameAttribute,
  hasAnyToken,
  type ClassNameToken,
} from "../classNameUtils";

/** Text-size utilities (named + arbitrary pixel/rem) that combine with
 *  text-destructive to form the inline field-error recipe. */
function isTextSize(token: string): boolean {
  if (
    token === "text-xs" ||
    token === "text-sm" ||
    token === "text-base" ||
    token === "text-lg" ||
    token === "text-xl"
  ) {
    return true;
  }
  return /^text-\[[^\]]+\]$/.test(token); // arbitrary text size
}

/** Destructive text utility, with optional /opacity modifier. */
function isDestructiveText(token: string): boolean {
  return /^text-destructive(?:\/\d+$)?$/.test(token);
}

export default createRule({
  name: "prefer-field-error",
  meta: {
    type: "problem",
    docs: {
      description:
        "Inline field-error text must use the shared FieldError component instead of a hand-rolled <p> with destructive+size utilities.",
    },
    schema: [],
    messages: {
      preferFieldError:
        "This inline field-error recipe (a <p> with text-destructive + a text-size utility) is owned by the shared FieldError component. Use <FieldError>{...}</FieldError> from @/components/shared/FieldError instead of recreating it with primitive Tailwind utilities.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (!isHtmlP(node)) return;

        const attr = findClassNameAttribute(node);
        if (!attr || !attr.value) return;

        const tokens: ClassNameToken[] = collectClassNameTokens(attr.value);
        if (tokens.length === 0) return;

        const hasDestructive = hasAnyToken(tokens, isDestructiveText);
        const hasSize = hasAnyToken(tokens, isTextSize);
        if (!hasDestructive || !hasSize) return;

        // Exclude the authority implementation itself.
        if (context.filename.endsWith("components/shared/FieldError.tsx"))
          return;

        maybeSuppress(
          asSuppressable(context),
          "prefer-field-error",
          ["text-destructive", "text-size"],
          attr,
          "preferFieldError",
        );
      },
    };
  },
});

function isHtmlP(node: TSESTree.JSXOpeningElement): boolean {
  const name = node.name;
  return name.type === "JSXIdentifier" && name.name === "p";
}
