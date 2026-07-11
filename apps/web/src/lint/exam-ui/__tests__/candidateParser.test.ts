import { describe, expect, it } from "vitest";
import { parseTailwindCandidate } from "../tailwindCandidate";

/**
 * Candidate-parser grammar tests (UI-TYPOGRAPHY-AUTHORITY-RECON-1 §6, §17A).
 *
 * These codify the exact Tailwind v4 syntax subset the repository parser owns,
 * AFTER the bracket-awareness defect in the old `stripVariants()` (which
 * corrupted colons inside `[...]`).
 */
describe("parseTailwindCandidate — named utilities", () => {
  it("parses a plain named utility", () => {
    const p = parseTailwindCandidate("text-sm");
    expect(p.ok).toBe(true);
    expect(p.utility).toBe("text-sm");
    expect(p.variants).toEqual([]);
    expect(p.target).toBe("self");
    expect(p.important).toBe(false);
    expect(p.negative).toBe(false);
    expect(p.arbitraryValue).toBeUndefined();
  });

  it("parses font-weight and font-family named utilities", () => {
    expect(parseTailwindCandidate("font-bold").utility).toBe("font-bold");
    expect(parseTailwindCandidate("font-mono").utility).toBe("font-mono");
  });

  it("parses multi-dash utilities (min-h-16, overflow-x-auto, tabular-nums)", () => {
    expect(parseTailwindCandidate("min-h-16").utility).toBe("min-h-16");
    expect(parseTailwindCandidate("overflow-x-auto").utility).toBe(
      "overflow-x-auto",
    );
    expect(parseTailwindCandidate("tabular-nums").utility).toBe("tabular-nums");
  });
});

describe("parseTailwindCandidate — arbitrary values", () => {
  it("parses text-[11px] (plain arbitrary value)", () => {
    const p = parseTailwindCandidate("text-[11px]");
    expect(p.ok).toBe(true);
    expect(p.utility).toBe("text");
    expect(p.arbitraryValue).toBe("11px");
    expect(p.dataTypeHint).toBeUndefined();
  });

  it("preserves the data-type hint colon INSIDE brackets (the old defect)", () => {
    const p = parseTailwindCandidate("text-[length:11px]");
    expect(p.ok).toBe(true);
    expect(p.utility).toBe("text");
    expect(p.dataTypeHint).toBe("length");
    expect(p.arbitraryValue).toBe("11px");
  });

  it("parses leading-[1.7] and tracking-[0.02em]", () => {
    expect(parseTailwindCandidate("leading-[1.7]").arbitraryValue).toBe("1.7");
    expect(parseTailwindCandidate("tracking-[0.02em]").arbitraryValue).toBe(
      "0.02em",
    );
  });

  it("parses a var() inside brackets without treating its colon as a variant", () => {
    const p = parseTailwindCandidate("text-[color:var(--brand)]");
    expect(p.ok).toBe(true);
    expect(p.dataTypeHint).toBe("color");
    expect(p.arbitraryValue).toBe("var(--brand)");
  });

  it("parses font-[450] and font-[family-name:Inter]", () => {
    expect(parseTailwindCandidate("font-[450]").arbitraryValue).toBe("450");
    const fam = parseTailwindCandidate("font-[family-name:Inter]");
    expect(fam.dataTypeHint).toBe("family-name");
    expect(fam.arbitraryValue).toBe("Inter");
  });

  it("parses a calc() arbitrary value", () => {
    const p = parseTailwindCandidate("text-[calc(1rem+2px)]");
    expect(p.ok).toBe(true);
    expect(p.arbitraryValue).toBe("calc(1rem+2px)");
  });
});

describe("parseTailwindCandidate — arbitrary properties", () => {
  it("parses [font-size:11px] as an arbitrary property", () => {
    const p = parseTailwindCandidate("[font-size:11px]");
    expect(p.ok).toBe(true);
    expect(p.utility).toBe("");
    expect(p.arbitraryProperty).toEqual({
      property: "font-size",
      value: "11px",
    });
  });

  it("parses [color:red] as an arbitrary property (color, not typography)", () => {
    const p = parseTailwindCandidate("[color:red]");
    expect(p.arbitraryProperty).toEqual({ property: "color", value: "red" });
  });

  it("parses the font shorthand [font:500_12px/1_sans-serif]", () => {
    const p = parseTailwindCandidate("[font:500_12px/1_sans-serif]");
    expect(p.arbitraryProperty?.property).toBe("font");
  });
});

describe("parseTailwindCandidate — slash line-height modifier", () => {
  it("parses text-sm/[17px] (named size + arbitrary modifier)", () => {
    const p = parseTailwindCandidate("text-sm/[17px]");
    expect(p.ok).toBe(true);
    expect(p.utility).toBe("text-sm");
    expect(p.modifier).toBe("[17px]");
  });

  it("parses text-[11px]/[13px] (arbitrary value + arbitrary modifier)", () => {
    const p = parseTailwindCandidate("text-[11px]/[13px]");
    expect(p.utility).toBe("text");
    expect(p.arbitraryValue).toBe("11px");
    expect(p.modifier).toBe("[13px]");
  });

  it("does NOT treat a slash inside brackets as a modifier", () => {
    const p = parseTailwindCandidate("[font:500_12px/1_sans-serif]");
    expect(p.modifier).toBeUndefined();
  });
});

describe("parseTailwindCandidate — variants", () => {
  it("strips a single responsive variant", () => {
    const p = parseTailwindCandidate("md:text-[11px]");
    expect(p.variants).toEqual(["md"]);
    expect(p.utility).toBe("text");
    expect(p.arbitraryValue).toBe("11px");
    expect(p.target).toBe("self");
  });

  it("strips a state variant", () => {
    const p = parseTailwindCandidate("hover:leading-[1.7]");
    expect(p.variants).toEqual(["hover"]);
    expect(p.target).toBe("self");
  });

  it("strips stacked variants", () => {
    const p = parseTailwindCandidate("group-hover:tracking-[0.02em]");
    expect(p.variants).toEqual(["group-hover"]);
    expect(p.target).toBe("self");
  });

  it("strips multiple stacked variants", () => {
    const p = parseTailwindCandidate("md:hover:text-[11px]");
    expect(p.variants).toEqual(["md", "hover"]);
  });

  it("parses a data-attribute variant", () => {
    const p = parseTailwindCandidate("data-[state=open]:text-[11px]");
    expect(p.variants).toEqual(["data-[state=open]"]);
    expect(p.target).toBe("self");
  });

  it("parses a supports variant", () => {
    const p = parseTailwindCandidate("supports-[display:grid]:leading-[1.7]");
    expect(p.variants).toEqual(["supports-[display:grid]"]);
    expect(p.target).toBe("self");
  });

  it("classifies an arbitrary DESCENDANT variant as target=descendant", () => {
    const p = parseTailwindCandidate("[&>span]:text-lg");
    // The variant keeps its brackets; the target classifier inspects the inner
    // selector to decide descendant vs self.
    expect(p.variants).toEqual(["[&>span]"]);
    expect(p.target).toBe("descendant");
    expect(p.utility).toBe("text-lg");
  });

  it("classifies a nested-descendant arbitrary variant as target=descendant", () => {
    const p = parseTailwindCandidate("[&_p]:text-lg");
    expect(p.target).toBe("descendant");
  });

  it("classifies pseudo-element variants as target=pseudo-element", () => {
    expect(parseTailwindCandidate("before:text-xs").target).toBe(
      "pseudo-element",
    );
    expect(parseTailwindCandidate("after:font-bold").target).toBe(
      "pseudo-element",
    );
    expect(parseTailwindCandidate("placeholder:text-sm").target).toBe(
      "pseudo-element",
    );
    expect(parseTailwindCandidate("marker:text-xs").target).toBe(
      "pseudo-element",
    );
    expect(parseTailwindCandidate("first-letter:text-lg").target).toBe(
      "pseudo-element",
    );
    expect(parseTailwindCandidate("selection:text-sm").target).toBe(
      "pseudo-element",
    );
  });

  it("keeps aria-invalid: as target=self", () => {
    expect(parseTailwindCandidate("aria-invalid:text-red-500").target).toBe(
      "self",
    );
  });
});

describe("parseTailwindCandidate — important + negative", () => {
  it("parses the trailing important modifier", () => {
    const p = parseTailwindCandidate("text-[11px]!");
    expect(p.ok).toBe(true);
    expect(p.important).toBe(true);
    expect(p.utility).toBe("text");
    expect(p.arbitraryValue).toBe("11px");
  });

  it("parses important under a variant", () => {
    const p = parseTailwindCandidate("md:text-[11px]!");
    expect(p.important).toBe(true);
    expect(p.variants).toEqual(["md"]);
  });

  it("parses a negative utility", () => {
    const p = parseTailwindCandidate("-tracking-[0.02em]");
    expect(p.ok).toBe(true);
    expect(p.negative).toBe(true);
    expect(p.utility).toBe("tracking");
    expect(p.arbitraryValue).toBe("0.02em");
  });
});

describe("parseTailwindCandidate — robustness", () => {
  it("returns ok:false for unbalanced brackets", () => {
    expect(parseTailwindCandidate("text-[11px").ok).toBe(false);
    expect(parseTailwindCandidate("text-[11px]]").ok).toBe(false);
  });

  it("returns ok:false for an unbalanced parenthesis inside brackets", () => {
    expect(parseTailwindCandidate("text-[calc(1rem]").ok).toBe(false);
  });

  it("returns ok:false for the empty string", () => {
    expect(parseTailwindCandidate("").ok).toBe(false);
  });

  it("handles an escaped colon without treating it as a variant", () => {
    // `foo\:bar` is one escaped token in Tailwind class escaping; the parser
    // must skip the escaped colon.
    const p = parseTailwindCandidate("foo\\:text-sm");
    // The escaped colon is not structural, so no variant is peeled.
    expect(p.ok).toBe(true);
    expect(p.variants).toEqual([]);
  });
});
