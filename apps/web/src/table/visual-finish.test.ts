import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tableCss = readFileSync(join(here, "recipes.css"), "utf8");
const workbenchCss = readFileSync(join(here, "workbench.css"), "utf8");
const indexCss = readFileSync(join(here, "../index.css"), "utf8");
const tableTsx = readFileSync(join(here, "../components/ui/table.tsx"), "utf8");

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "lint") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

describe("table and color visual-finish authority", () => {
  it("publishes the refined perceptually-uniform product-blue token system", () => {
    // UI-TABLE-KOI-COLOR-REFINE-2: structural tokens are now NEUTRAL grey (no
    // blue cast); the canvas is a light neutral grey so white surfaces read as
    // a raised layer; borders follow control > shell/header > row > grid.
    // These are the current authoritative values and MUST stay in sync with
    // index.css.
    expect(indexCss).toContain("--primary: #2563eb");
    expect(indexCss).toContain("--primary-soft-strong: #dbeafe");
    expect(indexCss).toContain("--primary-focus: #93c5fd");
    expect(indexCss).toContain("--bg: #f5f7fa");
    expect(indexCss).toContain("--text: rgba(0, 0, 0, 0.76)");
    expect(indexCss).toContain("--border-control: #d1d5db");
    expect(indexCss).toContain("--border-shell: #dfe3e8");
    expect(indexCss).toContain("--border-header: #e1e5ea");
    expect(indexCss).toContain("--border-divider: #edf0f3");
  });

  it("keeps primary text ink at or above the AAA floor on white (issue #601 V1)", () => {
    // The --text token is the single primary-ink authority; every heading,
    // cell, label and metric inherits it. Phase C V1 selected 76% black ink
    // (≈10.9:1 blended on white) for a graduated primary/secondary ladder.
    // This guard recomputes the WCAG ratio from the token so any future alpha
    // change that drops primary text below AAA fails here.
    const m = /--text:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(
      indexCss,
    );
    if (!m) throw new Error("--text token not found in index.css");
    const [r, g, b, a] = [
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Number(m[4]),
    ];
    const blend = (c: number) => (c * a + 255 * (1 - a)) / 255;
    const lin = (c: number) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    const luminance =
      0.2126 * lin(blend(r)) + 0.7152 * lin(blend(g)) + 0.0722 * lin(blend(b));
    const contrastOnWhite = 1.05 / (luminance + 0.05);
    expect(contrastOnWhite).toBeGreaterThanOrEqual(7);
  });

  it("pins the 52px body-row breathing geometry (issue #601 V2a)", () => {
    // Body-row minimum is 52px against the frozen 22px cell line-height —
    // ≈15px vertical air per side for a single line. Both table grammars stay
    // in step: the standard TableCell height class and the workbench row
    // minimum. Height is a minimum, so multi-line rows grow safely.
    expect(tableTsx).toMatch(/"h-13 px-4 py-0 align-middle/);
    expect(tableTsx).not.toContain("h-12");
    expect(tableCss).toMatch(
      /\[data-slot="table-cell"\]\s*\{[^}]*line-height:\s*1\.375rem/,
    );
    expect(workbenchCss).toMatch(
      /\[data-slot="data-workbench"\]\s+\[data-slot="table-body"\]\s+\[data-slot="table-row"\]\s*\{[^}]*min-height:\s*3\.25rem/,
    );
  });

  it("gives table lines three distinct semantic boundaries", () => {
    expect(tableCss).toContain("var(--border-shell)");
    expect(tableCss).toContain("var(--border-header)");
    expect(tableCss).toContain("var(--border-row)");
  });

  it("renders a low-contrast per-cell grid on every admin table", () => {
    // UI-TABLE-KOI-COMPACT-1: every admin table draws the Koi low-contrast
    // grid directly on <th>/<td> (reliable under border-separate), never on
    // <tr>. Header cells own the tinted fill + stronger header bottom edge;
    // body cells own right + bottom grid lines.
    expect(tableCss).toContain("var(--border-grid)");
    expect(tableCss).toMatch(
      /\[data-slot="table-head"\][\s\S]*?background:\s*var\(--table-header\)/,
    );
    expect(tableCss).toMatch(
      /\[data-slot="table-head"\][\s\S]*?border-bottom:\s*1px solid var\(--border-header\)/,
    );
    expect(tableCss).toMatch(
      /\[data-slot="table-cell"\][\s\S]*?border-right:\s*1px solid var\(--border-grid\)/,
    );
    expect(tableCss).toMatch(
      /\[data-slot="table-cell"\][\s\S]*?border-bottom:\s*1px solid var\(--border-row\)/,
    );
  });

  it("leaves DataTableShell as the single local overflow owner", () => {
    expect(tableCss).toMatch(
      /\[data-slot="admin-table-shell"\]\s+\[data-slot="table-container"\][\s\S]*?overflow-x:\s*visible/,
    );
  });

  it("pins the governed table typography (issue 582 D2 + issue #601 V2b)", () => {
    // D2: governed cells converge UP to the 15px body/control tier.
    // V2b (issue #601): the header reads 14px / 20px / weight 500 — removes
    // the header-smaller-than-body inversion while the muted color keeps the
    // header subordinate. Band heights (44/42px) stay untouched.
    expect(tableCss).toMatch(
      /\[data-slot="table-head"\]\s*\{[^}]*font-size:\s*0\.875rem/,
    );
    expect(tableCss).toMatch(
      /\[data-slot="table-head"\]\s*\{[^}]*line-height:\s*1\.25rem/,
    );
    expect(tableCss).toMatch(
      /\[data-slot="table-head"\]\s*\{[^}]*font-weight:\s*500/,
    );
    expect(tableCss).toMatch(
      /\[data-slot="table-cell"\]\s*\{[^}]*font-size:\s*0\.9375rem/,
    );
    expect(tableCss).not.toMatch(
      /\[data-slot="table-cell"\]\s*\{[^}]*font-size:\s*0\.875rem/,
    );
  });

  it("enforces fixed layout + collapsed borders in tier-governed shells only", () => {
    // Fixed layout makes <col> widths authoritative (root cause fix for
    // candidate-fields horizontal scroll + users header/body misalign).
    // Scoped to TIER-GOVERNED shells (those carrying data-table-tier):
    // embedded-picker shells keep auto layout (the named exception, issue 445
    // P3 §9), as do calendar, Dialog, and Card tables outside the shell.
    // border-collapse (not separate): collapse lets a width:100% fixed-layout
    // table shrink to its container when declared col widths would overflow
    // (the candidate-fields horizontal-scroll fix). The low-contrast grid is
    // drawn directly on <th>/<td>, which renders reliably under collapse.
    expect(tableCss).toMatch(
      /\[data-slot="admin-table-shell"\]\[data-table-tier\]\s+\[data-slot="table"\][\s\S]*?table-layout:\s*fixed/,
    );
    expect(tableCss).toMatch(
      /\[data-slot="admin-table-shell"\]\s+\[data-slot="table"\][\s\S]*?border-collapse:\s*collapse/,
    );
  });

  it("binds the actions column to the icon-only contract width", () => {
    // issue 445 P3 §4.3: the inline row-action vocabulary is icon-only and
    // count-bounded, so the actions column is a LOCKED column at the derived
    // contract width (6rem fine / 7.5rem coarse) — not a per-page density
    // tier. The density selectors are gone entirely.
    expect(tableCss).toMatch(
      /\[data-column-role="actions"\]\s+\{[^}]*width:\s*6rem/,
    );
    expect(tableCss).toMatch(
      /@media \(pointer: coarse\)\s*\{[\s\S]*?\[data-column-role="actions"\]\s+\{[^}]*width:\s*7\.5rem/,
    );
    expect(tableCss).not.toContain("data-actions-density");
  });

  it("splits columns into flexible (auto) and locked (fixed-width) tiers", () => {
    // UI-TABLE-COLUMN-PRIORITY-1: flexible columns (text/content) carry
    // width:auto so under fixed layout they split the container's remaining
    // space (after locked columns take their fixed width). Locked columns
    // (atomic/metadata) carry a fixed width = min-width so they stay compact
    // and never wrap. This mirrors TanStack's size/minSize model.
    // Flexible (auto):
    expect(tableCss).toMatch(
      /\[data-column-role="primary-text"\]\s+\{[^}]*width:\s*auto/,
    );
    expect(tableCss).toMatch(
      /\[data-column-role="long-text"\]\s+\{[^}]*width:\s*auto/,
    );
    expect(tableCss).toMatch(
      /\[data-column-role="secondary-text"\]\s+\{[^}]*width:\s*auto/,
    );
    // Locked (fixed width):
    expect(tableCss).toMatch(
      /\[data-column-role="number"\]\s+\{[^}]*width:\s*4\.5rem/,
    );
    // type/date-range are vocabulary-bound tokens; their derived values are
    // pinned once, by table-contract-guards.test.ts (issue #590 owner).
  });

  it("defines restrained row hover, focus, and selected states", () => {
    expect(tableCss).toContain("var(--table-row-hover)");
    expect(tableCss).toContain("var(--table-row-focus)");
    expect(tableCss).toContain("var(--table-row-selected)");
    expect(tableCss).toContain("background-color 120ms ease-out");
    expect(tableCss).toContain("color 120ms ease-out");
  });

  it("owns desktop and direct-touch row-action geometry", () => {
    expect(tableCss).toMatch(
      /\[data-slot="row-actions"\][\s\S]*?width:\s*2rem/,
    );
    expect(tableCss).toMatch(
      /@media \(pointer: coarse\)[\s\S]*?width:\s*2\.75rem/,
    );
  });

  it("keeps the overflow-observation facts hooks the single measurement owners", () => {
    // issue 445 P3 §8: exactly one module may read scrollWidth/clientWidth via
    // a ResizeObserver loop. Before the convergence DataTableShell and
    // DataWorkbench each carried a byte-identical copy of the algorithm; any
    // second production owner (or a component re-deriving overflow facts)
    // must fail here instead of drifting. Issue 494 NAV-4 adds exactly one
    // vertical sibling (facts-only, no nav/role/route vocabulary) — a third
    // owner, or a component re-deriving facts, still fails here. Test-infra
    // (`src/test/`) is not a measurement owner — its ResizeObserver stub
    // exists only so Radix popper primitives can mount under jsdom.
    const webRoot = join(here, "..");
    const owners = listSourceFiles(webRoot)
      .filter((path) => !path.startsWith(join(webRoot, "test")))
      .map((path) => ({
        path: relative(webRoot, path),
        text: readFileSync(path, "utf8"),
      }))
      .filter(({ text }) => /ResizeObserver|scrollWidth/.test(text))
      .map(({ path }) => path)
      .sort();
    expect(owners).toEqual([
      "hooks/useOverflowObservation.ts",
      "hooks/useVerticalOverflowObservation.ts",
    ]);
  });

  it("defines non-interactive state-aware scroll affordances", () => {
    expect(tableCss).toContain('[data-slot="table-scroll-fade-left"]');
    expect(tableCss).toContain('[data-slot="table-scroll-fade-right"]');
    expect(tableCss).toContain("pointer-events: none");
    expect(tableCss).toContain("width: 0.5rem");
    expect(tableCss).toContain("var(--text-muted) 4%");
  });
});
