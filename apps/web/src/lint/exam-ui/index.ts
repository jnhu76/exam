/**
 * exam-ui ESLint plugin — visual-authority rules for the Exam frontend.
 *
 * Namespace: `exam-ui/*`. Registered as a local plugin in apps/web/eslint.config.ts.
 *
 * Rules:
 *   - exam-ui/prefer-inline-error-banner
 *   - exam-ui/no-business-shadow
 *   - exam-ui/no-arbitrary-typography
 *
 * Retired (UI-FIELD-ERROR-AUTHORITY-CLOSURE-1, §8): `exam-ui/prefer-field-error`
 * is no longer wired. Its structural recipe (`<p> + text-destructive + text-size`)
 * could not deterministically distinguish FieldError ownership from DOMAIN_WARNING,
 * CONTROL_STATE_FEEDBACK, or INLINE_OPERATION_ERROR roles (4/4 remaining hits
 * were false-semantic-overlap; no sound NARROW detector existed). FieldError
 * remains the canonical semantic authority for "form field validation error";
 * its ownership is enforced by semantic migration review and the authority
 * component tests, not a structural lint proxy.
 *
 * Retired (UI-MIGRATE-N-W3, §12-§13): `exam-ui/no-raw-typography` and
 * `exam-ui/no-raw-surface-recipe` are no longer wired. Each detected a raw
 * recomposition of a semantic recipe (`type-section-title` /
 * `surface-content`) via primitive utility tokens, but after the proven
 * same-role migrations in W3 every remaining hit was false-semantic-overlap:
 *
 *   - no-raw-typography (text-{base,lg} + font-{semibold,bold}) — 4/4
 *     remaining hits were TOPBAR_TITLE / QUESTION_TITLE /
 *     RUNTIME_STATUS_TITLE / OVERLAY_DEADLINE_TITLE, none SECTION_TITLE;
 *   - no-raw-surface-recipe (bg-card + border + rounded-lg/rounded) — 1/1
 *     remaining hit was a SIDEBAR_SURFACE, not a PAGE_CONTENT_SECTION.
 *
 * No sound NARROW AST boundary could distinguish the owner role from these
 * distinct roles: element types appear in both owner and non-owner shapes
 * (PageSection and QuestionHeader both use <h2>; surface-content regions
 * and the sidebar both use rounded-lg), and no role/aria landmark owns the
 * distinction (contrast prefer-inline-error-banner, which narrows soundly on
 * the authority-owned `role="alert"`). This is the same unsoundness that
 * retired prefer-field-error. The `type-section-title` / `surface-content`
 * recipes and the authoritative components (PageSection / FormSection /
 * DataTableShell / StatsCard) remain canonical; ownership is enforced by
 * semantic migration review and the recipe authority tests, not by a
 * structural lint proxy.
 *
 * Scope: business / feature source under apps/web/src (pages, components/shared,
 * components/exam, components/settings, components/question). components/ui
 * (generated shadcn primitives) and components/layout (topbar elevation) are
 * excluded in the flat config.
 */
import type { ESLint } from "eslint";
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
  "prefer-inline-error-banner": preferInlineErrorBanner,
  "no-business-shadow": noBusinessShadow,
  "no-arbitrary-typography": noArbitraryTypography,
} as unknown as ESLint.Plugin["rules"];

const plugin: ESLint.Plugin = {
  meta: { name: "exam-ui" },
  rules,
};

export default plugin;
export { preferInlineErrorBanner, noBusinessShadow, noArbitraryTypography };
