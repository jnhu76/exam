import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIRMED_SURFACES } from "./surface-vocabulary";

/**
 * Structural tests for the semantic surface recipe layer (UI-SURFACE-1).
 *
 * The recipes are plain CSS classes in recipes.css (imported via main.tsx so
 * they bypass the Tailwind content scanner, mirroring the typography recipe
 * layer). CSS utilities cannot be unit-tested through rendering in this jsdom
 * toolchain (the stylesheet is not loaded into the test DOM), so these are
 * static authority tests: they assert the recipe source exists, is
 * well-formed, and resolves through semantic tokens — never hardcoded colors.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const RECIPES_CSS = readFileSync(join(HERE, "recipes.css"), "utf8");

describe("surface recipe layer (UI-SURFACE-1)", () => {
  it("defines a CSS class for every confirmed surface role", () => {
    for (const role of CONFIRMED_SURFACES) {
      const selector = `.surface-${role}`;
      expect(
        RECIPES_CSS.includes(selector),
        `recipes.css must define ${selector}`,
      ).toBe(true);
    }
  });

  it("every recipe resolves its background through a semantic token variable", () => {
    // Surface recipes must never hardcode hex colors; they reference the
    // semantic color tokens (--bg / --surface / --surface-muted / sidebar set)
    // defined in index.css. Status/feedback colors remain owned by the
    // statusMeta + StatusBadge authority and the feedback color tokens.
    expect(RECIPES_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(RECIPES_CSS).toContain("var(--bg)");
    expect(RECIPES_CSS).toContain("var(--surface)");
    expect(RECIPES_CSS).toContain("var(--surface-muted)");
  });

  it("surface.content owns background + border + radius and no elevation", () => {
    const rule = extractRule(RECIPES_CSS, "surface-content");
    expect(rule).toContain("var(--surface)");
    expect(rule).toContain("var(--border)");
    expect(rule).toContain("border-radius");
    // The forward elevation rule: ordinary content must not own a shadow.
    expect(rule).not.toMatch(/box-shadow/);
  });

  it("surface.overlay is the elevation owner (shadow)", () => {
    const rule = extractRule(RECIPES_CSS, "surface-overlay");
    expect(rule).toMatch(/box-shadow/);
  });

  it("surface.attention demands attention by color, not elevation", () => {
    // Attention surfaces are in-flow color regions (banners/placeholders);
    // they must NOT use elevation. The component owns the color variant.
    const rule = extractRule(RECIPES_CSS, "surface-attention");
    expect(rule).toContain("border-radius");
    expect(rule).not.toMatch(/box-shadow/);
  });
});

/** Extract the CSS rule body for `.name { ... }` from the stylesheet text. */
function extractRule(css: string, name: string): string {
  // Source CSS uses `.name {` with a space; compiled CSS uses `.name{`.
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
