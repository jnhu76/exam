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
    // P0-infra: parallelize the web suite. Was `maxWorkers: 1` (serial) since
    // 8ef3b9e. Raised to 4; each worker gets its own fork so module state is
    // isolated. If flake reappears, step down to 2 before considering 1 again.
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
