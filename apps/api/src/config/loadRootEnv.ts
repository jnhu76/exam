import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function resolveRootEnvPaths(): string[] {
  return [
    fileURLToPath(new URL("../../.env", import.meta.url)),
    fileURLToPath(new URL("../../../../.env", import.meta.url)),
  ].filter((path, index, paths) => paths.indexOf(path) === index);
}

export function loadRootEnv(): void {
  const paths = resolveRootEnvPaths().filter((path) => existsSync(path));

  if (paths.length === 0) return;

  loadEnv({
    path: paths,
    quiet: true,
  });
}
