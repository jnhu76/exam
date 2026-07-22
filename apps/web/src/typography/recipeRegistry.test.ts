import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECIPE_REGISTRY,
  RECIPE_NAMES,
  getRecipeAuthority,
} from "./recipeRegistry";
import { CONFIRMED_RECIPES, isConfirmedRecipe } from "./typography-vocabulary";

/**
 * Recipe registry authority + CSS drift tests
 * (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §9, §10, §17C/D).
 *
 * These prove:
 *  1. the registry is internally well-formed (one entry per role, no dups);
 *  2. the registry is BIDIRECTIONALLY consistent with recipes.css — every
 *     owned property is declared in CSS, and every CSS declaration is
 *     acknowledged as owned (this is the real divergence detector, not two
 *     duplicated lists that can drift together);
 *  3. the Markdown vocabulary carries a GENERATED registry table that matches
 *     the committed registry byte-for-byte.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const RECIPES_CSS = readFileSync(join(HERE, "recipes.css"), "utf8");
const VOCAB_MD = readFileSync(join(HERE, "typography-vocabulary.md"), "utf8");

describe("recipe registry — internal well-formedness", () => {
  it("recipe names are unique and in canonical order", () => {
    expect(RECIPE_NAMES).toEqual([
      "page-title",
      "page-description",
      "section-title",
      "body",
      "secondary",
      "metadata",
      "reading",
      "long-response",
      "metric",
      "metric-hero",
      "numeric",
      "code",
    ]);
    expect(new Set(RECIPE_NAMES).size).toBe(RECIPE_NAMES.length);
  });

  it("every recipe owns at least one property", () => {
    for (const r of RECIPE_REGISTRY) {
      expect(
        r.ownedProperties.length,
        `${r.name} should own >=1 property`,
      ).toBeGreaterThan(0);
    }
  });

  it("owned and layout-owned properties never overlap for one recipe", () => {
    for (const r of RECIPE_REGISTRY) {
      const owned = new Set(r.ownedProperties);
      for (const p of r.layoutOwnedProperties) {
        expect(
          owned.has(p),
          `${r.name}: ${p} is both owned and layout-owned`,
        ).toBe(false);
      }
    }
  });

  it("CONFIRMED_RECIPES (vocabulary public API) matches the registry", () => {
    expect(CONFIRMED_RECIPES).toEqual(RECIPE_NAMES);
    expect(isConfirmedRecipe("metadata")).toBe(true);
    expect(isConfirmedRecipe("field-error")).toBe(false);
    expect(isConfirmedRecipe("status")).toBe(false);
  });
});

/**
 * Extract the CSS rule body for `.name { ... }` and return the set of CSS
 * property names it declares. Mirrors the helper in recipes.test.ts.
 */
function cssDeclaredProperties(css: string, cls: string): Set<string> {
  const re = new RegExp(`\\.${cls}\\s*\\{`);
  const m = re.exec(css);
  if (!m) return new Set();
  const bodyStart = m.index + m[0].length;
  let depth = 1;
  let i = bodyStart;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  const body = css.slice(bodyStart, i - 1);
  return new Set(
    [...body.matchAll(/([\w-]+)\s*:/g)]
      .map((mm) => mm[1])
      .filter((s): s is string => typeof s === "string"),
  );
}

describe("recipe registry ↔ recipes.css drift (bidirectional)", () => {
  it("every registry recipe has a CSS class", () => {
    for (const name of RECIPE_NAMES) {
      expect(RECIPES_CSS, `recipes.css must define .type-${name}`).toContain(
        `.type-${name}`,
      );
    }
  });

  it("CSS-declared properties == registry ownedProperties (forward direction)", () => {
    // The CSS implementation MUST declare every property the registry says is
    // owned. A recipe that claims to own a property it doesn't pin is drift.
    for (const r of RECIPE_REGISTRY) {
      const declared = cssDeclaredProperties(RECIPES_CSS, `type-${r.name}`);
      for (const owned of r.ownedProperties) {
        expect(
          declared.has(owned),
          `.type-${r.name} CSS must declare owned property "${owned}"`,
        ).toBe(true);
      }
    }
  });

  it("registry acknowledges every CSS-declared property (reverse direction)", () => {
    // The registry MUST acknowledge every property the CSS declares as either
    // owned or layout-owned. An undeclared CSS property is drift.
    for (const r of RECIPE_REGISTRY) {
      const declared = cssDeclaredProperties(RECIPES_CSS, `type-${r.name}`);
      const acknowledged: Set<string> = new Set([
        ...r.ownedProperties,
        ...r.layoutOwnedProperties,
      ]);
      for (const prop of declared) {
        expect(
          acknowledged.has(prop),
          `.type-${r.name} CSS declares "${prop}" but registry does not acknowledge it`,
        ).toBe(true);
      }
    }
  });

  it("layout-owned properties are NOT declared in CSS (they are composable)", () => {
    // A layout-owned property is intentionally NOT pinned by the recipe.
    for (const r of RECIPE_REGISTRY) {
      const declared = cssDeclaredProperties(RECIPES_CSS, `type-${r.name}`);
      for (const layout of r.layoutOwnedProperties) {
        expect(
          declared.has(layout),
          `.type-${r.name} CSS must NOT declare layout-owned property "${layout}"`,
        ).toBe(false);
      }
    }
  });

  it("long-response min-height is LAYOUT-OWNED (the resolved contradiction)", () => {
    const lr = getRecipeAuthority("long-response");
    expect(lr).toBeDefined();
    expect(lr!.ownedProperties).not.toContain("min-height");
    expect(lr!.layoutOwnedProperties).toContain("min-height");
    // And CSS does not declare it:
    expect(
      cssDeclaredProperties(RECIPES_CSS, "type-long-response").has(
        "min-height",
      ),
    ).toBe(false);
  });

  it("type-code genuinely OWNS white-space + overflow-x (declared in CSS)", () => {
    const code = getRecipeAuthority("code");
    expect(code!.ownedProperties).toContain("white-space");
    expect(code!.ownedProperties).toContain("overflow-x");
    expect(
      cssDeclaredProperties(RECIPES_CSS, "type-code").has("white-space"),
    ).toBe(true);
    expect(
      cssDeclaredProperties(RECIPES_CSS, "type-code").has("overflow-x"),
    ).toBe(true);
  });

  it("type-metric owns its 28px size and line-height", () => {
    const metric = getRecipeAuthority("metric");
    expect(metric!.ownedProperties).toContain("font-size");
    expect(metric!.ownedProperties).toContain("line-height");
    expect(metric!.layoutOwnedProperties).not.toContain("font-size");
  });
});

/**
 * Generate the registry table the way it should appear in
 * typography-vocabulary.md, so a test can assert byte-equality against the
 * committed GENERATED block. This avoids the two-lists-drift-together trap.
 */
function generateRegistryMarkdownTable(): string {
  const lines = [
    "| Recipe | Owned properties | Layout-owned properties |",
    "| --- | --- | --- |",
  ];
  for (const r of RECIPE_REGISTRY) {
    const owned = r.ownedProperties.join(", ") || "—";
    const layout = r.layoutOwnedProperties.join(", ") || "—";
    lines.push(`| \`${r.name}\` | ${owned} | ${layout} |`);
  }
  return lines.join("\n");
}

describe("typography-vocabulary.md GENERATED registry table", () => {
  it("contains a GENERATED registry block matching the registry byte-for-byte", () => {
    const generated = generateRegistryMarkdownTable();
    // The committed Markdown must contain the exact generated table inside the
    // BEGIN/END GENERATED markers. If the registry changes, the Markdown block
    // must be regenerated; otherwise this test fails.
    const beginMarker = "<!-- BEGIN GENERATED RECIPE REGISTRY -->";
    const endMarker = "<!-- END GENERATED RECIPE REGISTRY -->";
    const beginIdx = VOCAB_MD.indexOf(beginMarker);
    const endIdx = VOCAB_MD.indexOf(endMarker);
    expect(
      beginIdx,
      "vocabulary.md must contain BEGIN GENERATED marker",
    ).toBeGreaterThanOrEqual(0);
    expect(
      endIdx,
      "vocabulary.md must contain END GENERATED marker",
    ).toBeGreaterThan(beginIdx);
    const block = VOCAB_MD.slice(beginIdx + beginMarker.length, endIdx).trim();
    expect(block).toBe(generated);
  });

  it("references every recipe name in its human prose (no stale recipes)", () => {
    for (const name of RECIPE_NAMES) {
      expect(VOCAB_MD, `vocabulary.md should reference ${name}`).toContain(
        name,
      );
    }
  });
});
