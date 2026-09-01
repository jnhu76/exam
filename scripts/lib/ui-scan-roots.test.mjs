/**
 * Contract for the shared business-UI scan-root authority
 * (scripts/lib/ui-scan-roots.mjs):
 *   1. the inventory is real (dirs exist), unique, and under apps/web/src;
 *   2. it is structurally closed over the business-UI tree — every
 *      apps/web/src/components child except generated primitives (ui) is
 *      governed, so a new subtree cannot silently escape the gates;
 *   3. the gates actually source their roots from the authority and no
 *      checker re-introduces a literal copy of the inventory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { BUSINESS_UI_ROOTS } from "./ui-scan-roots.mjs";

const REPO = new URL("../..", import.meta.url).pathname;
const WEB_SRC = `${REPO}apps/web/src`;

const GATES_IMPORTING_AUTHORITY = [
  "scripts/check-raw-color-usage.mjs",
  "scripts/check-token-bypass.mjs",
  "scripts/check-high-font-weight.mjs",
  "scripts/check-frontend-primitives.mjs",
];

test("authority roots exist, are unique, and live under apps/web/src", () => {
  assert.ok(BUSINESS_UI_ROOTS.length > 0);
  assert.deepEqual(
    [...new Set(BUSINESS_UI_ROOTS)].sort(),
    [...BUSINESS_UI_ROOTS].sort(),
    "duplicate roots in the authority",
  );
  for (const root of BUSINESS_UI_ROOTS) {
    assert.ok(
      root.startsWith("apps/web/src/"),
      `root outside apps/web/src: ${root}`,
    );
  }
});

test("authority is structurally closed over apps/web/src business-UI tree", async () => {
  const set = new Set(BUSINESS_UI_ROOTS);
  // pages and features are governed as wholes.
  assert.ok(set.has("apps/web/src/pages"), "pages must be governed");
  assert.ok(set.has("apps/web/src/features"), "features must be governed");
  // Every components child except generated shadcn primitives (ui) is
  // governed business UI.
  const children = await readdir(`${WEB_SRC}/components`, {
    withFileTypes: true,
  });
  const dirs = children.filter((e) => e.isDirectory()).map((e) => e.name);
  assert.ok(
    dirs.includes("ui"),
    "components/ui (generated primitives) must exist",
  );
  for (const dir of dirs) {
    if (dir === "ui") continue;
    assert.ok(
      set.has(`apps/web/src/components/${dir}`),
      `apps/web/src/components/${dir} is business UI but missing from the authority — register it once in scripts/lib/ui-scan-roots.mjs`,
    );
  }
});

test("every gate sources roots from the authority, not a literal inventory", async () => {
  for (const gate of GATES_IMPORTING_AUTHORITY) {
    const src = await readFile(`${REPO}${gate}`, "utf8");
    assert.ok(
      src.includes("ui-scan-roots.mjs"),
      `${gate} must import scripts/lib/ui-scan-roots.mjs`,
    );
    for (const root of BUSINESS_UI_ROOTS) {
      assert.ok(
        !src.includes(`"${root}"`),
        `${gate} re-declares authority root "${root}" as a literal — import it instead`,
      );
    }
  }
});
