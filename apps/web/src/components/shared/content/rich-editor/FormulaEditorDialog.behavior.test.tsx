import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FormulaEditorDialog } from "./FormulaEditorDialog";

/**
 * Dialog-level regressions for the no-op policy seam (review U-R1): the
 * persisted-mode clamp must not turn a zero-edit confirm of a 独立显示 atom
 * in a downgrade context into a silent inline conversion.
 */

vi.mock("./MathFormulaField", async () => {
  const { useState } = await import("react");
  // Faithful to the real field's mount contract: initialLatex applies ONCE
  // at mount; later prop changes never reach the mounted surface. A
  // passthrough stub would mask the arming defect this suite pins — it would
  // follow the corrected prop instead of freezing the first value, exactly
  // what MathLive does not do.
  function MathFormulaFieldStub({ initialLatex }: { initialLatex: string }) {
    const [mountedLatex] = useState(initialLatex);
    return (
      <div data-testid="math-field-stub" data-mounted-latex={mountedLatex} />
    );
  }
  return { MathFormulaField: MathFormulaFieldStub };
});

const BLOCK_TARGET = {
  latex: "\\sum_{i=1}^{n} i",
  display: true,
  pos: 3,
  nodeSize: 2,
};

function renderDialog(overrides: {
  blockAllowed?: boolean;
  target?: typeof BLOCK_TARGET | null;
  onConfirm?: (latex: string, display: boolean) => void;
}) {
  const onConfirm = overrides.onConfirm ?? vi.fn();
  render(
    <FormulaEditorDialog
      open
      onOpenChange={() => {}}
      target={overrides.target ?? BLOCK_TARGET}
      blockAllowed={overrides.blockAllowed ?? false}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm };
}

describe("formula dialog — blockMath atom in a downgrade context (U-R1)", () => {
  it("zero-edit confirm does NOT convert or report any edit", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({ blockAllowed: false });
    await screen.findByTestId("formula-dialog");
    await user.click(screen.getByTestId("formula-confirm"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("the radio reflects the atom's real mode (独立显示, disabled)", async () => {
    renderDialog({ blockAllowed: false });
    await screen.findByTestId("formula-dialog");
    const blockRadio = screen.getByRole("radio", { name: "独立显示" });
    expect(blockRadio).toBeChecked();
    expect(blockRadio).toBeDisabled();
  });

  it("a real user edit still applies, coerced to the persistable mode", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderDialog({ blockAllowed: false, onConfirm });
    await screen.findByTestId("formula-dialog");
    await user.click(screen.getByTestId("formula-expert-toggle"));
    const source = screen.getByTestId("formula-expert-source");
    await user.clear(source);
    await user.type(source, "x_1+x_2");
    await user.click(screen.getByTestId("formula-confirm"));
    expect(onConfirm).toHaveBeenCalledWith("x_1+x_2", false);
  });

  it("an inline atom in a downgrade context stays editable as 行内", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderDialog({
      blockAllowed: false,
      target: { latex: "x^2", display: false, pos: 5, nodeSize: 1 },
      onConfirm,
    });
    await screen.findByTestId("formula-dialog");
    const inlineRadio = screen.getByRole("radio", { name: "行内" });
    expect(inlineRadio).toBeChecked();
    // zero-edit confirm → no-op
    await user.click(screen.getByTestId("formula-confirm"));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("formula dialog — field arming at open (first re-edit of a persisted formula)", () => {
  const INLINE_TARGET = {
    latex: "x^2+y^2",
    display: false,
    pos: 7,
    nodeSize: 1,
  };

  function renderAt(open: boolean, target: typeof INLINE_TARGET | null) {
    return render(
      <FormulaEditorDialog
        open={open}
        onOpenChange={() => {}}
        target={target}
        blockAllowed
        onConfirm={() => {}}
      />,
    );
  }

  it("the first open after a fresh mount arms the field with the TARGET's latex", async () => {
    // Reload-equivalent: the dialog component exists before any formula
    // session (its draft state is still the useState default) and a persisted
    // atom is then clicked. The MathLive field applies initialLatex ONCE at
    // mount, so the re-armed value must be present in the SAME commit — an
    // effect-set re-arm lands one render late and the field opens empty.
    const { rerender } = renderAt(false, null);
    rerender(
      <FormulaEditorDialog
        open
        onOpenChange={() => {}}
        target={INLINE_TARGET}
        blockAllowed
        onConfirm={() => {}}
      />,
    );
    await screen.findByTestId("formula-dialog");
    expect(screen.getByTestId("math-field-stub")).toHaveAttribute(
      "data-mounted-latex",
      INLINE_TARGET.latex,
    );
  });

  it("each open arms from ITS atom — a previous session's draft never leaks", async () => {
    // The masked path of the same-session suite: re-opening the dialog on a
    // DIFFERENT atom while the dialog's own draft state still holds the
    // previous formula. The field must mount from the new target.
    const { rerender } = renderAt(false, null);
    rerender(
      <FormulaEditorDialog
        open
        onOpenChange={() => {}}
        target={INLINE_TARGET}
        blockAllowed
        onConfirm={() => {}}
      />,
    );
    await screen.findByTestId("formula-dialog");
    rerender(
      <FormulaEditorDialog
        open={false}
        onOpenChange={() => {}}
        target={INLINE_TARGET}
        blockAllowed
        onConfirm={() => {}}
      />,
    );
    rerender(
      <FormulaEditorDialog
        open
        onOpenChange={() => {}}
        target={BLOCK_TARGET}
        blockAllowed
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId("math-field-stub")).toHaveAttribute(
      "data-mounted-latex",
      BLOCK_TARGET.latex,
    );
  });
});
