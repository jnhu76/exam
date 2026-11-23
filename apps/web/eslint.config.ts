/**
 * ESLint flat config for @exam/web.
 *
 * Loaded via jiti (ESLint v10 loads `.ts` configs through jiti), which
 * resolves all transitive `.ts` rule imports in src/lint/exam-ui/**.
 *
 * Visual-authority rules live under the local `exam-ui/*` namespace. They
 * enforce the frontend visual authority model defined in AGENTS.md and
 * docs/standards/ui-system.md.
 *
 * Scope rules:
 *   - governed business / feature roots come from the repository-wide
 *     BUSINESS_UI_ROOTS authority in scripts/lib/ui-scan-roots.mjs;
 *   - components/ui (generated shadcn primitives) is NEVER linted by exam-ui;
 *   - components/layout (topbar/sidebar — owns intentional sticky elevation)
 *     is excluded from no-business-shadow but still covered by the other rules;
 *   - test files (*.test.ts/tsx) and the lint rules themselves are excluded.
 *
 * React Hook call-order rules also apply to Web application TS/TSX.
 */
import tseslintParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import { BUSINESS_UI_ROOTS } from "../../scripts/lib/ui-scan-roots.mjs";
import examUiPlugin from "./src/lint/exam-ui/index";

// Keep existing disable directives resolvable for rules that are inactive.
const noopRule = {
  meta: { type: "suggestion", schema: [] },
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  create: () => ({}),
};
const webSourcePlugins = {
  "react-hooks": {
    rules: {
      "exhaustive-deps": noopRule,
      "rules-of-hooks": reactHooks.rules["rules-of-hooks"],
    },
  },
  "@typescript-eslint": { rules: { "no-explicit-any": noopRule } },
};

const WEB_ROOT_PREFIX = "apps/web/";
const LAYOUT_ROOT_SUFFIX = "/components/layout";

/** Convert a canonical repository root into an ESLint glob relative to apps/web. */
function toWebTsxGlob(root: string): string {
  if (!root.startsWith(WEB_ROOT_PREFIX)) {
    throw new Error(`UI scan root is outside apps/web: ${root}`);
  }
  return `${root.slice(WEB_ROOT_PREFIX.length)}/**/*.tsx`;
}

const layoutRoot = BUSINESS_UI_ROOTS.find((root) =>
  root.endsWith(LAYOUT_ROOT_SUFFIX),
);
if (!layoutRoot) {
  throw new Error(
    `BUSINESS_UI_ROOTS must include a root ending in ${LAYOUT_ROOT_SUFFIX}`,
  );
}

/** Business / feature source where every visual-authority rule applies. */
const businessGlobs = BUSINESS_UI_ROOTS.filter(
  (root) => root !== layoutRoot,
).map(toWebTsxGlob);

/** Layout source: topbar/sidebar owns intentional sticky elevation, so
 *  no-business-shadow does not apply here. Other exam-ui rules still do. */
const layoutGlobs = [toWebTsxGlob(layoutRoot)];

const ignores = [
  "dist/**",
  "node_modules/**",
  "coverage/**",
  "src/components/ui/**",
  "src/lint/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.d.ts",
];

const eslintConfig = [
  {
    ignores,
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    // Existing disable directives for inactive rules are intentionally unused.
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    plugins: webSourcePlugins,
    rules: {
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: businessGlobs,
    plugins: {
      "exam-ui": examUiPlugin,
    },
    rules: {
      "exam-ui/prefer-inline-error-banner": "error",
      "exam-ui/no-business-shadow": "error",
      "exam-ui/no-arbitrary-typography": "error",
      "exam-ui/no-arbitrary-inline-typography": "error",
      "exam-ui/no-typography-authority-conflict": "error",
      "exam-ui/no-heavy-font-weight": "error",
      "exam-ui/no-recipe-recomposition": "error",
      "exam-ui/no-dialog-spatial-override": "error",
      "exam-ui/no-arbitrary-filter-width": "error",
    },
  },
  {
    files: layoutGlobs,
    linterOptions: {
      reportUnusedDisableDirectives: "warn",
    },
    plugins: {
      "exam-ui": examUiPlugin,
    },
    rules: {
      // Layout owns the sticky topbar (shadow-xs). Shadows are allowed here;
      // the other visual-authority rules still apply.
      "exam-ui/prefer-inline-error-banner": "error",
      "exam-ui/no-arbitrary-typography": "error",
      "exam-ui/no-arbitrary-inline-typography": "error",
      "exam-ui/no-typography-authority-conflict": "error",
      "exam-ui/no-heavy-font-weight": "error",
      "exam-ui/no-recipe-recomposition": "error",
      "exam-ui/no-dialog-spatial-override": "error",
      "exam-ui/no-arbitrary-filter-width": "error",
    },
  },
];

export default eslintConfig;
