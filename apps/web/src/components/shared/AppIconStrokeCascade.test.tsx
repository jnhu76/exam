import { render } from "@testing-library/react";
import { Eye } from "lucide-react";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listAuthorStylesheets } from "@/test/cssRules";
import { AppIcon } from "./AppIcon";

/**
 * AppIcon stroke authority vs the CSS cascade (issue 577 VAA2-B1 regression gate).
 *
 * The B1 failure class is: the SVG presentation attribute is correct
 * (`stroke-width="2.25"`) but the COMPUTED stroke is wrong, because an
 * unlayered author rule (`svg.lucide { stroke-width: 1.5 }`) matched the icon
 * — author CSS beats presentation attributes at every specificity. Asserting
 * the JSX attribute (AppIcon.test.tsx) cannot see this class of defect.
 *
 * Surface (issue 577 review-fix-1 MAJOR-2): the gate covers EVERY author
 * stylesheet under web src — the full superset of the main.tsx CSS import
 * closure — not only index.css. A future recipe stylesheet declaring a broad
 * stroke selector fails this gate exactly like index.css would. It is
 * cascade-aware by construction: it extracts every stroke-width selector from
 * the real stylesheets and proves, through the browser's own selector engine
 * (element.matches), that none of them can match an AppIcon output — so
 * nothing in author CSS contests the presentation attribute and the attribute
 * IS the computed value. It also proves the primitive-internal optical rule
 * still reaches the icons those primitives own (R2).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", "..", "..", "src");
const STYLESHEETS = listAuthorStylesheets(SRC_ROOT).map((path) => ({
  file: relative(SRC_ROOT, path),
  css: readFileSync(path, "utf8"),
}));
const ALL_CSS = STYLESHEETS.map((s) => s.css).join("\n");

/** Extract the selectors of every rule that declares stroke-width. */
export function strokeWidthSelectors(css: string): string[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors: string[] = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(noComments)) !== null) {
    if (!/stroke-width\s*:/.test(m[2] ?? "")) continue;
    for (const sel of (m[1] ?? "").split(",")) {
      const s = sel.trim();
      if (s) selectors.push(s);
    }
  }
  return selectors;
}

/** Stroke selectors that are NOT scoped to a primitive data-slot: potential AppIcon defeaters. */
export function broadStrokeSelectors(css: string): string[] {
  return strokeWidthSelectors(css).filter(
    (sel) => !sel.includes("[data-slot="),
  );
}

/**
 * A selector may thin an AppIcon render if it matches the rendered svg (or,
 * for inherited properties, an ancestor). stroke-width IS inherited in SVG, so
 * an ancestor match would also defeat the contract — checked against a
 * representative neutral tree.
 */
export function selectorsMatchingAppIcon(
  selectors: string[],
  svg: Element,
): string[] {
  const chain: Element[] = [];
  for (let el: Element | null = svg; el; el = el.parentElement) chain.push(el);
  return selectors.filter((sel) => {
    try {
      return chain.some((el) => el.matches(sel));
    } catch {
      return true; // unparseable selector = potential threat, report it
    }
  });
}

describe("AppIcon stroke authority survives the CSS cascade (issue 577 B1)", () => {
  it("the gate covers the whole author-CSS surface (superset of the import closure)", () => {
    expect(STYLESHEETS.length).toBeGreaterThanOrEqual(8);
    expect(STYLESHEETS.map((s) => s.file)).toContain("index.css");
    const mainTs = readFileSync(join(SRC_ROOT, "main.tsx"), "utf8");
    const closure = [...mainTs.matchAll(/"(\.\/[^"]+\.css)"/g)].map((m) =>
      m[1]!.replace("./", ""),
    );
    expect(closure.length).toBeGreaterThan(0);
    for (const rel of closure) {
      expect(
        STYLESHEETS.some((s) => s.file.endsWith(rel)),
        `imported stylesheet not scanned: ${rel}`,
      ).toBe(true);
    }
  });

  it("every stroke-width selector in EVERY author stylesheet is data-slot scoped", () => {
    for (const { file, css } of STYLESHEETS) {
      const selectors = strokeWidthSelectors(css);
      for (const sel of selectors) {
        expect(
          sel.includes("[data-slot="),
          `${file}: stroke-width selector must be data-slot scoped, got: ${sel}`,
        ).toBe(true);
      }
    }
    expect(strokeWidthSelectors(ALL_CSS).length).toBeGreaterThan(0);
  });

  it("no stroke-width selector can match AppIcon output (inline/nav/state)", () => {
    const selectors = strokeWidthSelectors(ALL_CSS);
    for (const size of ["inline", "nav", "state"] as const) {
      const { container } = render(
        <div>
          <button type="button">
            <AppIcon icon={Eye} size={size} />
          </button>
        </div>,
      );
      const svg = container.querySelector("svg")!;
      // The declared contract survives only if nothing in author CSS contests
      // the presentation attribute.
      expect(selectorsMatchingAppIcon(selectors, svg)).toEqual([]);
    }
  });

  it("the primitive-internal optical rule still reaches icons the primitive owns (R2)", () => {
    const selectors = strokeWidthSelectors(ALL_CSS);
    expect(selectors).toContain('[data-slot="select-trigger"] svg');
    // Proven through the selector engine on a representative primitive tree.
    const host = document.createElement("div");
    const trigger = document.createElement("button");
    trigger.setAttribute("data-slot", "select-trigger");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "lucide lucide-chevron-down");
    trigger.appendChild(svg);
    host.appendChild(trigger);
    document.body.appendChild(host);
    try {
      expect(svg.matches('[data-slot="select-trigger"] svg')).toBe(true);
      expect(
        selectors.some((sel) => {
          try {
            return svg.matches(sel);
          } catch {
            return false;
          }
        }),
      ).toBe(true);
    } finally {
      host.remove();
    }
  });

  it("reds when a broad svg.lucide stroke override returns (in-memory mutation)", () => {
    const mutated = ALL_CSS.replace(
      '[data-slot="select-trigger"] svg',
      'svg.lucide,\n[data-slot="select-trigger"] svg',
    );
    expect(mutated).not.toBe(ALL_CSS);
    const selectors = strokeWidthSelectors(mutated);
    expect(selectors).toContain("svg.lucide");
    const { container } = render(<AppIcon icon={Eye} size="inline" />);
    const svg = container.querySelector("svg")!;
    expect(svg.matches("svg.lucide")).toBe(true);
    expect(selectorsMatchingAppIcon(selectors, svg)).toEqual(["svg.lucide"]);
  });

  it("reds when a future recipe stylesheet declares a broad stroke rule (foreign-stylesheet mutation)", () => {
    // A stylesheet imported tomorrow, not index.css — the gate must flag it.
    const foreign = "svg.lucide, .icon-row svg { stroke-width: 2 }";
    expect(broadStrokeSelectors(foreign)).toEqual([
      "svg.lucide",
      ".icon-row svg",
    ]);
    // The data-slot-scoped primitive rule stays legal.
    expect(
      broadStrokeSelectors('[data-slot="pagination"] svg{stroke-width:1.5}'),
    ).toEqual([]);
  });
});
