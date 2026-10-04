import { describe, expect, it } from "vitest";
import { shouldApplyFormulaEdit } from "./FormulaEditorDialog";

/**
 * The formula no-op policy (contract §5.2, #679): viewing a formula must
 * never mutate it. MathLive normalizes latex on import, so the draft value
 * alone proves nothing — the userEdited gate plus the source comparison do.
 */
describe("formula no-op policy", () => {
  const target = { latex: "\\frac{1}{2}", display: false, pos: 3, nodeSize: 1 };

  it("insert: blank confirm is a no-op", () => {
    expect(shouldApplyFormulaEdit(null, "", false, false)).toBe(false);
    expect(shouldApplyFormulaEdit(null, "   ", true, false)).toBe(false);
  });

  it("insert: any non-blank latex applies", () => {
    expect(shouldApplyFormulaEdit(null, "x^2", true, false)).toBe(true);
  });

  it("re-edit: open + confirm WITHOUT edits never applies (import normalization is invisible)", () => {
    // MathLive may hand back a normalized rendering of the same source; the
    // userEdited gate is what keeps viewing inert.
    expect(shouldApplyFormulaEdit(target, "\\dfrac{1}{2}", false, false)).toBe(
      false,
    );
  });

  it("re-edit: user edit that reverts to the exact source is a no-op", () => {
    expect(shouldApplyFormulaEdit(target, target.latex, true, false)).toBe(
      false,
    );
  });

  it("re-edit: user edit with a different source applies", () => {
    expect(shouldApplyFormulaEdit(target, "x_1 + x_2", true, false)).toBe(true);
  });

  it("mode flip alone is a semantic edit even with unchanged latex", () => {
    expect(shouldApplyFormulaEdit(target, target.latex, false, true)).toBe(
      true,
    );
  });

  it("mode flip back to the original mode is a no-op", () => {
    expect(shouldApplyFormulaEdit(target, target.latex, false, false)).toBe(
      false,
    );
  });
});
