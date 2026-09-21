import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Overlay family authority (issue 577 M5 / Corrective H).
 *
 * surface-overlay (+ its variants) is the single owner of the floating-layer
 * appearance (background / border / radius / elevation). The shadcn overlay
 * primitives must CONSUME it, not compose their own bg-popover/bg-background
 * + rounded-* + shadow-* stacks. Modal/panel render the content-tier
 * var(--surface) background per the frozen issue 582 visual decisions (D7); the
 * 6/8 overlay radius split stays as-built. A change to the family must edit
 * the variants here, not re-scatter utilities into the primitives.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(HERE, "..");
const RECIPES_CSS = readFileSync(join(HERE, "recipes.css"), "utf8");

const SHADOW_MD =
  "0 4px 6px -1px rgb(0 0 0 / 0.1),\n    0 2px 4px -2px rgb(0 0 0 / 0.1)";
const SHADOW_LG =
  "0 10px 15px -3px rgb(0 0 0 / 0.1),\n    0 4px 6px -4px rgb(0 0 0 / 0.1)";

function extractRule(css: string, selector: string): string {
  const re = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{",
  );
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

/** The overlay consumers named by the ui-system surface contract. */
const OVERLAY_CONSUMERS = {
  "components/ui/dialog.tsx": "dialog-content",
  "components/ui/alert-dialog.tsx": "alert-dialog-content",
  "components/ui/popover.tsx": "popover-content",
  "components/ui/dropdown-menu.tsx": "dropdown-menu-content",
  "components/ui/select.tsx": "select-content",
  "components/ui/sheet.tsx": "sheet-content",
} as const;

describe("surface-overlay family owns the floating-layer appearance", () => {
  it("base variant = white surface, 6px radius, md elevation", () => {
    const rule = extractRule(RECIPES_CSS, ".surface-overlay");
    expect(rule).toContain("background: var(--surface)");
    expect(rule).toContain("border: 1px solid var(--border)");
    expect(rule).toContain("border-radius: 0.375rem");
    expect(rule).toContain(SHADOW_MD);
  });

  it("radius-lg variant keeps SelectContent at 8px (deferred 6/8 split)", () => {
    const rule = extractRule(
      RECIPES_CSS,
      '.surface-overlay[data-overlay-radius="lg"]',
    );
    expect(rule).toContain("border-radius: var(--radius)");
  });

  it("elevation-lg variant keeps sub-menu shadow-lg", () => {
    const rule = extractRule(
      RECIPES_CSS,
      '.surface-overlay[data-overlay-elevation="lg"]',
    );
    expect(rule).toContain(SHADOW_LG);
  });

  it("modal variant renders the content-tier surface + 8px + lg (issue 582 D7)", () => {
    const rule = extractRule(
      RECIPES_CSS,
      '.surface-overlay[data-overlay-variant="modal"]',
    );
    expect(rule).toContain("background: var(--surface)");
    expect(rule).not.toContain("background: var(--bg)");
    expect(rule).toContain("border-radius: var(--radius)");
    expect(rule).toContain(SHADOW_LG);
  });

  it("panel variant renders the content-tier surface, zeroed radius/border, one edge per side (issue 582 D7)", () => {
    const rule = extractRule(
      RECIPES_CSS,
      '.surface-overlay[data-overlay-variant="panel"]',
    );
    expect(rule).toContain("background: var(--surface)");
    expect(rule).not.toContain("background: var(--bg)");
    expect(rule).toContain("border: 0");
    expect(rule).toContain("border-radius: 0");
    for (const edge of ["left", "right", "top", "bottom"]) {
      const edgeRule = extractRule(
        RECIPES_CSS,
        `.surface-overlay[data-overlay-variant="panel"][data-overlay-panel-edge="${edge}"]`,
      );
      expect(edgeRule).toContain(`border-${edge}: 1px solid var(--border)`);
    }
  });
});

describe("every overlay primitive consumes the family (R7)", () => {
  for (const [file, slot] of Object.entries(OVERLAY_CONSUMERS)) {
    it(`${file} binds ${slot} to surface-overlay`, () => {
      const src = readFileSync(join(WEB_SRC, file), "utf8");
      expect(src).toContain(`data-slot="${slot}"`);
      // The content element carries the semantic class on the same source —
      // extract the className string attached to the data-slot element.
      const idx = src.indexOf(`data-slot="${slot}"`);
      const window = src.slice(idx, idx + 1200);
      expect(window).toContain("surface-overlay");
      // And no self-composed appearance for recipe-owned properties remains.
      expect(window).not.toMatch(/bg-popover|bg-background/);
      expect(window).not.toMatch(/shadow-(md|lg)/);
      expect(window).not.toMatch(/rounded-(md|lg)/);
      expect(window).not.toMatch(/(^|[\s"'])border([\s"']|$)/);
    });
  }

  it("dropdown sub-content is also family-bound at lg elevation", () => {
    const src = readFileSync(
      join(WEB_SRC, "components/ui/dropdown-menu.tsx"),
      "utf8",
    );
    const idx = src.indexOf('data-slot="dropdown-menu-sub-content"');
    const window = src.slice(idx, idx + 1200);
    expect(window).toContain("surface-overlay");
    expect(window).toContain('data-overlay-elevation="lg"');
    expect(window).not.toMatch(/bg-popover|shadow-(md|lg)|rounded-(md|lg)/);
  });

  it("ConfirmDialog is covered transitively via ui/dialog composition", () => {
    const src = readFileSync(
      join(WEB_SRC, "components/shared/ConfirmDialog.tsx"),
      "utf8",
    );
    expect(src).toMatch(/DialogContent/);
  });

  it("reds when a primitive re-scatters utilities (in-memory mutation)", () => {
    const src = readFileSync(
      join(WEB_SRC, "components/ui/popover.tsx"),
      "utf8",
    );
    const mutated = src.replace(
      "surface-overlay text-popover-foreground",
      "rounded-md border bg-popover text-popover-foreground shadow-md",
    );
    expect(mutated).not.toBe(src);
    const idx = mutated.indexOf('data-slot="popover-content"');
    const window = mutated.slice(idx, idx + 1200);
    expect(/bg-popover|shadow-(md|lg)|rounded-(md|lg)/.test(window)).toBe(true);
  });
});
