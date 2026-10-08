import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { parse as parseEnvFile } from "dotenv";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { SUPPORTED_DEV_ENV_FILE } from "../../config/envFilePolicy.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Resolve a port variable with shell-env priority: process.env (shell export)
 * wins over the development env file (repo-root `.env`, admitted below in
 * development mode only), which wins over the fallback.
 */
function resolvePort(
  name: string,
  fallback: number,
  loadedEnv: Record<string, string>,
): number {
  const raw = process.env[name] ?? loadedEnv[name];
  if (raw === undefined || raw === "") return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${name} must be an integer between 0 and 65535`);
  }
  return port;
}

/**
 * Development-only admission of the supported development source: the
 * repository-root `.env`, read as ONE exact path (#741). Every other mode —
 * production builds included — reads no env file here: `VITE_PORT` /
 * `DEV_API_PORT` are development configuration, so `.env.production` stays
 * deployment-owned (docker compose --env-file only) and can never become a
 * web dev-port source. Unsupported Vite mode files (`.env.local`,
 * `.env.development*`, `.env.production.local`) have no code path into this
 * config; the env-surface guard rejects them at verify if created.
 */
function loadDevRootEnv(mode: string): Record<string, string> {
  if (mode !== "development") return {};
  const path = join(repoRoot, SUPPORTED_DEV_ENV_FILE);
  if (!existsSync(path)) return {};
  return parseEnvFile(readFileSync(path, "utf8"));
}

export default defineConfig(({ mode }) => {
  const rootEnv = loadDevRootEnv(mode);

  const vitePort = resolvePort("VITE_PORT", 5173, rootEnv);
  const devApiPort = resolvePort("DEV_API_PORT", 3000, rootEnv);

  return {
    // #741: Vite's implicit env-file discovery is OFF. `import.meta.env.VITE_*`
    // resolves from the process environment only — a package-local
    // apps/web/.env* file can never enter the client bundle. Pinned by
    // scripts/check-env-surface.mjs.
    envDir: false,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react-dom/"))
              return "vendor-react-dom";
            if (id.includes("node_modules/react/")) return "vendor-react";
            if (id.includes("node_modules/")) {
              // Edit-only heavy deps must keep their dynamic
              // import boundaries: Tiptap/ProseMirror/KaTeX are reachable
              // ONLY through the lazy editor and math chunks, so the plain
              // READ path never downloads them. Returning undefined lets
              // them follow the async chunk graph instead of the eager
              // vendor bundle.
              if (
                id.includes("@tiptap/") ||
                id.includes("/prosemirror-") ||
                id.includes("node_modules/katex/") ||
                // MathLive is the visual formula surface (#669 phase U). Like
                // KaTeX it must stay out of the eager vendor bundle: it is
                // reachable ONLY through the formula dialog's dynamic import,
                // so candidates who never open 公式 never download it.
                id.includes("node_modules/mathlive/")
              ) {
                return undefined;
              }
              return "vendor";
            }
          },
        },
      },
    },
    server: {
      port: vitePort,
      allowedHosts: ["host.docker.internal"],
      proxy: {
        "/api": {
          target: `http://localhost:${devApiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
