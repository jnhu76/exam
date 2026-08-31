import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Resolve a port variable with shell-env priority: process.env (shell export)
 * wins over the root `.env` file (loaded via Vite loadEnv), which wins over
 * the fallback. Vite config runs in Node before dev-server env loading, so
 * without loadEnv a root-`.env` VITE_PORT / DEV_API_PORT would be invisible
 * here.
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

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, repoRoot, "");

  const vitePort = resolvePort("VITE_PORT", 5173, rootEnv);
  const devApiPort = resolvePort("DEV_API_PORT", 3000, rootEnv);

  return {
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
              // Edit-only heavy deps (issue 301) must keep their dynamic
              // import boundaries: Tiptap/ProseMirror/KaTeX are reachable
              // ONLY through the lazy editor and math chunks, so the plain
              // READ path never downloads them. Returning undefined lets
              // them follow the async chunk graph instead of the eager
              // vendor bundle.
              if (
                id.includes("@tiptap/") ||
                id.includes("/prosemirror-") ||
                id.includes("node_modules/katex/")
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
