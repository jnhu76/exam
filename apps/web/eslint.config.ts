/**
 * ESLint flat config for @exam/web.
 *
 * Loaded via jiti (ESLint v10 loads `.ts` configs through jiti), which
 * resolves all transitive `.ts` rule imports in src/lint/exam-ui/**.
 *
 * Visual-authority rules live under the local `exam-ui/*` namespace. They
 * enforce the frontend visual authority model defined in AGENTS.md and
 * docs/frontend/P3-UI-Foundation-plan.md (UI-LINT-1 stage).
 *
 * Scope rules:
 *   - exam-ui/* apply to business / feature source ONLY:
 *       src/pages/**, src/components/shared/**, src/components/exam/**,
 *       src/components/settings/**, src/components/question/**
 *   - components/ui (generated shadcn primitives) is NEVER linted by exam-ui.
 *   - components/layout (topbar/sidebar — owns intentional sticky elevation)
 *     is excluded from no-business-shadow but still covered by the other rules.
 *   - test files (*.test.ts/tsx) and the lint rules themselves are excluded.
 *
 * No other ESLint rules are configured here — exam-ui is the sole purpose of
 * this config. The existing scripts/check-*.mjs architecture lint remains
 * unchanged and authoritative for non-visual concerns.
 */
import tseslintParser from "@typescript-eslint/parser";
import examUiPlugin from "./src/lint/exam-ui/index";

/**
 * No-op stub plugin for pre-existing `eslint-disable` comments.
 *
 * This repo did not previously run ESLint, so a few source files carry
 * `eslint-disable-next-line <rule>` comments that reference rules belonging to
 * plugins this config intentionally does not load (react-hooks,
 * @typescript-eslint). ESLint v9+ treats a disable directive for an unknown
 * rule as a hard error. Rather than edit unrelated business source, we
 * register no-op pass-through rules under those namespaces so the directives
 * resolve cleanly. These stubs never report anything.
 */
const noopRule = {
  meta: { type: "suggestion", schema: [] },
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  create: () => ({}),
};
const compatibilityPlugins = {
  "react-hooks": { rules: { "exhaustive-deps": noopRule } },
  "@typescript-eslint": { rules: { "no-explicit-any": noopRule } },
};

/** Business / feature source where visual-authority rules apply. */
const businessGlobs = [
  "src/pages/**/*.tsx",
  "src/components/shared/**/*.tsx",
  "src/components/exam/**/*.tsx",
  "src/components/settings/**/*.tsx",
  "src/components/question/**/*.tsx",
];

/** Layout source: topbar/sidebar owns intentional sticky elevation, so
 *  no-business-shadow does not apply here. Other exam-ui rules still do. */
const layoutGlobs = ["src/components/layout/**/*.tsx"];

const ignores = [
  "dist/**",
  "node_modules/**",
  "coverage/**",
  "src/components/ui/**",
  "src/lint/**",
  "**/*.test.ts",
  "**/*.test.tsx",
];

const eslintConfig = [
  {
    ignores,
  },
  {
    files: businessGlobs,
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    // This ESLint config intentionally provides ONLY the exam-ui/* rules. It
    // is not a general-purpose linter. Pre-existing source contains a few
    // eslint-disable comments that reference rules from plugins this config
    // does not load (react-hooks/exhaustive-deps, @typescript-eslint/*). Such
    // directives are "unused" from this config's perspective and must NOT
    // break the gate, so we silence unused-directive reporting rather than
    // edit unrelated business source.
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    plugins: {
      "exam-ui": examUiPlugin,
      ...compatibilityPlugins,
    },
    rules: {
      "exam-ui/prefer-field-error": "error",
      "exam-ui/prefer-inline-error-banner": "error",
      "exam-ui/no-business-shadow": "error",
      "exam-ui/no-arbitrary-typography": "error",
    },
  },
  {
    files: layoutGlobs,
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "exam-ui": examUiPlugin,
      ...compatibilityPlugins,
    },
    rules: {
      // Layout owns the sticky topbar (shadow-xs). Shadows are allowed here;
      // the other visual-authority rules still apply.
      "exam-ui/prefer-field-error": "error",
      "exam-ui/prefer-inline-error-banner": "error",
      "exam-ui/no-arbitrary-typography": "error",
    },
  },
];

export default eslintConfig;
