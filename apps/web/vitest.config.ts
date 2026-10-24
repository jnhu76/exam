import { defineConfig } from "vitest/config";
import { workspaceSourceResolutionPlugin } from "../../config/workspace-resolution.mjs";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  // #741: per-package implicit envDir admission is OFF — apps/web/.env*
  // files can never reach import.meta.env in tests; VITE_* values come from
  // the process environment only. Pinned by scripts/check-env-surface.mjs.
  envDir: false,
  // #794: workspace packages (@exam/domain, @exam/authz, @exam/contracts)
  // resolve to sources in tests, same as every other Vitest project — before
  // #794 this project had no workspace source handling and a direct vitest
  // run silently executed stale dist. The "@" and mathlive aliases below are
  // app-local concerns and stay here.
  plugins: [workspaceSourceResolutionPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // mathlive's package exports resolve the "node" condition to an SSR
      // build without MathfieldElement. The formula field only runs in a real
      // browser, but tests that exercise the dialog surface must resolve the
      // browser build too. Exact-match regex keeps "mathlive/fonts.css"
      // (the bundled @font-face assets) on its exports-map entry.
      "^mathlive$": fileURLToPath(
        new URL("./node_modules/mathlive/mathlive.min.mjs", import.meta.url),
      ),
    },
  },
  define: {
    IS_REACT_ACT_ENVIRONMENT: "true",
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/react-act-env.ts", "./src/test/setup.ts"],
    pool: "forks",
    // Web-only CI guardrail: jsdom + V8 coverage instrumentation + turbo
    // parallelism (maxWorkers:4) make CI run ~1.5–2x slower than local. The
    // vitest default 5000ms is too tight for the slowest page tests under
    // coverage, which previously flaked at ~5060–5150ms. 10_000ms is a
    // guardrail against CPU starvation in CI — NOT a mask for hangs. A real
    // hang (e.g. an unresolved promise or never-firing timer) would blow past
    // it; such hangs are fixed at the source (fake timers, awaited
    // userEvent), not absorbed here. Local default stays 5000ms so devs
    // notice slow tests immediately.
    testTimeout: process.env.CI ? 10_000 : 5_000,
    // Web suite parallelism. Each worker gets its own fork, so module state is
    // isolated. If flake reappears, step down to 2 (not 1) and record it in
    // docs/standards/test-flakes.md before going serial again.
    //
    // INVARIANT: the local 5000ms budget assumes web coverage never stacks
    // with the API coverage lane — turbo.json orders @exam/web#coverage after
    // @exam/api#coverage (same heavy-suite serialization rule as db→api).
    // jsdom + V8 coverage forks competing with the API's 4 coverage workers
    // saturate the host and push timing-sensitive tests (editor mount, 5s
    // timeouts, post-test prosemirror DOM reads) past their budgets;
    // OBS-2026-10-08-003 and OBS-2026-10-24-001 are that family.
    maxWorkers: 4,
    minWorkers: 2,
    server: {
      deps: {
        inline: ["react-dom"],
        fallbackCJS: true,
      },
    },
    exclude: ["dist/**", "node_modules/**"],
    environmentOptions: {
      jsdom: {
        url: "http://localhost:5173",
      },
    },
    coverage: {
      exclude: ["**/ProctorDashboardPage.tsx"],
      thresholds: {
        lines: 75,
        branches: 70,
        functions: 70,
      },
    },
  },
});
