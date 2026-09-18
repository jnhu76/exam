import { render } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox";
import { Switch } from "./switch";

/**
 * Primitive-layer contracts from the issue 577 corrective:
 *
 * E — checkbox.tsx / switch.tsx carried corrupted class tokens
 *     (`…text-primary-foreground=checked]:bg-primary`): whole tokens that
 *     generate NO CSS, silently dropping the checked text color and the
 *     unchecked switch surface. These tests pin the repaired state selectors
 *     (checked / unchecked / disabled / focus-visible) and forbid the
 *     unparseable-fragment shape from returning.
 *
 * D — dead declarations defeated by unlayered recipes (Input/SelectTrigger
 *     rounded-lg, Textarea rounded-md, TableHead/TableCell text-sm,
 *     StatusBadge h-6) were removed; a lower-authority declaration that an
 *     unlayered recipe provably defeats must not come back — it lies about
 *     its own output.
 *
 * J — disabled-state ownership: exactly two sanctioned control-family
 *     patterns (explicit semantic colors, or disabled:opacity-50). A third
 *     pattern is a governance failure, not a style choice.
 *
 * K5 — components/ui stays color-safe (semantic tokens only, no raw
 *     palettes/hex), keeping the gate exemption honest for color.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(HERE, "..", "..");

function readUi(name: string): string {
  return readFileSync(join(HERE, name), "utf8");
}

/**
 * The corrupted-fragment shape (issue 577 m4) was a class token containing `]`
 * with no opening `[` — e.g. `…text-primary-foreground=checked]:bg-primary`:
 * one unparseable token that generates NO CSS. A legit Tailwind arbitrary
 * variant always balances its brackets within the token.
 */
function unbalancedBracketTokens(className: string): string[] {
  return className
    .split(/\s+/)
    .filter((t) => t.includes("]") && !t.includes("["));
}

describe("Checkbox / Switch repaired state selectors (E)", () => {
  it("checkbox carries the checked text-color selector as a parseable token", () => {
    const src = readUi("checkbox.tsx");
    expect(src).toContain("data-[state=checked]:text-primary-foreground");
    expect(src).toContain("data-[state=checked]:bg-primary");
  });

  it("switch carries the unchecked surface + thumb reset as parseable tokens", () => {
    const src = readUi("switch.tsx");
    expect(src).toContain("data-[state=unchecked]:bg-input");
    expect(src).toContain("data-[state=unchecked]:translate-x-0");
  });

  it("checkbox renders checked / unchecked / disabled state semantics", () => {
    const checked = render(<Checkbox checked data-testid="c1" />);
    const el1 = checked.getByTestId("c1");
    expect(el1.getAttribute("data-state")).toBe("checked");
    expect(el1.className).toContain("data-[state=checked]:bg-primary");
    expect(unbalancedBracketTokens(el1.className)).toEqual([]);

    const unchecked = render(<Checkbox data-testid="c2" />);
    const el2 = unchecked.getByTestId("c2");
    expect(el2.getAttribute("data-state")).toBe("unchecked");
    expect(unbalancedBracketTokens(el2.className)).toEqual([]);

    const disabled = render(<Checkbox disabled data-testid="c3" />);
    expect(disabled.getByTestId("c3")).toBeDisabled();
    expect(disabled.getByTestId("c3").className).toContain(
      "disabled:opacity-50",
    );
  });

  it("checkbox and switch keep focus-visible ring selectors", () => {
    expect(readUi("checkbox.tsx")).toContain("focus-visible:ring-[3px]");
    expect(readUi("switch.tsx")).toContain("focus-visible:ring-[3px]");
  });

  it("switch renders checked / unchecked / disabled state semantics", () => {
    const on = render(<Switch checked data-testid="s1" />);
    expect(on.getByTestId("s1").getAttribute("data-state")).toBe("checked");
    const off = render(<Switch data-testid="s2" />);
    expect(off.getByTestId("s2").getAttribute("data-state")).toBe("unchecked");
    const disabled = render(<Switch disabled data-testid="s3" />);
    expect(disabled.getByTestId("s3")).toBeDisabled();
  });

  it("every rendered class token keeps balanced brackets (no corrupt fragments)", () => {
    const box = render(<Checkbox checked data-testid="cb" />);
    expect(unbalancedBracketTokens(box.getByTestId("cb").className)).toEqual(
      [],
    );
    const sw = render(<Switch checked data-testid="sw" />);
    const root = sw.getByTestId("sw");
    expect(unbalancedBracketTokens(root.className)).toEqual([]);
    const thumb = root.querySelector('[data-slot="switch-thumb"]')!;
    expect(unbalancedBracketTokens(thumb.className)).toEqual([]);
  });
});

describe("defeated declarations stay removed (D, K4)", () => {
  it("Input and SelectTrigger no longer declare a recipe-owned radius", () => {
    const input = readUi("input.tsx");
    const select = readUi("select.tsx");
    expect(input).not.toMatch(/rounded-(lg|md|sm)/);
    // SelectContent consumes surface-overlay; the trigger keeps no radius.
    expect(select).not.toContain("rounded-lg border border-input");
  });

  it("Textarea no longer declares the recipe-owned radius", () => {
    expect(readUi("textarea.tsx")).not.toMatch(/rounded-(md|lg)/);
  });

  it("TableHead / TableCell no longer declare the recipe-owned font size", () => {
    const table = readUi("table.tsx");
    expect(table).not.toContain("align-middle text-sm font-medium");
    expect(table).not.toContain("align-middle text-sm [&:has");
    // TableCaption keeps its own (recipe does not govern it).
    expect(table).toContain("mt-4 text-sm text-muted-foreground");
  });

  it("StatusBadge no longer declares the recipe-owned height", () => {
    const src = readFileSync(
      join(WEB_SRC, "components", "shared", "StatusBadge.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/\bh-6\b/);
    expect(src).toContain('data-slot="status-badge"');
  });
});

describe("disabled-state ownership stays a two-pattern family (J)", () => {
  const CONTROL_FILES = [
    "button.tsx",
    "input.tsx",
    "select.tsx",
    "textarea.tsx",
    "checkbox.tsx",
    "switch.tsx",
  ];

  /** Allowed disabled:* utilities — the two sanctioned patterns (explicit
   * semantic colors incl. Button's variant-level explicit tokens, or
   * opacity-50 plus its interaction companions). */
  const ALLOWED_DISABLED = new Set([
    "disabled:cursor-not-allowed",
    "disabled:bg-muted",
    "disabled:text-muted-foreground",
    "disabled:opacity-50",
    "disabled:pointer-events-none",
    // Button variant-level explicit colors (ghost/link keep their surface):
    "disabled:border-border",
    "disabled:bg-transparent",
  ]);

  it("every disabled:* utility in the control family is a sanctioned token", () => {
    const offenders: string[] = [];
    for (const f of CONTROL_FILES) {
      const src = readUi(f);
      for (const m of src.matchAll(/disabled:[a-z0-9/[.\]()-]+/g)) {
        if (!ALLOWED_DISABLED.has(m[0]!)) offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the two patterns remain explicitly documented (docs own the policy)", () => {
    const uiSystem = readFileSync(
      join(WEB_SRC, "..", "..", "..", "docs", "standards", "ui-system.md"),
      "utf8",
    );
    expect(uiSystem).toContain("VISUAL-DECISION-DISABLED-STATE");
  });
});

describe("components/ui stays color-safe (K5)", () => {
  const PALETTE =
    /(?:text|bg|border|ring|fill|stroke|from|to|via|outline|shadow|decoration)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?\b/;

  it("no raw Tailwind palette utility, no hex literal in ui primitives", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(HERE)) {
      if (!f.endsWith(".tsx") || f.includes(".test.")) continue;
      const src = readFileSync(join(HERE, f), "utf8");
      src.split("\n").forEach((line, i) => {
        if (PALETTE.test(line))
          offenders.push(`${f}:${i + 1}: raw palette — ${line.trim().slice(0, 60)}`);
        const hex = /#[0-9a-fA-F]{3,8}\b/.exec(line);
        if (hex) offenders.push(`${f}:${i + 1}: hex literal — ${hex[0]}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
