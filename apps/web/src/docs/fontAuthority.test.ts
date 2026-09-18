import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Primary-font truth coherence (issue 577 M1 / Corrective B, R3).
 *
 * Runtime truth: the primary UI family is self-hosted HarmonyOS Sans SC
 * (Regular/Medium/Bold linked in index.html). Noto Sans CJK SC is a
 * name-in-stack fallback only — no Noto sans webfont is loaded. All four
 * carriers (index.html, index.css token + comment, DESIGN.md, ui-system.md)
 * must tell this same story; a doc that re-elevates Noto to "the loaded
 * self-hosted sans" is the exact drift class that survived commit b73c94cb.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const INDEX_HTML = readFileSync(
  join(repoRoot, "apps", "web", "index.html"),
  "utf8",
);
const INDEX_CSS = readFileSync(
  join(repoRoot, "apps", "web", "src", "index.css"),
  "utf8",
);
const DESIGN = readFileSync(join(repoRoot, "DESIGN.md"), "utf8");
const UI_SYSTEM = readFileSync(
  join(repoRoot, "docs", "standards", "ui-system.md"),
  "utf8",
);

export function fontTruthViolations(files: {
  indexHtml: string;
  indexCss: string;
  design: string;
  uiSystem: string;
}): string[] {
  const v: string[] = [];
  const { indexHtml, indexCss, design, uiSystem } = files;

  if (!indexHtml.includes("/fonts/harmonyos-sans-sc/"))
    v.push("index.html no longer links the HarmonyOS Sans SC faces");
  if (/noto-sans-cjk-sc/.test(indexHtml))
    v.push(
      "index.html links a noto-sans-cjk-sc webfont (not a loaded fallback)",
    );

  const fontUi = /--font-ui:\s*([^;]+);/.exec(indexCss)?.[1] ?? "";
  if (!fontUi.trimStart().startsWith('"HarmonyOS Sans SC"'))
    v.push("--font-ui no longer resolves HarmonyOS Sans SC first");

  for (const [name, doc] of [
    ["DESIGN.md", design],
    ["ui-system.md", uiSystem],
  ] as const) {
    if (!/HarmonyOS Sans SC/.test(doc))
      v.push(
        `${name} does not name HarmonyOS Sans SC as the primary UI family`,
      );
    // A doc claiming Noto Sans CJK SC is the self-hosted/loaded primary is
    // the stale pre-b73c94cb story.
    if (/self-hosted\s+`?Noto Sans CJK SC`?/.test(doc))
      v.push(`${name} still claims Noto Sans CJK SC is self-hosted/loaded`);
    if (/Noto Sans CJK SC.*preloaded/.test(doc))
      v.push(`${name} claims Noto Sans CJK SC is preloaded`);
  }
  return v;
}

describe("primary font truth is coherent across code + docs (R3)", () => {
  it("all four carriers tell the HarmonyOS-first story", () => {
    expect(
      fontTruthViolations({
        indexHtml: INDEX_HTML,
        indexCss: INDEX_CSS,
        design: DESIGN,
        uiSystem: UI_SYSTEM,
      }),
    ).toEqual([]);
  });

  it("the fallback framing does not claim a webfont that is not loaded", () => {
    expect(INDEX_CSS).toMatch(/fallback/i);
    expect(INDEX_CSS).not.toMatch(/self-hosted via \/fonts\/noto-sans-cjk-sc/);
  });

  it("reds when a doc re-elevates Noto to the loaded primary (mutation)", () => {
    const mutated = fontTruthViolations({
      indexHtml: INDEX_HTML,
      indexCss: INDEX_CSS,
      design: DESIGN.replace(
        /HarmonyOS Sans SC/,
        "self-hosted `Noto Sans CJK SC`",
      ),
      uiSystem: UI_SYSTEM,
    });
    expect(mutated.some((m) => m.startsWith("DESIGN.md"))).toBe(true);
  });
});
