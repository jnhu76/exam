import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  listAuthorStylesheets,
  parseCssRules,
  unlayeredUniversalBorderRules,
} from "./test/cssRules";

/**
 * Default-border cascade authority (issue 577 review-fix-1 BLOCKER-1 gate).
 *
 * Failure class: `* { border-color: … }` compiled UNLAYERED sits after
 * @layer utilities in the cascade and therefore defeats EVERY layered
 * border-color utility app-wide — border-primary, border-destructive,
 * aria-invalid:border-destructive, data-[state=checked]:border-primary and
 * slash-opacity border tones all silently rendered grey while their
 * declarations existed. Same authority-defeat class as the B1 stroke rule.
 *
 * jsdom cannot evaluate native @layer, so the permanent gate is structural:
 * the default border rule must exist, must live inside @layer base, and NO
 * author stylesheet may carry an unlayered universal border-color rule.
 * Runtime behavior (neutral / checked / aria-invalid / focus-visible
 * computed borders) is proven by browser computed-style probes recorded in
 * the PR evidence.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = HERE; // this gate lives directly in apps/web/src
const FILES = listAuthorStylesheets(SRC_ROOT);
const RULES = FILES.flatMap((f) =>
  parseCssRules(relative(SRC_ROOT, f), readFileSync(f, "utf8")),
);

describe("default border rule stays in @layer base (issue 577 BLOCKER-1)", () => {
  it("a universal default border rule exists exactly once, inside @layer base", () => {
    const universalBorder = RULES.filter(
      (r) =>
        r.selectors.length === 1 &&
        r.selectors[0] === "*" &&
        /@apply[^;{}]*border-border|border-color\s*:/.test(r.body),
    );
    expect(universalBorder).toHaveLength(1);
    expect(
      universalBorder[0]!.atRules.map((a) => a.replace(/\s*\{$/, "")),
    ).toContain("@layer base");
    expect(universalBorder[0]!.file).toBe("index.css");
  });

  it("no author stylesheet carries an unlayered universal border-color rule", () => {
    expect(unlayeredUniversalBorderRules(RULES)).toEqual([]);
  });

  it("the scan covers the whole main.tsx CSS import closure", () => {
    const mainTs = readFileSync(join(SRC_ROOT, "main.tsx"), "utf8");
    const closure = [...mainTs.matchAll(/"(\.\/[^"]+\.css)"/g)].map((m) =>
      join(SRC_ROOT, m[1]!),
    );
    expect(closure.length).toBeGreaterThan(0);
    for (const file of closure) {
      expect(
        FILES.includes(file),
        `imported stylesheet not scanned: ${file}`,
      ).toBe(true);
    }
  });

  it("reds when the default border rule is moved out of @layer base (mutation)", () => {
    const indexPath = join(SRC_ROOT, "index.css");
    const css = readFileSync(indexPath, "utf8");
    const mutated = css.replace(
      /@layer base \{\s*\*\s*\{\s*@apply border-border;\s*\}\s*\}/,
      "* {\n  @apply border-border;\n}",
    );
    expect(mutated).not.toBe(css);
    const violations = unlayeredUniversalBorderRules(
      parseCssRules("index.css", mutated),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.selectors).toEqual(["*"]);
  });

  it("the control recipe releases border-color so state utilities stay live", () => {
    // review-fix-1: the unlayered control recipe used to declare
    // border-color on the bare control slots, which defeated
    // aria-invalid:border-destructive and focus-visible:border-ring for
    // every input/select/textarea (same authority-defeat class). The
    // primitives' border-input utility owns the resting color; deeper
    // scoped tiers (quiet toolbar) may still own theirs deliberately.
    const controlCss = readFileSync(
      join(SRC_ROOT, "control", "recipes.css"),
      "utf8",
    );
    const bareSlot = /^\[data-slot="(?:input|select-trigger|textarea)"\]$/;
    for (const rule of parseCssRules("control/recipes.css", controlCss)) {
      if (!rule.selectors.some((s) => bareSlot.test(s))) continue;
      expect(
        rule.body,
        `bare control-slot recipe must not declare border-color: ${rule.selectors.join(",")}`,
      ).not.toMatch(/border-color\s*:/);
    }
  });

  it("reds when the control recipe re-takes border-color (mutation)", () => {
    const controlCss = readFileSync(
      join(SRC_ROOT, "control", "recipes.css"),
      "utf8",
    );
    const mutated = controlCss.replace(
      '[data-slot="input"],\n[data-slot="select-trigger"],\n[data-slot="textarea"] {',
      '[data-slot="input"],\n[data-slot="select-trigger"],\n[data-slot="textarea"] {\n  border-color: var(--border-control);',
    );
    expect(mutated).not.toBe(controlCss);
    const offending = parseCssRules("control/recipes.css", mutated).filter(
      (r) =>
        r.selectors.includes('[data-slot="input"]') &&
        /border-color\s*:/.test(r.body),
    );
    expect(offending).toHaveLength(1);
  });
});
