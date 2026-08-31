import { describe, expect, it } from "vitest";
import { plainTextToDocument, type ContentDocumentV1 } from "@exam/domain";
import { isAuthoritativeReplacement } from "./RichContentEditor";

/**
 * Editor ownership decision tests.
 *
 * `isAuthoritativeReplacement` is the pure correctness boundary of the
 * two-way ownership protocol: the component's `currentEditorDocumentRef`
 * invariant is "ref === canonical document currently held by Tiptap", and this
 * decision says whether an incoming prop is an authoritative replacement
 * (must setContent) or the parent's local-edit echo (must skip). The real
 * ProseMirror behavior — cross-question isolation, STALE_VERSION external
 * replacement, rollback-to-empty — is proven by the rich-content E2E suite
 * (jsdom cannot type into Tiptap), so these tests pin only the decision logic.
 */

const emptyDoc = (): ContentDocumentV1 => plainTextToDocument(""); // the mapping RichTextAnswerInput applies to null
const docOf = (text: string): ContentDocumentV1 => ({
  docVersion: 1,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("isAuthoritativeReplacement — editor ownership decision", () => {
  it("skips the parent's local-edit echo (structurally equal)", () => {
    const doc = docOf("LOCAL");
    expect(isAuthoritativeReplacement(doc, doc)).toBe(false);
  });

  it("replaces on a structurally different prop", () => {
    expect(isAuthoritativeReplacement(docOf("EMPTY"), docOf("LOCAL"))).toBe(
      true,
    );
  });

  it("rolls back to an EMPTY authoritative document after a local edit", () => {
    // Regression scenario: initial = EMPTY; local edit → LOCAL; authoritative
    // value becomes EMPTY again. The replacement must NOT be skipped.
    const local = docOf("LOCAL");
    expect(isAuthoritativeReplacement(local, local)).toBe(false); // echo
    expect(isAuthoritativeReplacement(emptyDoc(), local)).toBe(true); // rollback
  });

  it("treats an unknown editor state as needing a replacement (no stale trust)", () => {
    expect(isAuthoritativeReplacement(docOf("x"), null)).toBe(true);
  });
});
