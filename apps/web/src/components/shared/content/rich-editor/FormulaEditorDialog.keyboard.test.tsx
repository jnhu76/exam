import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  FormulaEditorDialog,
  formulaDialogKeyboardStyle,
} from "./FormulaEditorDialog";

/**
 * #882: MathLive's virtual keyboard is pinned to the viewport bottom and only
 * compensates document flow, so the dialog has to reserve that band itself.
 * The geometric contract is pinned here; the occlusion itself is proven at the
 * browser level (rich-editor-input-boundaries.spec.ts), where a real pointer
 * click on confirm must land while the keyboard is open.
 */

vi.mock("./MathFormulaField", () => ({
  // Minimal seam: the field owns the MathLive lifecycle and reports the band.
  MathFormulaField({
    onKeyboardInsetChange,
  }: {
    onKeyboardInsetChange?: (inset: number) => void;
  }) {
    return (
      <button
        type="button"
        data-testid="report-keyboard-inset"
        onClick={() => onKeyboardInsetChange?.(242)}
      />
    );
  },
}));

describe("formula dialog — virtual keyboard band (#882)", () => {
  it("reserves nothing while the keyboard is hidden", () => {
    expect(formulaDialogKeyboardStyle(0)).toBeUndefined();
    expect(formulaDialogKeyboardStyle(-5)).toBeUndefined();
  });

  it("re-centers in the area the keyboard leaves free, and caps the height", () => {
    expect(formulaDialogKeyboardStyle(242)).toEqual({
      top: "calc((100dvh - 242px) / 2)",
      maxHeight: "calc(100dvh - 242px - 2rem)",
    });
  });

  it("the dialog adopts the band the field reports", async () => {
    const user = userEvent.setup();
    render(
      <FormulaEditorDialog
        open
        onOpenChange={() => {}}
        target={null}
        blockAllowed
        onConfirm={() => {}}
      />,
    );
    const dialog = await screen.findByTestId("formula-dialog");
    expect(dialog.getAttribute("style") ?? "").not.toContain("100dvh");

    await user.click(screen.getByTestId("report-keyboard-inset"));

    // jsdom's CSSOM re-serializes calc() expressions, so this case pins the
    // WIRING (the reported band reached the dialog); the exact geometry is
    // pinned by the pure-function case above and proven against a real
    // pointer in rich-editor-input-boundaries.spec.ts.
    const style = dialog.getAttribute("style") ?? "";
    expect(style).toMatch(/top:\s*calc\(/);
    expect(style).toMatch(/max-height:\s*calc\(/);
    expect(style).toContain("100dvh");
    expect(style).toContain("242px");
  });
});
