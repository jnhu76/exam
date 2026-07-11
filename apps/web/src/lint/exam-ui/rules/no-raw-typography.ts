/**
 * exam-ui/no-raw-typography
 *
 * Phase 1 (UI-LINT-2): prevent business pages from recomposing a semantic
 * typography recipe that an authority already owns, when a valid replacement
 * exists AND has migrated authoritative consumers.
 *
 * ("Phase 1 (UI-LINT-2)" = the first UI-LINT-2 activation stage; NOT a product
 * roadmap phase.)
 *
 * Phase 1 scope (this rule, today): the **section-title** bypass only.
 *
 *   text-{base,lg}  +  font-{semibold,bold}
 *
 * reproduces the `type-section-title` recipe, which is owned by the section
 * components `PageSection` / `FormSection` / `DataTableShell` (all migrated to
 * `type-section-title`). Reaching for that primitive stack in a business page
 * is the drift this rule rejects.
 *
 * Deliberately NOT flagged yet (gated on migration coverage — see
 * docs/frontend/P3-UI-lint-readiness-report.md):
 *
 *   - metric-size text (text-2xl/3xl/4xl/5xl) + bold — reproduces
 *     `type-metric`, but `StatsCard` (the metric authority) has only one
 *     consumer and the ~20 bypass call sites have not migrated (UI-MIGRATE-N).
 *   - body/secondary/metadata sizes (text-sm/text-xs) + weight — far too
 *     broad; would flag ~160 legitimate primitives for ~0 migrated broad
 *     page coverage. Revisit once page migrations land.
 *   - a single size OR a single weight (no recomposition).
 *
 * Detection is AST-based and reuses the shared className-token collector, so it
 * inspects literals, template-literal quasis, and `cn(...)`/`clsx(...)`/
 * `twMerge(...)` string arguments. Purely dynamic className values are not
 * reported (no false positive).
 *
 * Existing debt is grandfathered by baseline.json under
 * `exam-ui/no-raw-typography`. Diagnostic-only: no autofix (the replacement
 * may be a component-level change, not a class swap).
 */
import { createRule, maybeSuppress, asSuppressable } from "../ruleFactory";
import {
  collectClassNameTokens,
  findClassNameAttribute,
  hasAnyToken,
  type ClassNameToken,
} from "../classNameUtils";

/** Section-title-scale text-size utilities that form the recipe when paired
 *  with a section-title weight. */
const SECTION_TITLE_SIZES = new Set(["text-base", "text-lg"]);

/** Section-title weight utilities. */
const SECTION_TITLE_WEIGHTS = new Set(["font-semibold", "font-bold"]);

/** Signature tokens used for baseline grandfathering (stable, normalized). */
const SECTION_TITLE_SIG = ["text-size", "font-weight"];

export default createRule({
  name: "no-raw-typography",
  meta: {
    type: "problem",
    docs: {
      description:
        "Business pages must not recompose the type-section-title recipe (text-base/text-lg + font-semibold/font-bold) from primitive utilities; use the type-section-title recipe or an authoritative section component (PageSection / FormSection / DataTableShell).",
    },
    schema: [],
    messages: {
      noRawTypography:
        "This text-size + font-weight combination recomposes the type-section-title typography recipe. Use the `type-section-title` class (or a PageSection / FormSection / DataTableShell that owns the section title) instead of recomposing it from primitive utilities.",
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

        const hasSize = hasAnyToken(tokens, (v) => SECTION_TITLE_SIZES.has(v));
        if (!hasSize) return;

        const hasWeight = hasAnyToken(tokens, (v) =>
          SECTION_TITLE_WEIGHTS.has(v),
        );
        if (!hasWeight) return;

        maybeSuppress(
          asSuppressable(context),
          "no-raw-typography",
          SECTION_TITLE_SIG,
          attr,
          "noRawTypography",
        );
      },
    };
  },
});
