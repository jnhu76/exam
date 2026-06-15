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
    maxWorkers: 1,
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
      thresholds: {
        lines: 75,
        branches: 70,
        functions: 70,
      },
    },
  },
});
