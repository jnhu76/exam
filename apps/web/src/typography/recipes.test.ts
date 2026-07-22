import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIRMED_RECIPES } from "./typography-vocabulary";

/**
 * Structural tests for the semantic typography recipe layer (UI-RECIPE-1A).
 *
 * The recipes are plain CSS classes in recipes.css (imported via main.tsx so
 * they bypass the Tailwind content scanner). CSS utilities cannot be unit-tested
 * through rendering in this jsdom toolchain (the stylesheet is not loaded into
 * the test DOM), so these are static authority tests: they assert the recipe
 * source exists and is well-formed, and that migrated consumers reference the
 * recipe by name.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const RECIPES_CSS = readFileSync(join(HERE, "recipes.css"), "utf8");

describe("typography recipe layer (UI-RECIPE-1A)", () => {
  it("every recipe resolves its font family through a semantic role variable", () => {
    // Each recipe must use var(--font-ui) | var(--font-reading) | var(--font-mono),
    // never a page-local font-family stack.
    expect(RECIPES_CSS).not.toMatch(/font-family:\s*["']/);
    expect(RECIPES_CSS).toContain("var(--font-ui)");
    expect(RECIPES_CSS).toContain("var(--font-reading)");
    expect(RECIPES_CSS).toContain("var(--font-mono)");
  });

  it("reading and long-response use font.reading, not font.serif", () => {
    // type-reading / type-long-response initially use the sans reading family.
    // Serif is a separate authority opted into explicitly, not via these recipes.
    const readingBlock = extractRule(RECIPES_CSS, "type-reading");
    const longResponseBlock = extractRule(RECIPES_CSS, "type-long-response");
    expect(readingBlock).toContain("var(--font-reading)");
    expect(longResponseBlock).toContain("var(--font-reading)");
    expect(readingBlock).not.toContain("serif");
    expect(longResponseBlock).not.toContain("serif");
  });

  it("metric and numeric own tabular numerals", () => {
    expect(extractRule(RECIPES_CSS, "type-metric")).toContain("tabular-nums");
    expect(extractRule(RECIPES_CSS, "type-numeric")).toContain("tabular-nums");
  });

  it("does not encode domain status colors", () => {
    // Recipes must not reproduce status tones (success/warning/destructive/info).
    expect(RECIPES_CSS).not.toMatch(/var\(--(success|warning|danger|info)\)/);
    expect(RECIPES_CSS).not.toMatch(/text-(success|warning|destructive|info)/);
  });
});

/** Extract the CSS rule body for `.name { ... }` from the stylesheet text. */
function extractRule(css: string, name: string): string {
  // Source CSS uses `.name {` with a space; compiled CSS uses `.name{`.
  // Normalize: collapse whitespace around the selector brace for matching.
  const re = new RegExp(`\\.${name}\\s*\\{`);
  const m = re.exec(css);
  if (!m) return "";
  const bodyStart = m.index + m[0].length;
  let depth = 1;
  let i = bodyStart;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  return css.slice(bodyStart, i - 1);
}

describe("migrated consumers use semantic recipes (UI-RECIPE-1A §E)", () => {
  const consumers: Array<{ file: string; recipe: string; reason: string }> = [
    {
      file: "components/shared/PageHeader.tsx",
      recipe: "type-page-title",
      reason: "page title consumer",
    },
    {
      file: "components/shared/PageHeader.tsx",
      recipe: "type-page-description",
      reason: "page description consumer",
    },
    {
      file: "pages/exam/TakeExamPage.tsx",
      recipe: "type-reading",
      reason: "long Chinese reading consumer",
    },
    {
      file: "pages/admin/GradingDetailPage.tsx",
      recipe: "type-long-response",
      reason: "long-response consumer",
    },
  ];

  it.each(consumers)(
    "$file references $recipe ($reason)",
    ({ file, recipe }) => {
      const src = readFileSync(
        join(HERE, "..", file.split("/").join("/")),
        "utf8",
      );
      expect(
        src.includes(recipe),
        `${file} should use the ${recipe} semantic recipe`,
      ).toBe(true);
    },
  );
});
