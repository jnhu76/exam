/**
 * exam-ui ESLint plugin — visual-authority rules for the Exam frontend.
 *
 * Namespace: `exam-ui/*`. Registered as a local plugin in apps/web/eslint.config.ts.
 *
 * Rules:
 *   - exam-ui/prefer-field-error
 *   - exam-ui/prefer-inline-error-banner
 *   - exam-ui/no-business-shadow
 *   - exam-ui/no-arbitrary-typography
 *
 * Scope: business / feature source under apps/web/src (pages, components/shared,
 * components/exam, components/settings, components/question). components/ui
 * (generated shadcn primitives) and components/layout (topbar elevation) are
 * excluded in the flat config.
 */
import type { ESLint } from "eslint";
import preferFieldError from "./rules/prefer-field-error";
import preferInlineErrorBanner from "./rules/prefer-inline-error-banner";
import noBusinessShadow from "./rules/no-business-shadow";
import noArbitraryTypography from "./rules/no-arbitrary-typography";

/**
 * The rules are typed as typescript-eslint v8 `RuleModule`s, but ESLint v10's
 * `Plugin['rules']` expects its own `RuleDefinition` whose context variance is
 * structurally incompatible (a known eslint-v10 / ts-eslint-v8 type friction).
 * At runtime the two are fully compatible — ESLint calls `create(context)`.
 * We assert the rules bag to the plugin type to avoid spurious type errors.
 */
const rules = {
  "prefer-field-error": preferFieldError,
  "prefer-inline-error-banner": preferInlineErrorBanner,
  "no-business-shadow": noBusinessShadow,
  "no-arbitrary-typography": noArbitraryTypography,
} as unknown as ESLint.Plugin["rules"];

const plugin: ESLint.Plugin = {
  meta: { name: "exam-ui" },
  rules,
};

export default plugin;
export {
  preferFieldError,
  preferInlineErrorBanner,
  noBusinessShadow,
  noArbitraryTypography,
};
