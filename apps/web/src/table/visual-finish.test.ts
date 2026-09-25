import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROLE_GEOMETRY } from "@/table/columnAllocation";

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

/** The hex value a `--var: #rrggbb;` definition carries in index.css. */
function cssHexVar(css: string, name: string): string | null {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  return m?.[1] ?? null;
}

describe("table and color visual-finish authority", () => {
  it("keeps the brand pin and the documented neutral token relationships", () => {
    // UI-TABLE-KOI-COLOR-REFINE-2: index.css is the palette authority, so
    // exact neutral values are not re-listed here (a retune must not edit
    // test + source in lockstep with zero independent signal). What is
    // governed instead: the one brand pin, the canvas relationship (light
    // neutral grey, never pure white, so white surfaces read as a raised
    // layer), and the border lightness ladder control > shell/header >
    // row/divider > grid, strongest to faintest. The ink floor on --text is
    // proven by the AAA contrast recompute below.
    expect(indexCss).toContain("--primary: #2563eb");

    const bg = cssHexVar(indexCss, "--bg");
    expect(bg, "--bg must be a hex color").not.toBeNull();
    expect(bg).not.toBe("#ffffff");

    const control = cssHexVar(indexCss, "--border-control");
    const shell = cssHexVar(indexCss, "--border-shell");
    const header = cssHexVar(indexCss, "--border-header");
    const divider = cssHexVar(indexCss, "--border-divider");
    const row = cssHexVar(indexCss, "--border-row");
    const grid = cssHexVar(indexCss, "--border-grid");
    for (const [name, hex] of [
      ["--border-control", control],
      ["--border-shell", shell],
      ["--border-header", header],
      ["--border-divider", divider],
      ["--border-row", row],
      ["--border-grid", grid],
    ] as const) {
      expect(hex, `${name} must be a hex color`).not.toBeNull();
    }
    const bright = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    // Control edges are the strongest (darkest) boundary; shell and header
    // form the middle tier; row and its divider alias are fainter; the
    // per-cell grid is the faintest.
    expect(bright(control!)).toBeLessThan(bright(shell!));
    expect(bright(control!)).toBeLessThan(bright(header!));
    expect(bright(shell!)).toBeLessThan(bright(row!));
    expect(bright(header!)).toBeLessThan(bright(row!));
    expect(bright(row!)).toBeLessThan(bright(grid!));
    // The divider is the documented alias of the row boundary.
    expect(bright(divider!)).toBe(bright(row!));
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

  it("enforces fixed layout + collapsed borders on allocated tables only", () => {
    // #601 Phase F: fixed layout is exact under the computed allocation —
    // colgroup, header and body cells share one allocation emitted by
    // useColumnAllocation. Scoped to the `data-column-allocation="computed"`
    // marker: calendar, Dialog and Card tables outside the contract keep auto
    // layout. border-collapse (not separate): headers and body share column
    // edges; the low-contrast grid is drawn directly on <th>/<td>, which
    // renders reliably under collapse.
    expect(tableCss).toMatch(
      /\[data-column-allocation="computed"\]\s*\{[^}]*table-layout:\s*fixed/,
    );
    expect(tableCss).toMatch(
      /\[data-column-allocation="computed"\][\s\S]*?border-collapse:\s*collapse/,
    );
  });

  it("ends a filled table's grid at the region edge (no 0.5px scroll range)", () => {
    // #601 Phase F: under border-collapse the outer half of the last column's
    // 1px right border sits outside the table's content edge, so a table sized
    // to the region's content box reported scrollWidth = clientWidth + 1 — a
    // fitted region with 1px of scrollable overflow, which classic scrollbars
    // (Windows Chrome) answer with a painted horizontal scrollbar (measured at
    // 1440: /admin/exams, /admin/candidates, /admin/recovery each rendered a
    // 1142.5px table box inside a 1142px region). The compressed and preferred
    // regimes fill the region exactly, so their last column draws no right
    // border; the expanded regime keeps it (an interior edge against the
    // trailing spacer cell) and the overflow regime keeps it too (the table
    // genuinely scrolls and its right edge is scroll content).
    expect(tableCss).toMatch(
      /\[data-geometry-state="compressed"\]\s*tr\s*>\s*:last-child[\s\S]*?border-right-width:\s*0/,
    );
    expect(tableCss).toMatch(
      /\[data-geometry-state="preferred"\]\s*tr\s*>\s*:last-child[\s\S]*?border-right-width:\s*0/,
    );
    expect(tableCss).not.toMatch(
      /\[data-geometry-state="expanded"\]\s*tr\s*>\s*:last-child[\s\S]*?border-right-width:\s*0/,
    );
  });

  it("keeps column widths out of CSS — the allocator is the single width owner", () => {
    // #601 Phase F: ROLE_GEOMETRY (table/columnAllocation.ts) owns every
    // column width. recipes.css must not reintroduce a second width
    // authority — not for flexible roles, not for locked roles.
    expect(tableCss).not.toMatch(/\[data-column-role=[^\]]*\]\s*\{[^}]*width:/);
    expect(tableCss).not.toMatch(
      /\[data-column-role=[^\]]*\]\s*\{[^}]*min-width:/,
    );
    // The geometry vocabulary is { floor, basis } only (issue 601 Phase F
    // convergence): no maxWidth, no grow/shrink weights, no per-role solver.
    // `floor == basis` marks a non-compressible role; `floor < basis` marks a
    // role that already declares a narrower legal representation. `basis` is
    // the larger of the role's value token and its header capacity
    // (number/duration).
    expect(
      Object.entries(ROLE_GEOMETRY)
        .filter(([role]) => role !== "actions")
        .map(([role, g]) => `${role}:${g.floor}/${g.basis}`),
    ).toEqual([
      "primary-text:100/192",
      "secondary-text:84/144",
      "long-text:132/256",
      "description:132/208",
      "tag-list:104/160",
      "status:136/136",
      "date:168/168",
      "date-range:232/232",
      "duration:80/96",
      "number:72/112",
      "score:80/80",
      "short-id:120/120",
      "type:116/116",
      "action-label:152/152",
    ]);
  });

  it("carries the geometry vocabulary on exactly one element per shell", () => {
    // #601 Phase F: the scroll region is the single writer of
    // data-table-archetype / data-table-tier. Both shell compositions render
    // that region (DataTableShell as an inner div, DataWorkbench with the
    // region itself carrying data-slot="admin-table-shell"), so CSS and
    // runtime probes have one element to read. A second writer — e.g. the
    // archetype repeated on the outer section — would let a probe read a
    // stale value from an element that is not the measured region.
    const webRoot = join(here, "..");
    // Matches the attribute WRITE (JSX `data-table-archetype={...}` or an
    // attribute object key), not a comment that names the attribute.
    const write = /["']?data-table-(?:archetype|tier)["']?\s*[:=]/;
    const writers = listSourceFiles(webRoot)
      .filter((path) => write.test(readFileSync(path, "utf8")))
      .map((path) => relative(webRoot, path))
      .sort();
    expect(writers).toEqual(["components/shared/TableScrollSurface.tsx"]);
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
    //
    // The probe matches property READS (`el.scrollWidth`), not prose: a doc
    // comment that quotes the measurement vocabulary is not an owner.
    const webRoot = join(here, "..");
    const owners = listSourceFiles(webRoot)
      .filter((path) => !path.startsWith(join(webRoot, "test")))
      .map((path) => ({
        path: relative(webRoot, path),
        text: readFileSync(path, "utf8"),
      }))
      .filter(({ text }) =>
        /ResizeObserver|\.(?:scrollWidth|clientWidth|offsetWidth)\b/.test(text),
      )
      .map(({ path }) => path)
      .sort();
    // Two closed fact classes, one owner each (#601 Phase F): REGION
    // overflow facts (the observation that drives affordances and the
    // allocation scope) belong to the hooks; the CELL clip fact — the hover
    // reveal of a clipped single-line value — belongs to DataTableContract,
    // reads its own element once per hover event, and must never grow into a
    // second region observer.
    expect(owners).toEqual([
      "components/shared/DataTableContract.tsx",
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
