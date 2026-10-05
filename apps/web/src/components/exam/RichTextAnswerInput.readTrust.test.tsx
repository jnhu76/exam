import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ContentDocumentV1 } from "@exam/domain";
import { RichTextAnswerInput } from "./RichTextAnswerInput";

/**
 * Read-trust regressions (#669).
 *
 * The persisted-read authority (classifyPersistedRichAnswer) decides what may
 * mount the candidate editor. The dangerous edge these tests guard is the
 * whole chain, not just the classifier:
 *
 *   bad persisted value → empty editor → initial onChange → autosave
 *   → persisted source truth overwritten
 *
 * An integrity state mounts NO editor, so no onChange (and therefore no
 * saveAnswer/clientSeq/version mutation) can exist for unsupported_version
 * or corrupt values — on initial mount, on reload/restore re-application,
 * and on STALE_VERSION serverAnswer adoption alike (they all arrive through
 * the same `value` prop seam).
 *
 * Focused review (#669): `rich_noncanonical` fails closed too. The
 * editor's onUpdate re-serializes through canonicalization, so mounting a
 * noncanonical persisted value would turn read classification into a silent
 * repair write; for the canonical-closure class the canonicalized form itself
 * exceeds CONTENT_LIMITS, yielding an editor whose output can never save.
 */

const VALID: ContentDocumentV1 = {
  docVersion: 1,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "答案" }] }],
};

const VALID_REPLACEMENT: ContentDocumentV1 = {
  docVersion: 1,
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "服务器最新答案" }] },
  ],
};

/** Envelope-shaped but deep-invalid (unknown inline node). */
const CORRUPT_ENVELOPE = {
  docVersion: 1,
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "mysteryInline", text: "x" }] },
  ],
};

/** Envelope-shaped, shallow gate passes, deep-invalid (unknown block). */
const CORRUPT_ENVELOPE_UNKNOWN_BLOCK = {
  docVersion: 1,
  type: "doc",
  content: [
    { type: "script" },
    { type: "paragraph", content: [{ type: "text", text: "after" }] },
  ],
};

const UNSUPPORTED_VERSION = {
  docVersion: 2,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "v2" }] }],
};

/** Schema-valid but noncanonical: unsorted marks, split same-mark runs.
 * Canonicalizable — an editable mount would silently normalize it on the
 * first onUpdate even without a semantic edit. */
const NONCANONICAL = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "答", marks: ["italic", "bold"] },
        { type: "text", text: "案", marks: ["italic", "bold"] },
      ],
    },
  ],
};

/** Canonical-closure class: two schema-legal same-mark runs whose normalized
 * merge exceeds the textRun limit — an editable mount would emit a value
 * the write seam's canonical boundary always rejects. */
const MERGED_RUNS_NONCANONICAL = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "a".repeat(10001), marks: ["bold"] },
        { type: "text", text: "b".repeat(10001), marks: ["bold"] },
      ],
    },
  ],
};

async function expectIntegrityState(
  onChange: ReturnType<typeof vi.fn>,
  callsAllowed = 0,
) {
  const notice = await screen.findByTestId("rich-answer-integrity-error");
  expect(notice.textContent).toContain("此作答内容无法安全加载编辑");
  // Fail closed: the editor never mounts, so no transaction — and no
  // synthetic onChange/autosave — can arise from this value.
  expect(document.querySelector(".ProseMirror")).toBeNull();
  expect(onChange.mock.calls.length).toBe(callsAllowed);
}

describe("RichTextAnswerInput — typed read adoption", () => {
  it("R1: an unexplained string in a rich slot fails closed as an integrity state", async () => {
    const onChange = vi.fn();
    render(
      <RichTextAnswerInput
        value={"未解释的旧字符串"}
        answerMode="rich"
        onChange={onChange}
      />,
    );
    await expectIntegrityState(onChange);
  }, 15000);

  it("R1 positive control: a string on a plain-mode slot upgrades into the editor (authorized mapping)", async () => {
    render(
      <RichTextAnswerInput
        value={"普通文本草稿"}
        answerMode="plain"
        onChange={() => {}}
      />,
    );
    const surface = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ProseMirror");
      if (!el) throw new Error("editor not mounted");
      return el;
    });
    expect(surface.textContent).toContain("普通文本草稿");
  }, 15000);

  it("R2: an unsupported docVersion never mounts as an editable empty document and emits nothing", async () => {
    const onChange = vi.fn();
    render(
      <RichTextAnswerInput
        value={UNSUPPORTED_VERSION}
        answerMode="rich"
        onChange={onChange}
      />,
    );
    await expectIntegrityState(onChange);
  }, 15000);

  it("F1-A: a canonicalizable rich_noncanonical value never mounts and emits no silent canonical repair", async () => {
    const onChange = vi.fn();
    render(
      <RichTextAnswerInput
        value={NONCANONICAL}
        answerMode="rich"
        onChange={onChange}
      />,
    );
    await expectIntegrityState(onChange);
  }, 15000);

  it("the canonical-closure class never exposes an editable surface", async () => {
    const onChange = vi.fn();
    render(
      <RichTextAnswerInput
        value={MERGED_RUNS_NONCANONICAL}
        answerMode="rich"
        onChange={onChange}
      />,
    );
    await expectIntegrityState(onChange);
  }, 15000);

  it("R3: a corrupt envelope-shaped value never enters the editor", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextAnswerInput
        value={CORRUPT_ENVELOPE}
        answerMode="rich"
        onChange={onChange}
      />,
    );
    await expectIntegrityState(onChange);

    rerender(
      <RichTextAnswerInput
        value={CORRUPT_ENVELOPE_UNKNOWN_BLOCK}
        answerMode="rich"
        onChange={onChange}
      />,
    );
    await expectIntegrityState(onChange);
  }, 15000);

  it("R5: a corrupt/unsupported STALE_VERSION serverAnswer adoption replaces the editor with the integrity state and never emits synthetic content", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextAnswerInput
        value={VALID}
        answerMode="rich"
        onChange={onChange}
      />,
    );
    await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ProseMirror");
      if (!el) throw new Error("editor not mounted");
      return el;
    });
    expect(document.querySelector(".ProseMirror")!.textContent).toContain(
      "答案",
    );
    // The valid mount's own transaction legitimately emitted; snapshot the
    // count so the corrupt adoptions can be held to "nothing further".
    const callsAtValidMount = onChange.mock.calls.length;

    // Server reconciliation arrives with a value the read authority cannot
    // interpret: the editor unmounts into the integrity state — the local
    // editor is never replaced by synthetic empty content, and nothing is
    // emitted that an autosave could persist over the server truth.
    rerender(
      <RichTextAnswerInput
        value={UNSUPPORTED_VERSION}
        answerMode="rich"
        onChange={onChange}
      />,
    );
    await expectIntegrityState(onChange, callsAtValidMount);

    rerender(
      <RichTextAnswerInput
        value={CORRUPT_ENVELOPE}
        answerMode="rich"
        onChange={onChange}
      />,
    );
    await expectIntegrityState(onChange, callsAtValidMount);
  }, 15000);

  it("R5 positive control: a valid canonical serverAnswer still adopts normally", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextAnswerInput
        value={VALID}
        answerMode="rich"
        onChange={onChange}
      />,
    );
    await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ProseMirror");
      if (!el) throw new Error("editor not mounted");
      return el;
    });
    rerender(
      <RichTextAnswerInput
        value={VALID_REPLACEMENT}
        answerMode="rich"
        onChange={onChange}
      />,
    );
    await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ProseMirror");
      if (!el || !el.textContent!.includes("服务器最新答案")) {
        throw new Error("authoritative replacement not adopted yet");
      }
      return el;
    });
  }, 15000);

  it("an explicitly empty (unanswered) value still mounts an ordinary editor", async () => {
    const onChange = vi.fn();
    render(
      <RichTextAnswerInput
        value={null}
        answerMode="rich"
        onChange={onChange}
      />,
    );
    await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ProseMirror");
      if (!el) throw new Error("editor not mounted");
      return el;
    });
  }, 15000);
});
