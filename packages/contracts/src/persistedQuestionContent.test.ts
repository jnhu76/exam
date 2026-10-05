import { describe, expect, it } from "vitest";
import {
  classifyPersistedQuestionContent,
  resolvePersistedQuestionDocument,
} from "./persistedQuestionContent.js";

const validDoc = {
  docVersion: 1,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "题干" }] }],
};

/** Schema-valid but noncanonical: unsorted marks, split same-mark runs. */
const noncanonicalDoc = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "题", marks: ["italic", "bold"] },
        { type: "text", text: "干", marks: ["italic", "bold"] },
      ],
    },
  ],
};

/** Envelope-shaped but out-of-grammar (unknown inline node). */
const corruptEnvelope = {
  docVersion: 1,
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "mysteryInline", text: "x" }] },
  ],
};

const unsupportedVersion = {
  docVersion: 2,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "v2" }] }],
};

/**
 * classifyPersistedQuestionContent is the static/prompt read-trust authority
 * (#669 Phase D5-A, F-06): question contentDocument is Rich-authoritative
 * whenever it is non-null (ADR-019 B′ — contentMode is derived from slot
 * nullness), so the classifier distinguishes plain / rich_valid /
 * rich_noncanonical / unsupported_version / corrupt. There is no
 * legacy_plain: the document slot never carried a legacy plain-string
 * population, so a string in the slot is an inconsistent stored shape.
 */
describe("classifyPersistedQuestionContent — §7 static read states", () => {
  it("classifies a null document slot as plain (the content string is the authority)", () => {
    expect(classifyPersistedQuestionContent(null)).toEqual({ kind: "plain" });
    expect(classifyPersistedQuestionContent(undefined)).toEqual({
      kind: "plain",
    });
  });

  it("classifies a canonical document as rich_valid", () => {
    const read = classifyPersistedQuestionContent(validDoc);
    expect(read.kind).toBe("rich_valid");
    expect(read.kind === "rich_valid" && read.document).toEqual(validDoc);
  });

  it("a non-current docVersion is unsupported_version — never interpreted as V1, never plain", () => {
    expect(classifyPersistedQuestionContent(unsupportedVersion)).toEqual({
      kind: "unsupported_version",
      raw: unsupportedVersion,
    });
    // The version signal wins even where the rest of the envelope is odd.
    expect(classifyPersistedQuestionContent({ docVersion: 3 })).toEqual({
      kind: "unsupported_version",
      raw: { docVersion: 3 },
    });
  });

  it("a non-envelope value is corrupt, and a string in the document slot is never adopted as plain", () => {
    for (const value of [
      "遗留字符串",
      42,
      [validDoc],
      { type: "doc" },
      { docVersion: 1, type: "doc", content: "not an array" },
    ]) {
      expect(classifyPersistedQuestionContent(value)).toEqual({
        kind: "corrupt",
        raw: value,
      });
    }
  });

  it("an out-of-grammar envelope is corrupt (deep gate, not the shallow shape)", () => {
    expect(classifyPersistedQuestionContent(corruptEnvelope)).toEqual({
      kind: "corrupt",
      raw: corruptEnvelope,
    });
  });

  it("a hostile deep document is corrupt (bounded preflight before the recursive parse)", () => {
    let content: unknown = [{ type: "text", text: "leaf" }];
    for (let i = 0; i < 500; i++) content = [content];
    const hostile = { docVersion: 1, type: "doc", content };
    expect(classifyPersistedQuestionContent(hostile)).toEqual({
      kind: "corrupt",
      raw: hostile,
    });
  });

  it("a schema-valid noncanonical document is rich_noncanonical and returned UNREPAIRED (read != repair)", () => {
    const read = classifyPersistedQuestionContent(noncanonicalDoc);
    expect(read.kind).toBe("rich_noncanonical");
    expect(read.kind === "rich_noncanonical" && read.document).toEqual(
      noncanonicalDoc,
    );
  });
});

/**
 * resolvePersistedQuestionDocument is the binary projection of the classifier
 * for static display — DISPLAY only, never canonicality, editability, or
 * repair authority. ContentDocumentRenderer must receive only documents this
 * projection has accepted (#669 Phase D5-A).
 */
describe("resolvePersistedQuestionDocument — static render authority", () => {
  it("accepts a valid canonical document", () => {
    expect(resolvePersistedQuestionDocument(validDoc)).toEqual(validDoc);
  });

  it("accepts a noncanonical historical document for read-only display", () => {
    expect(resolvePersistedQuestionDocument(noncanonicalDoc)).toEqual(
      noncanonicalDoc,
    );
  });

  it("refuses unsupported-version, corrupt, and absent values", () => {
    expect(resolvePersistedQuestionDocument(unsupportedVersion)).toBeNull();
    expect(resolvePersistedQuestionDocument(corruptEnvelope)).toBeNull();
    expect(resolvePersistedQuestionDocument({ docVersion: 1 })).toBeNull();
    expect(resolvePersistedQuestionDocument("plain string")).toBeNull();
    expect(resolvePersistedQuestionDocument(null)).toBeNull();
  });

  it("returns the parsed canonical document, not the raw payload", () => {
    const resolved = resolvePersistedQuestionDocument(validDoc);
    expect(resolved).not.toBeNull();
    expect(resolved!.content[0]).toEqual(validDoc.content[0]);
  });

  it("stays binary-consistent with the classifier: valid/noncanonical render, everything else rejects", () => {
    const corpus = [
      validDoc,
      noncanonicalDoc,
      unsupportedVersion,
      corruptEnvelope,
      { docVersion: 1 },
      "legacy-looking string",
      null,
    ];
    for (const value of corpus) {
      const read = classifyPersistedQuestionContent(value);
      const resolved = resolvePersistedQuestionDocument(value);
      const interpretable =
        read.kind === "rich_valid" || read.kind === "rich_noncanonical";
      expect(interpretable).toBe(resolved !== null);
    }
  });
});

describe("durable-unrepresentable persisted values (#669)", () => {
  it("classify as corrupt and refuse resolution — never rich_valid", () => {
    for (const bad of ["\u0000", "\uD800", "\uDC00"]) {
      const value = {
        docVersion: 1,
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: bad }] },
        ],
      };
      const read = classifyPersistedQuestionContent(value);
      expect(read.kind, JSON.stringify(bad)).toBe("corrupt");
      expect(resolvePersistedQuestionDocument(value)).toBeNull();
    }
  });
});
