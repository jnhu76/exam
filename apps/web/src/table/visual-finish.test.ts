import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tableCss = readFileSync(join(here, "recipes.css"), "utf8");
const indexCss = readFileSync(join(here, "../index.css"), "utf8");

describe("table and color visual-finish authority", () => {
  it("publishes the cobalt and cool-neutral token system", () => {
    expect(indexCss).toContain("--primary: #2e6afd");
    expect(indexCss).toContain("--primary-soft-strong: #dce8ff");
    expect(indexCss).toContain("--primary-focus: #7aa2ff");
    expect(indexCss).toContain("--bg: #f4f7fb");
    expect(indexCss).toContain("--text: #162033");
    expect(indexCss).toContain("--border-shell: #d6e0eb");
    expect(indexCss).toContain("--border-header: #c9d5e3");
    expect(indexCss).toContain("--border-row: #e6ecf3");
  });

  it("gives table lines three distinct semantic boundaries", () => {
    expect(tableCss).toContain("var(--border-shell)");
    expect(tableCss).toContain("var(--border-header)");
    expect(tableCss).toContain("var(--border-row)");
  });

  it("defines restrained row hover, focus, and selected states", () => {
    expect(tableCss).toContain("var(--table-row-hover)");
    expect(tableCss).toContain("var(--table-row-focus)");
    expect(tableCss).toContain("var(--table-row-selected)");
    expect(tableCss).toContain("background-color 120ms ease");
    expect(tableCss).toContain("box-shadow 120ms ease");
  });

  it("owns desktop and direct-touch row-action geometry", () => {
    expect(tableCss).toMatch(
      /\[data-slot="row-actions"\][\s\S]*?width:\s*2\.25rem/,
    );
    expect(tableCss).toMatch(
      /@media \(pointer: coarse\)[\s\S]*?width:\s*2\.75rem/,
    );
  });
});
