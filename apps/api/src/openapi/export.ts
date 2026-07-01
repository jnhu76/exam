import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { generateOpenAPISpec } from "./swagger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../../openapi.json");
const isCheckMode = process.argv.includes("--check");

async function main() {
  const spec = await generateOpenAPISpec();

  // Remove non-deterministic fields that would cause false drift.
  const stable = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
  // Ensure info.version is stable (already hardcoded in config).
  // Remove any server URL that might vary by environment.
  delete (stable as Record<string, unknown>).servers;

  const rawJson = JSON.stringify(stable, null, 2) + "\n";
  // Format with prettier to match the committed file style.
  const json = await format(rawJson, { parser: "json" });

  if (isCheckMode) {
    if (!existsSync(OUTPUT_PATH)) {
      process.stderr.write(
        `openapi.json not found at ${OUTPUT_PATH}. Run 'pnpm api:openapi' first.\n`,
      );
      process.exit(1);
    }
    const existing = readFileSync(OUTPUT_PATH, "utf-8").replace(/\r\n/g, "\n");
    if (existing !== json.replace(/\r\n/g, "\n")) {
      process.stderr.write(
        "openapi.json is out of date. Run 'pnpm api:openapi' and commit the result.\n",
      );
      process.exit(1);
    }
    process.stdout.write("openapi.json is up to date.\n");
    return;
  }

  writeFileSync(OUTPUT_PATH, json, "utf-8");
  process.stdout.write(`OpenAPI spec written to ${OUTPUT_PATH}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
