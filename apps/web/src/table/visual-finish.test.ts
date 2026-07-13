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
    expect(indexCss).toContain("--bg: #eef1f6");
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
