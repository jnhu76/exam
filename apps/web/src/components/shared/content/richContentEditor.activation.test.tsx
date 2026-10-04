import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import type { ContentDocumentV1 } from "@exam/domain";
import { contentDocumentToTiptap } from "./contentAdapter";
import RichContentEditor, { richEditorExtensions } from "./RichContentEditor";
import type { FormulaActivation } from "./rich-editor/editorExtensions";

/**
 * Open-time target-context wiring for the formula surface (review
 * MATH_CONTEXT_REEDIT_OPEN): a re-edit activation must judge 独立显示
 * availability by the ATOM's ancestry (activation.pos), not the caret —
 * the Mathematics click path delivers the payload WITHOUT moving the
 * selection onto the atom, so the caret can sit in a different context
 * when the activation lands. The keyboard Enter path cannot reproduce the
 * disagreement (its guard requires a NodeSelection ON the atom, which pins
 * the caret to the target), so the test fires the component's activation
 * seam with the exact click payload (toActivation shape) while the caret —
 * placed through real editor commands — sits elsewhere. The confirm-time
 * twin (target.pos ancestry inside applyFormulaEdit) is owned by
 * richContentEditor.reality.test.ts.
 */

// MathLive is a custom element jsdom cannot mount; the mount-frozen stub
// preserves the field contract the dialog depends on (same tap as the
// behavior suite).
vi.mock("./rich-editor/MathFormulaField", async () => {
  const { useState } = await import("react");
  function MathFormulaFieldStub({ initialLatex }: { initialLatex: string }) {
    const [mountedLatex] = useState(initialLatex);
    return (
      <div data-testid="math-field-stub" data-mounted-latex={mountedLatex} />
    );
  }
  return { MathFormulaField: MathFormulaFieldStub };
});

// Passive taps on the component's wiring seams: the toolbar receives the
// live editor as a prop (jsdom has no layout, so clicks/arrow keys cannot
// place a ProseMirror selection — the tap lets the test place the caret
// through real editor commands), and createFormulaActivateExtension is a
// passthrough that also exposes the component's onFormulaActivate sink.
// Everything under test (useEditor, extensions, activation sink, dialog)
// stays real.
const tap = vi.hoisted(() => ({
  editor: null as import("@tiptap/core").Editor | null,
  onFormulaActivate: null as ((activation: FormulaActivation) => void) | null,
}));
vi.mock("./rich-editor/RichEditorToolbar", () => ({
  RichEditorToolbar: (props: { editor: import("@tiptap/core").Editor }) => {
    tap.editor = props.editor;
    return null;
  },
}));
vi.mock("./rich-editor/editorExtensions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./rich-editor/editorExtensions")>();
  return {
    ...actual,
    createFormulaActivateExtension: (
      onActivate: (activation: FormulaActivation) => void,
      options?: { atomLabel?: (latex: string) => string },
    ) => {
      tap.onFormulaActivate = onActivate;
      return actual.createFormulaActivateExtension(onActivate, options);
    },
  };
});

const DOC: ContentDocumentV1 = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "步骤" },
                { type: "inlineMath", latex: "a+b" },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "顶层" },
        { type: "inlineMath", latex: "c+d" },
      ],
    },
  ],
};

function atomPos(editor: Editor, latex: string): number {
  const hits: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.latex === latex) hits.push(pos);
    return true;
  });
  const pos = hits[0];
  if (pos === undefined) throw new Error(`fixture bug: no atom ${latex}`);
  return pos;
}

/** Reference editor: same schema, same document → identical positions. */
function fixturePositions() {
  const editor = new Editor({
    extensions: richEditorExtensions(),
    content: contentDocumentToTiptap(DOC),
  });
  const positions = {
    inList: atomPos(editor, "a+b"),
    topLevel: atomPos(editor, "c+d"),
  };
  editor.destroy();
  return positions;
}

/**
 * Fire the activation exactly as the Mathematics click path delivers it:
 * payload only, selection untouched — the click producer itself needs real
 * layout (posAtCoords) and cannot be synthesized in jsdom.
 */
function activateClickedAtom(pos: number) {
  if (!tap.onFormulaActivate) throw new Error("activation seam never wired");
  tap.onFormulaActivate({ pos, latex: "", display: false, nodeSize: 1 });
}

describe("formula open-time context — re-edit activation follows the target atom", () => {
  it("caret at top level + formula inside a list opens with 独立显示 unavailable; the inverse opens with it available", async () => {
    const user = userEvent.setup();
    const pos = fixturePositions();
    render(<RichContentEditor document={DOC} onChange={vi.fn()} />);
    const editor = tap.editor;
    if (!editor) throw new Error("editor never mounted");

    // LOAD-BEARING DIRECTION: the caret sits at top level while the clicked
    // atom lives inside the list item. The pre-fix code judged the caret here
    // and offered 独立显示 — a choice the persisted document then downgrades.
    editor.commands.setTextSelection(pos.topLevel + 1);
    expect(editor.isActive("listItem")).toBe(false);
    activateClickedAtom(pos.inList);
    await screen.findByTestId("formula-dialog");
    expect(screen.getByRole("radio", { name: "独立显示" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "行内" })).toBeChecked();

    // Zero-edit confirm is a policy no-op and only closes the surface.
    await user.click(screen.getByTestId("formula-confirm"));
    await waitFor(() =>
      expect(screen.queryByTestId("formula-dialog")).not.toBeInTheDocument(),
    );

    // INVERSE CONTROL: the caret sits inside the list while the clicked atom
    // is top level — the target's context still decides, and it allows
    // 独立显示 (the pre-fix caret judgment would have disabled it).
    editor.commands.setTextSelection(pos.inList + 1);
    expect(editor.isActive("listItem")).toBe(true);
    activateClickedAtom(pos.topLevel);
    await screen.findByTestId("formula-dialog");
    expect(screen.getByRole("radio", { name: "独立显示" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "行内" })).toBeChecked();
  });
});
