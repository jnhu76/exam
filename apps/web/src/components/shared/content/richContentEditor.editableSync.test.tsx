import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import type { ContentDocumentV1 } from "@exam/domain";
import {
  isContentDocumentV1,
  normalizeContentDocument,
  plainTextToDocument,
} from "@exam/domain";
import RichContentEditor from "./RichContentEditor";

/**
 * Editability sync vs. document ownership (#697).
 *
 * INVARIANT: syncing the editor's `editable` state is NOT a document change.
 * The disabled-sync effect must never surface an onChange — every onChange
 * reaches TakeExamPage.saveAnswer, which writes the answers map, flips the
 * question navigator to answered, and schedules a versioned SaveAnswer POST
 * after the 1500ms debounce. A spurious emit therefore creates answer facts
 * (empty-doc write, version 0→1, navigator flip) with zero user input.
 *
 * The suite mounts the REAL production editor (real useEditor, real
 * extension set, real ProseMirror transactions — jsdom cannot type real
 * keystrokes, so document mutations go through real Tiptap commands exactly
 * like richContentEditor.reality.test.ts). setEditable is never mocked: the
 * assertion is the onChange surface the save pipeline actually consumes, so
 * the test distinguishes "editability changed" from "document changed".
 */

// Passthrough tap on the toolbar seam (same pattern as the activation
// suite): the live editor instance is how the test drives real commands —
// jsdom has no layout, so clicks cannot place a ProseMirror selection.
const tap = vi.hoisted(() => ({
  editor: null as Editor | null,
}));
vi.mock("./rich-editor/RichEditorToolbar", () => ({
  RichEditorToolbar: (props: { editor: Editor }) => {
    tap.editor = props.editor;
    return null;
  },
}));

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

const EMPTY: ContentDocumentV1 = normalizeContentDocument(
  plainTextToDocument(""),
);

const ANSWERED: ContentDocumentV1 = {
  docVersion: 1,
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "已保存的答案" }] },
  ],
};

const REPLACEMENT: ContentDocumentV1 = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "服务器权威恢复的答案" }],
    },
  ],
};

function liveEditor(): Editor {
  const editor = tap.editor;
  if (!editor) throw new Error("editor never mounted");
  return editor;
}

/** Flushes pending passive effects so mount/rerender-side emissions land. */
async function settle() {
  await act(async () => {});
}

function mountEditor(
  onChange: (document: ContentDocumentV1) => void,
  props: { document: ContentDocumentV1; disabled?: boolean },
) {
  return render(
    <RichContentEditor
      document={props.document}
      onChange={onChange}
      disabled={props.disabled}
    />,
  );
}

describe("RichContentEditor editability sync emits no document change (#697)", () => {
  it("initial mount of an empty document surfaces no onChange", async () => {
    const onChange = vi.fn();
    tap.editor = null;
    mountEditor(onChange, { document: EMPTY });
    await settle();

    expect(document.querySelector(".ProseMirror")).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("initial mount of a non-empty (restored) document surfaces no onChange", async () => {
    const onChange = vi.fn();
    tap.editor = null;
    mountEditor(onChange, { document: ANSWERED });
    await settle();

    expect(document.querySelector(".ProseMirror")).not.toBeNull();
    expect(liveEditor().getText()).toContain("已保存的答案");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled false→true (lock) flips isEditable immediately and surfaces no onChange", async () => {
    const onChange = vi.fn();
    tap.editor = null;
    const { rerender } = mountEditor(onChange, {
      document: ANSWERED,
      disabled: false,
    });
    await settle();
    onChange.mockClear();

    rerender(
      <RichContentEditor document={ANSWERED} onChange={onChange} disabled />,
    );
    await settle();

    expect(liveEditor().isEditable).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled true→false (unlock) flips isEditable immediately and surfaces no onChange", async () => {
    const onChange = vi.fn();
    tap.editor = null;
    const { rerender } = mountEditor(onChange, {
      document: ANSWERED,
      disabled: true,
    });
    await settle();
    expect(liveEditor().isEditable).toBe(false);
    onChange.mockClear();

    rerender(
      <RichContentEditor
        document={ANSWERED}
        onChange={onChange}
        disabled={false}
      />,
    );
    await settle();

    expect(liveEditor().isEditable).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("authoritative external replacement surfaces no onChange", async () => {
    const onChange = vi.fn();
    tap.editor = null;
    const { rerender } = mountEditor(onChange, { document: ANSWERED });
    await settle();
    onChange.mockClear();

    rerender(<RichContentEditor document={REPLACEMENT} onChange={onChange} />);
    await settle();

    expect(liveEditor().getText()).toContain("服务器权威恢复的答案");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a real document edit still surfaces exactly its change", async () => {
    const onChange = vi.fn();
    tap.editor = null;
    mountEditor(onChange, { document: EMPTY });
    await settle();
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      liveEditor()
        .chain()
        .focus()
        .insertContent({ type: "text", text: "真实输入" })
        .run();
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const firstCall = onChange.mock.calls[0];
    if (!firstCall) throw new Error("onChange call vanished");
    const emitted = firstCall[0] as ContentDocumentV1;
    // Carried from the pre-#697 renderer contract: every surfaced document
    // is canonical ContentDocumentV1 — never raw Tiptap JSON.
    expect(isContentDocumentV1(emitted)).toBe(true);
    expect(JSON.stringify(emitted)).toContain("真实输入");
  });
});
