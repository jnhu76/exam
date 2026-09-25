import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
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
