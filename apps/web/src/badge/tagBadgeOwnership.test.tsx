import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TagBadge } from "@/components/shared/TagBadge";

/**
 * TagBadge single-ownership model (issue 577 m2 / Corrective I).
 *
 * Before: the tag chip's geometry was assembled from Badge defaults + a
 * component `font-normal` override + a global [data-slot=tag-badge] recipe +
 * a SECOND conflicting block in table/workbench.css that won by specificity
 * inside the Question Management tag columns. After: one recipe file owns
 * both variants; the component declares the variant explicitly; the
 * workbench.css override is gone. The weight was adjudicated as 500 by the
 * frozen issue 582 visual decisions (D6) — both variants pinned together.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(HERE, "..");
const BADGE_RECIPES = readFileSync(join(HERE, "recipes.css"), "utf8");
const WORKBENCH_CSS = readFileSync(
  join(WEB_SRC, "table", "workbench.css"),
  "utf8",
);

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

describe("TagBadge variant ownership is explicit and singular (R5)", () => {
  it("badge/recipes.css owns the base contract including weight 500", () => {
    const rule = extractRule(BADGE_RECIPES, '[data-slot="tag-badge"]');
    expect(rule).toContain("height: 1.375rem");
    expect(rule).toContain("border-radius: 0.25rem");
    expect(rule).toContain("font-size: 0.75rem");
    expect(rule).toContain("font-weight: 500");
    expect(rule).toContain("line-height: 1rem");
  });

  it("compact-table variant lives in the SAME owner file with workbench values", () => {
    const rule = extractRule(
      BADGE_RECIPES,
      '[data-slot="tag-badge"][data-tag-variant="compact-table"]',
    );
    expect(rule).toContain("border-radius: 0.1875rem");
    expect(rule).toContain("line-height: 1.125rem");
    expect(rule).toContain("color: var(--text-muted)");
    expect(rule).toContain("font-weight: 500");
  });

  it("workbench.css no longer carries a second tag-badge authority", () => {
    expect(WORKBENCH_CSS).not.toContain('[data-slot="tag-badge"]');
    expect(WORKBENCH_CSS).not.toMatch(/tag-badge/);
  });

  it("the component declares the variant instead of a weight utility", () => {
    const source = readFileSync(
      join(WEB_SRC, "components", "shared", "TagBadge.tsx"),
      "utf8",
    );
    expect(source).toContain("data-tag-variant={variant}");
    expect(source).not.toMatch(/font-normal|font-medium/);
  });

  it("renders the default variant attribute", () => {
    const { container } = render(<TagBadge>数学</TagBadge>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("data-slot")).toBe("tag-badge");
    expect(el.getAttribute("data-tag-variant")).toBe("default");
    expect(el.className).not.toContain("font-normal");
  });

  it("renders the compact-table variant attribute", () => {
    const { container } = render(
      <TagBadge variant="compact-table">数学</TagBadge>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("data-tag-variant")).toBe("compact-table");
  });

  it("the Question Management tag column consumes compact-table explicitly", () => {
    const source = readFileSync(
      join(WEB_SRC, "pages", "admin", "QuestionPage.tsx"),
      "utf8",
    );
    expect(source).toContain('variant="compact-table"');
    // No variant-less TagBadge may remain in the tag-list cell.
    expect(source).not.toMatch(/<TagBadge key=\{tag\}>/);
  });

  it("reds when the second authority returns (in-memory mutation)", () => {
    const mutated = `${BADGE_RECIPES}\n[data-slot="data-workbench"] [data-slot="tag-badge"] { border-radius: 0.1875rem; }`;
    expect(mutated.match(/tag-badge/g)?.length).toBeGreaterThan(
      BADGE_RECIPES.match(/tag-badge/g)?.length ?? 0,
    );
    // The structural guard: workbench.css must stay free of tag-badge rules.
    const mutatedWorkbench = `${WORKBENCH_CSS}\n[data-slot="data-workbench"] [data-slot="tag-badge"] { color: red; }`;
    expect(mutatedWorkbench).toMatch(
      /\[data-slot="data-workbench"\].*\[data-slot="tag-badge"\]/,
    );
    expect(WORKBENCH_CSS).not.toMatch(
      /\[data-slot="data-workbench"\].*\[data-slot="tag-badge"\]/,
    );
  });
});
