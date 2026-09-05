import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tableCss = readFileSync(join(here, "recipes.css"), "utf8");
const indexCss = readFileSync(join(here, "../index.css"), "utf8");

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
    expect(indexCss).toContain("--text: rgba(0, 0, 0, 0.88)");
    expect(indexCss).toContain("--border-control: #d1d5db");
    expect(indexCss).toContain("--border-shell: #dfe3e8");
    expect(indexCss).toContain("--border-header: #e1e5ea");
    expect(indexCss).toContain("--border-divider: #edf0f3");
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

  it("enforces fixed layout + collapsed borders inside the admin shell only", () => {
    // Fixed layout makes <col> widths authoritative (root cause fix for
    // candidate-fields horizontal scroll + users header/body misalign).
    // Scoped to the admin shell so calendar, Dialog, and Card tables keep
    // auto layout.
    // border-collapse (not separate): collapse lets a width:100% fixed-layout
    // table shrink to its container when declared col widths would overflow
    // (the candidate-fields horizontal-scroll fix). The low-contrast grid is
    // drawn directly on <th>/<td>, which renders reliably under collapse.
    expect(tableCss).toMatch(
      /\[data-slot="admin-table-shell"\]\s+\[data-slot="table"\][\s\S]*?table-layout:\s*fixed/,
    );
    expect(tableCss).toMatch(
      /\[data-slot="admin-table-shell"\]\s+\[data-slot="table"\][\s\S]*?border-collapse:\s*collapse/,
    );
  });

  it("binds the actions column to the icon-only contract width", () => {
    // #445 P3 §4.3: the inline row-action vocabulary is icon-only and
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
    expect(tableCss).toMatch(
      /\[data-column-role="type"\]\s+\{[^}]*width:\s*5\.5rem/,
    );
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

  it("defines non-interactive state-aware scroll affordances", () => {
    expect(tableCss).toContain('[data-slot="table-scroll-fade-left"]');
    expect(tableCss).toContain('[data-slot="table-scroll-fade-right"]');
    expect(tableCss).toContain("pointer-events: none");
    expect(tableCss).toContain("width: 0.5rem");
    expect(tableCss).toContain("var(--text-muted) 4%");
  });
});
