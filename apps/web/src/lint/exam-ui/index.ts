/**
 * exam-ui ESLint plugin — visual-authority rules for the Exam frontend.
 *
 * Namespace: `exam-ui/*`. Registered as a local plugin in
 * apps/web/eslint.config.ts, which is also the authority for which rules are
 * wired.
 *
 * Every rule here is structural and diagnostic-only (no autofix). Where a
 * structural proxy cannot distinguish the owning role from a look-alike role,
 * no rule is written: `prefer-field-error`, `no-raw-typography` and
 * `no-raw-surface-recipe` were retired for exactly that reason (PageSection and
 * QuestionHeader both use <h2>; the sidebar and surface-content both use
 * rounded-lg). Those recipes and their authority components stay canonical and
 * are enforced by semantic review + the recipe authority tests, NOT by a lint
 * proxy. Do not reintroduce a structural rule for them.
 */
import type { ESLint } from "eslint";
import preferInlineErrorBanner from "./rules/prefer-inline-error-banner";
import noBusinessShadow from "./rules/no-business-shadow";
import noArbitraryTypography from "./rules/no-arbitrary-typography";
import noTypographyAuthorityConflict from "./rules/no-typography-authority-conflict";
import noArbitraryInlineTypography from "./rules/no-arbitrary-inline-typography";
import noHeavyFontWeight from "./rules/no-heavy-font-weight";
import noRecipeRecomposition from "./rules/no-recipe-recomposition";
import noDialogSpatialOverride from "./rules/no-dialog-spatial-override";
import noArbitraryFilterWidth from "./rules/no-arbitrary-filter-width";

/**
 * The rules are typed as typescript-eslint v8 `RuleModule`s, but ESLint v10's
 * `Plugin['rules']` expects its own `RuleDefinition` whose context variance is
 * structurally incompatible (a known eslint-v10 / ts-eslint-v8 type friction).
 * At runtime the two are fully compatible — ESLint calls `create(context)`.
 * We assert the rules bag to the plugin type to avoid spurious type errors.
 */
const rules = {
  "prefer-inline-error-banner": preferInlineErrorBanner,
  "no-business-shadow": noBusinessShadow,
  "no-arbitrary-typography": noArbitraryTypography,
  "no-typography-authority-conflict": noTypographyAuthorityConflict,
  "no-arbitrary-inline-typography": noArbitraryInlineTypography,
  "no-heavy-font-weight": noHeavyFontWeight,
  "no-recipe-recomposition": noRecipeRecomposition,
  "no-dialog-spatial-override": noDialogSpatialOverride,
  "no-arbitrary-filter-width": noArbitraryFilterWidth,
} as unknown as ESLint.Plugin["rules"];

const plugin: ESLint.Plugin = {
  meta: { name: "exam-ui" },
  rules,
};

export default plugin;
export {
  preferInlineErrorBanner,
  noBusinessShadow,
  noArbitraryTypography,
  noTypographyAuthorityConflict,
  noArbitraryInlineTypography,
  noHeavyFontWeight,
  noRecipeRecomposition,
  noDialogSpatialOverride,
  noArbitraryFilterWidth,
};
