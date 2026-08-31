import { describe, expect, it } from "vitest";
import { plainTextToDocument, type ContentDocumentV1 } from "@exam/domain";
import { isAuthoritativeReplacement } from "./RichContentEditor";

/**
 * Editor ownership protocol tests (issue 301 corrective pass round-2).
 *
 * `isAuthoritativeReplacement` is the pure correctness boundary of the
 * two-way ownership protocol: the component's `currentEditorDocumentRef`
 * invariant is "ref === canonical document currently held by Tiptap", and this
 * decision says whether an incoming prop is an authoritative replacement
 * (must setContent) or the parent's local-edit echo (must skip). The real
 * ProseMirror behavior is proven by the rich-content E2E suite — jsdom cannot
 * type into Tiptap — so these tests pin the decision logic and the exact
 * regression scenarios from the review.
 */

const emptyDoc = (): ContentDocumentV1 => plainTextToDocument(""); // the mapping RichTextAnswerInput applies to null
const docOf = (text: string): ContentDocumentV1 => ({
  docVersion: 1,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/**
 * Mirrors the component's ownership state machine exactly: `current` is the
 * ref (canonical document Tiptap holds); `local(doc)` re-anchors it (onUpdate);
 * `incoming(doc)` runs the sync-effect classification.
 */
function simulate(
  initial: ContentDocumentV1,
  events: Array<{ kind: "local" | "incoming"; doc: ContentDocumentV1 }>,
) {
  let current: ContentDocumentV1 | null = initial;
  const trace: string[] = [];
  for (const event of events) {
    if (event.kind === "local") {
      current = event.doc;
      trace.push(`emit`);
    } else if (isAuthoritativeReplacement(event.doc, current)) {
      current = event.doc;
      trace.push("replace");
    } else {
      trace.push("skip");
    }
  }
  return { current, trace };
}

describe("isAuthoritativeReplacement — editor ownership decision", () => {
  it("classifies the parent's local-edit echo as a skip (structurally equal)", () => {
    const doc = docOf("LOCAL");
    expect(isAuthoritativeReplacement(doc, doc)).toBe(false);
  });

  it("classifies a structurally different prop as an authoritative replacement", () => {
    expect(isAuthoritativeReplacement(docOf("EMPTY"), docOf("LOCAL"))).toBe(
      true,
    );
  });

  it("treats an unknown editor state as needing a replacement (no stale trust)", () => {
    expect(isAuthoritativeReplacement(docOf("x"), null)).toBe(true);
  });
});

describe("ownership protocol — external rollback to initial document", () => {
  it("replaces the editor when the authoritative value rolls back to the initial EMPTY", () => {
    // initial = EMPTY; local edit → LOCAL; authoritative value becomes EMPTY.
    const { current, trace } = simulate(emptyDoc(), [
      { kind: "local", doc: docOf("LOCAL") },
      { kind: "incoming", doc: emptyDoc() },
    ]);
    // Regression: the old "appliedRef baseline" model saw EMPTY was applied
    // once and SKIPPED the replacement, leaving the editor showing LOCAL.
    expect(trace).toEqual(["emit", "replace"]);
    expect(current).toEqual(emptyDoc());
  });

  it("re-anchors so the next local edit starts from the EMPTY baseline", () => {
    const { current, trace } = simulate(emptyDoc(), [
      { kind: "local", doc: docOf("LOCAL") },
      { kind: "incoming", doc: emptyDoc() },
      { kind: "local", doc: docOf("SERVER-NEXT") },
      { kind: "incoming", doc: docOf("SERVER-NEXT") },
    ]);
    expect(trace).toEqual(["emit", "replace", "emit", "skip"]);
    expect(current).toEqual(docOf("SERVER-NEXT"));
  });

  it("does not replace on a plain echo of the current editor document", () => {
    const { current, trace } = simulate(emptyDoc(), [
      { kind: "local", doc: docOf("LOCAL") },
      { kind: "incoming", doc: docOf("LOCAL") },
    ]);
    expect(trace).toEqual(["emit", "skip"]);
    expect(current).toEqual(docOf("LOCAL"));
  });
});

describe("ownership protocol — external clear via null", () => {
  it("maps an authoritative null answer to the empty document and replaces the editor", () => {
    // RichTextAnswerInput maps value == null → plainTextToDocument(""); the
    // mapped empty document must be treated as an authoritative replacement
    // when the editor currently holds LOCAL.
    const clearDoc = emptyDoc();
    expect(isAuthoritativeReplacement(clearDoc, docOf("LOCAL"))).toBe(true);

    const { current, trace } = simulate(docOf("LOCAL"), [
      { kind: "incoming", doc: clearDoc },
    ]);
    expect(trace).toEqual(["replace"]);
    expect(current).toEqual(clearDoc);
  });

  it("keeps the cleared state as the new baseline for subsequent local edits", () => {
    const { current } = simulate(docOf("LOCAL"), [
      { kind: "incoming", doc: emptyDoc() },
      { kind: "local", doc: docOf("after-clear") },
      { kind: "incoming", doc: docOf("after-clear") },
    ]);
    expect(current).toEqual(docOf("after-clear"));
  });
});
