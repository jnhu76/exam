import { describe, expect, it } from "vitest";
import {
  propertiesTouchedBy,
  propertiesTouchedByInlineKey,
  classifyArbitraryValue,
  NO_ARBITRARY_TYPOGRAPHY_POLICY_CATEGORIES,
} from "../cssPropertyResolver";
import { parseTailwindCandidate } from "../tailwindCandidate";

/** Helper: parse then resolve. */
function props(token: string) {
  return propertiesTouchedBy(parseTailwindCandidate(token));
}

/** Helper: classify an arbitrary value (as if inside text-[…]). */
function classify(value: string, hint?: string) {
  return classifyArbitraryValue(value, hint);
}

describe("propertiesTouchedBy — named utilities (bundle model)", () => {
  it("text-{size} touches BOTH font-size AND line-height (the critical model fix)", () => {
    for (const t of [
      "text-xs",
      "text-sm",
      "text-base",
      "text-lg",
      "text-3xl",
      "text-9xl",
    ]) {
      const p = props(t);
      expect(p.has("font-size"), `${t} must touch font-size`).toBe(true);
      expect(p.has("line-height"), `${t} must touch line-height`).toBe(true);
    }
  });

  it("leading-* touches only line-height", () => {
    expect(props("leading-none")).toEqual(new Set(["line-height"]));
    expect(props("leading-tight")).toEqual(new Set(["line-height"]));
  });

  it("tracking-* touches only letter-spacing", () => {
    expect(props("tracking-tight")).toEqual(new Set(["letter-spacing"]));
  });

  it("font-{weight} touches only font-weight; font-{family} only font-family", () => {
    expect(props("font-bold")).toEqual(new Set(["font-weight"]));
    expect(props("font-medium")).toEqual(new Set(["font-weight"]));
    expect(props("font-mono")).toEqual(new Set(["font-family"]));
    expect(props("font-sans")).toEqual(new Set(["font-family"]));
  });

  it("tabular-nums touches font-variant-numeric", () => {
    expect(props("tabular-nums")).toEqual(new Set(["font-variant-numeric"]));
  });

  it("named text-COLOR utilities touch color", () => {
    expect(props("text-red-500").has("color")).toBe(true);
    expect(props("text-muted-foreground").has("color")).toBe(true);
    expect(props("text-destructive/30").has("color")).toBe(true);
  });

  it("text-align/decoration/transform touch NOTHING (not owned)", () => {
    expect(props("text-center").size).toBe(0);
    expect(props("text-underline").size).toBe(0);
    expect(props("text-uppercase").size).toBe(0);
  });

  it("structural utilities touch NOTHING", () => {
    expect(props("mt-4").size).toBe(0);
    expect(props("flex").size).toBe(0);
    expect(props("rounded-md").size).toBe(0);
    expect(props("p-3").size).toBe(0);
  });

  it("whitespace-*, truncate, overflow-x-*, min-h-* touch their owned properties", () => {
    expect(props("whitespace-pre-wrap")).toEqual(new Set(["white-space"]));
    expect(props("truncate")).toEqual(new Set(["white-space", "overflow-x"]));
    expect(props("overflow-x-auto")).toEqual(new Set(["overflow-x"]));
    expect(props("min-h-16")).toEqual(new Set(["min-height"]));
  });
});

describe("propertiesTouchedBy — arbitrary values", () => {
  it("text-[11px] touches font-size", () => {
    expect(props("text-[11px]")).toEqual(new Set(["font-size"]));
  });

  it("text-[length:11px] touches font-size (data-type hint preserved)", () => {
    expect(props("text-[length:11px]")).toEqual(new Set(["font-size"]));
  });

  it("text-[color:var(--x)] touches color, NOT font-size (the color boundary)", () => {
    expect(props("text-[color:var(--x)]")).toEqual(new Set(["color"]));
  });

  it("text-[#fff] touches color", () => {
    expect(props("text-[#fff]")).toEqual(new Set(["color"]));
  });

  it("text-[var(--x)] touches NOTHING resolvable (unknown)", () => {
    expect(props("text-[var(--x)]").size).toBe(0);
  });

  it("font-[450] touches font-weight; font-[family-name:Inter] touches font-family", () => {
    expect(props("font-[450]")).toEqual(new Set(["font-weight"]));
    expect(props("font-[family-name:Inter]")).toEqual(new Set(["font-family"]));
  });

  it("[font-size:11px] arbitrary property touches font-size", () => {
    expect(props("[font-size:11px]")).toEqual(new Set(["font-size"]));
  });

  it("[font:500_12px/1_sans-serif] shorthand expands to family/size/line-height/weight", () => {
    const p = props("[font:500_12px/1_sans-serif]");
    expect(p.has("font-family")).toBe(true);
    expect(p.has("font-size")).toBe(true);
    expect(p.has("line-height")).toBe(true);
    expect(p.has("font-weight")).toBe(true);
  });

  it("[color:red] arbitrary property touches color", () => {
    expect(props("[color:red]")).toEqual(new Set(["color"]));
  });

  it("a descendant-target variant touches nothing on the ROOT element", () => {
    // [&>span]:text-lg targets a child, so it must NOT register against the
    // recipe-owning root. (target=descendant → propertiesTouchedBy still returns
    // the bundle, but the conflict rule uses candidate.target to skip it.)
    const p = parseTailwindCandidate("[&>span]:text-lg");
    expect(p.target).toBe("descendant");
  });
});

describe("propertiesTouchedByInlineKey", () => {
  it("maps camelCase inline-style keys to owned properties", () => {
    expect(propertiesTouchedByInlineKey("fontSize")).toEqual(
      new Set(["font-size"]),
    );
    expect(propertiesTouchedByInlineKey("lineHeight")).toEqual(
      new Set(["line-height"]),
    );
    expect(propertiesTouchedByInlineKey("letterSpacing")).toEqual(
      new Set(["letter-spacing"]),
    );
    expect(propertiesTouchedByInlineKey("fontWeight")).toEqual(
      new Set(["font-weight"]),
    );
    expect(propertiesTouchedByInlineKey("fontFamily")).toEqual(
      new Set(["font-family"]),
    );
    expect(propertiesTouchedByInlineKey("color")).toEqual(new Set(["color"]));
    expect(propertiesTouchedByInlineKey("whiteSpace")).toEqual(
      new Set(["white-space"]),
    );
    expect(propertiesTouchedByInlineKey("minHeight")).toEqual(
      new Set(["min-height"]),
    );
  });

  it("the `font` shorthand expands to its sub-properties", () => {
    const p = propertiesTouchedByInlineKey("font");
    expect(p.has("font-family")).toBe(true);
    expect(p.has("font-size")).toBe(true);
    expect(p.has("line-height")).toBe(true);
    expect(p.has("font-weight")).toBe(true);
  });

  it("returns empty for non-typology keys (display, margin, …)", () => {
    expect(propertiesTouchedByInlineKey("display").size).toBe(0);
    expect(propertiesTouchedByInlineKey("marginTop").size).toBe(0);
  });
});

describe("classifyArbitraryValue", () => {
  it("length hint → typography/font-size", () => {
    expect(classify("11px", "length").kind).toBe("typography");
  });

  it("color hint → color", () => {
    expect(classify("var(--x)", "color").kind).toBe("color");
  });

  it("hex literal → color", () => {
    expect(classify("#fff").kind).toBe("color");
    expect(classify("#123456").kind).toBe("color");
  });

  it("rgb()/hsl()/oklch() → color", () => {
    expect(classify("rgb(0 0 0)").kind).toBe("color");
    expect(classify("hsl(0 0% 0%)").kind).toBe("color");
  });

  it("length-shaped value without hint → typography/font-size", () => {
    expect(classify("11px").kind).toBe("typography");
    expect(classify("1.7rem").kind).toBe("typography");
  });

  it("var(--x) without hint → unknown/requires-type-hint", () => {
    const c = classify("var(--brand)");
    expect(c.kind).toBe("unknown");
  });

  it("calc(...) without hint → unknown/requires-type-hint", () => {
    expect(classify("calc(1rem + 2px)").kind).toBe("unknown");
  });

  it("bare number without hint → unknown (no guessing)", () => {
    expect(classify("11").kind).toBe("unknown");
  });
});

describe("NO_ARBITRARY_TYPOGRAPHY_POLICY_CATEGORIES", () => {
  it("contains exactly the five typography categories and excludes color", () => {
    expect([...NO_ARBITRARY_TYPOGRAPHY_POLICY_CATEGORIES].sort()).toEqual([
      "font-family",
      "font-size",
      "font-weight",
      "letter-spacing",
      "line-height",
    ]);
    expect(NO_ARBITRARY_TYPOGRAPHY_POLICY_CATEGORIES.has("color")).toBe(false);
  });
});
