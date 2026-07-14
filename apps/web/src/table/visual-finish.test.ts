import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tableCss = readFileSync(join(here, "recipes.css"), "utf8");
const indexCss = readFileSync(join(here, "../index.css"), "utf8");

describe("table and color visual-finish authority", () => {
  it("publishes the refined perceptually-uniform product-blue token system", () => {
    // UI-PRODUCT-FINISH-CLOSURE-1: tokens were refined for perceptual
    // uniformity and clear canvas/surface layer separation. These are the
    // current authoritative values and MUST stay in sync with index.css.
    expect(indexCss).toContain("--primary: #2563eb");
    expect(indexCss).toContain("--primary-soft-strong: #d3e2ff");
    expect(indexCss).toContain("--primary-focus: #7aa7ff");
    expect(indexCss).toContain("--bg: #ffffff");
    expect(indexCss).toContain("--text: #111827");
    expect(indexCss).toContain("--border-raised: #d7dde5");
    expect(indexCss).toContain("--border-shell: #dde2e8");
    expect(indexCss).toContain("--border-control: #cdd6e2");
    expect(indexCss).toContain("--border-divider: #edf0f3");
  });

  it("gives table lines three distinct semantic boundaries", () => {
    expect(tableCss).toContain("var(--border-shell)");
    expect(tableCss).toContain("var(--border-header)");
    expect(tableCss).toContain("var(--border-row)");
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
    expect(tableCss).toMatch(
      /\[data-slot="admin-table-shell"\]\s+\[data-slot="table"\][\s\S]*?table-layout:\s*fixed/,
    );
    expect(tableCss).toMatch(
      /\[data-slot="admin-table-shell"\]\s+\[data-slot="table"\][\s\S]*?border-collapse:\s*collapse/,
    );
  });

  it("provides three actions-column density tiers", () => {
    // Pages pick the tier that fits their worst-case action set under the
    // strict fixed-layout column width.
    expect(tableCss).toMatch(
      /\[data-column-role="actions"\]\s+\{[^}]*width:\s*6\.5rem/,
    );
    expect(tableCss).toMatch(
      /\[data-actions-density="normal"\]\s+\[data-column-role="actions"\]\s+\{[^}]*width:\s*9rem/,
    );
    expect(tableCss).toMatch(
      /\[data-actions-density="wide"\]\s+\[data-column-role="actions"\]\s+\{[^}]*width:\s*11rem/,
    );
  });

  it("declares explicit widths on flexible columns for fixed layout", () => {
    // Fixed layout honors <col> width (not min-width), so flexible columns
    // need an explicit width or they share remaining space evenly.
    expect(tableCss).toMatch(
      /\[data-column-role="secondary-text"\]\s+\{[^}]*width:\s*10rem/,
    );
    expect(tableCss).toMatch(
      /\[data-column-role="long-text"\]\s+\{[^}]*width:\s*18rem/,
    );
    expect(tableCss).toMatch(
      /\[data-column-role="tag-list"\]\s+\{[^}]*width:\s*11rem/,
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
