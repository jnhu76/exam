/**
 * exam-ui/no-raw-surface-recipe
 *
 * Phase 2 (UI-LINT-2): prevent business pages from recomposing the
 * `surface-content` recipe that the surface authority already owns, when a
 * valid replacement exists AND has migrated authoritative consumers.
 *
 * Phase 2 scope (this rule, today): the **surface-content** bypass only.
 *
 *   bg-card  +  border (default)  +  rounded-lg / rounded (panel radius)
 *
 * reproduces the `surface-content` recipe (background + border + radius), which
 * is owned by the authoritative content components (`PageSection` /
 * `DataTableShell` / `FormSection`) and, equivalently, by the shadcn `<Card>`
 * primitive. Reaching for that primitive stack in a business page is the drift
 * this rule rejects.
 *
 * Detection boundary (evidence-driven — see
 * docs/frontend/P3-UI-lint-readiness-report.md §2 and the Card decision):
 *
 *   - `<Card>` is NEVER flagged here. Its `bg-card`/`border`/`rounded-xl` live
 *     in the generated shadcn primitive (`components/ui/card.tsx`), which is
 *     excluded from exam-ui lint scope by the flat-config `ignores`. So
 *     business pages may freely use `<Card>` as a low-level content primitive
 *     (Option A: Card stays primitive). This rule targets the HAND-ROLLED
 *     recomposition only.
 *   - `rounded-md` is a CONTROL radius, not a panel radius. A control block
 *     such as `ExamTimer` (`rounded-md border ... bg-card`) is NOT a
 *     surface-content recomposition, so only `rounded-lg` / base `rounded`
 *     (panel radii) trigger the rule. This is what keeps the timer control and
 *     the sidebar link blocks from being false positives.
 *   - The signature requires ALL THREE primitives present in the same
 *     className expression: a single primitive is not a recomposition.
 *
 * Deliberately NOT flagged:
 *   - shadow-sm on its own — covered by `no-business-shadow`;
 *   - attention surfaces (`bg-destructive/10`, etc.) — component-owned
 *     (`InlineErrorBanner` / `ErrorState`), and a separate concern from
 *     surface-content;
 *   - subtle surfaces (`bg-muted`) — a legitimate primitive region;
 *   - the recipe class itself (`surface-content`) — that is the replacement.
 *
 * Detection is AST-based and reuses the shared className-token collector.
 * Existing debt is grandfathered by baseline.json under
 * `exam-ui/no-raw-surface-recipe`. Diagnostic-only: no autofix.
 */
import { createRule, maybeSuppress, asSuppressable } from "../ruleFactory";
import {
  collectClassNameTokens,
  findClassNameAttribute,
  hasAnyToken,
  hasToken,
  type ClassNameToken,
} from "../classNameUtils";

/** Panel-radius utilities that complete the surface-content recipe.
 *  Deliberately excludes rounded-md / rounded-sm (control radii). */
const PANEL_RADII = new Set(["rounded-lg", "rounded"]);

/** Signature tokens used for baseline grandfathering (stable, normalized). */
const SURFACE_CONTENT_SIG = ["bg-card", "border", "panel-radius"];

export default createRule({
  name: "no-raw-surface-recipe",
  meta: {
    type: "problem",
    docs: {
      description:
        "Business pages must not recompose the surface-content recipe (bg-card + border + rounded-lg/rounded) from primitive utilities; use the surface-content class, an authoritative content component (PageSection / DataTableShell / FormSection), or the shadcn <Card> primitive.",
    },
    schema: [],
    messages: {
      noRawSurfaceRecipe:
        "This bg-card + border + panel-radius combination recomposes the surface-content surface recipe. Use the `surface-content` class (or a PageSection / DataTableShell / FormSection, or the shadcn <Card> primitive) instead of recomposing it from primitive utilities.",
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

        // Require all three primitives in the same className expression.
        if (!hasToken(tokens, "bg-card")) return;
        if (!hasToken(tokens, "border")) return;
        if (!hasAnyToken(tokens, (v) => PANEL_RADII.has(v))) return;

        maybeSuppress(
          asSuppressable(context),
          "no-raw-surface-recipe",
          SURFACE_CONTENT_SIG,
          attr,
          "noRawSurfaceRecipe",
        );
      },
    };
  },
});
