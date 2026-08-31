import { describe, expect, it } from "vitest";
import { resolveRichAnswerDocument } from "./richAnswer";

const validDoc = {
  docVersion: 1,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "answer" }] }],
};

/**
 * resolveRichAnswerDocument is the FROZEN-SEMANTICS render authority for
 * persisted answers: the frozen `answerMode` decides, never the envelope
 * shape alone.
 */
describe("resolveRichAnswerDocument — render authority for persisted answers", () => {
  it("renders a valid canonical document only when answerMode is rich", () => {
    expect(resolveRichAnswerDocument(validDoc, "rich")).toEqual(validDoc);
  });

  it("refuses to render a document-looking payload on a non-rich answer", () => {
    // Legacy plain answer that happens to look like an envelope: the frozen
    // mode is the authority, so it keeps the safe legacy formatter.
    expect(resolveRichAnswerDocument(validDoc, "plain")).toBeNull();
    expect(resolveRichAnswerDocument(validDoc, null)).toBeNull();
    expect(resolveRichAnswerDocument(validDoc, undefined)).toBeNull();
  });

  it("refuses a non-envelope payload even on a rich answer", () => {
    expect(resolveRichAnswerDocument("plain string", "rich")).toBeNull();
    expect(resolveRichAnswerDocument(42, "rich")).toBeNull();
    expect(resolveRichAnswerDocument(null, "rich")).toBeNull();
    expect(resolveRichAnswerDocument([validDoc], "rich")).toBeNull();
  });

  it("refuses a corrupt envelope (out-of-grammar content) on a rich answer", () => {
    const corrupt = { docVersion: 1, type: "doc", content: "not an array" };
    expect(resolveRichAnswerDocument(corrupt, "rich")).toBeNull();
  });

  it("refuses a hostile deep document on a rich answer (bounded preflight, no recursive parse)", () => {
    let content: unknown = [{ type: "text", text: "leaf" }];
    for (let i = 0; i < 500; i++) content = [content];
    const hostile = { docVersion: 1, type: "doc", content };
    expect(resolveRichAnswerDocument(hostile, "rich")).toBeNull();
  });

  it("returns the parsed canonical document, not the raw payload", () => {
    const resolved = resolveRichAnswerDocument(validDoc, "rich");
    expect(resolved).not.toBeNull();
    expect(resolved!.content[0]).toEqual(validDoc.content[0]);
  });
});
