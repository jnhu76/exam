import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Production-layout contract for the SDK bundle (W6.R F1).
 *
 * sdkBundle.ts is loaded through a dynamic `import()` in the On path, but
 * its own imports are STATIC — Node resolves every one of them when the
 * bundle module is evaluated. The production image installs only
 * production dependencies (`Dockerfile`: `pnpm --filter @exam/api --prod
 * deploy --legacy /out`), where pnpm links ONLY the package's declared
 * `dependencies` at the import root. A static import declared in
 * `devDependencies` therefore resolves in the dev workspace but fails with
 * ERR_MODULE_NOT_FOUND in the shipped image, degrading every
 * `TELEMETRY_ENABLED=true` mode to `telemetry.init_failed`.
 *
 * This test pins the pairing: every bare static specifier in the bundle
 * must be a production dependency. It is intentionally source-static (the
 * failure is a packaging-layout error, not a runtime behavior).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundleSource = readFileSync(join(__dirname, "./sdkBundle.ts"), "utf8");
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** Package name of a bare specifier (`@scope/name/sub` → `@scope/name`). */
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

describe("sdkBundle static imports", () => {
  it("are all declared as production dependencies", () => {
    const specifiers = [...bundleSource.matchAll(/from\s+["']([^"']+)["']/g)]
      .map((match) => match[1]!)
      .filter(
        (specifier) =>
          !specifier.startsWith(".") &&
          !specifier.startsWith("/") &&
          !specifier.startsWith("node:"),
      );
    // Guard the extraction itself: the bundle must have real external imports.
    expect(specifiers.length).toBeGreaterThan(5);

    const dependencies = packageJson.dependencies ?? {};
    const missing = specifiers.filter(
      (specifier) => !(packageNameOf(specifier) in dependencies),
    );
    expect(missing).toEqual([]);
  });
});
