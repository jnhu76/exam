import { describe, expect, it } from "vitest";
import {
  classifyPersistedRichAnswer,
  resolveRichAnswerDocument,
} from "./persistedRichAnswer.js";

const validDoc = {
  docVersion: 1,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "answer" }] }],
};

/** Schema-valid but noncanonical: unsorted marks, split same-mark runs. */
const noncanonicalDoc = {
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

/** Envelope-shaped but deep-invalid (unknown inline node): the shallow
 * envelope gate accepts it, the deep read gate must reject it. */
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
 * PC-F01 class (B-F01 closure): two schema-legal same-mark runs whose
 * normalized merge exceeds the textRun limit — schema-valid, but the write
 * seam's canonicalization rejects the merged form. The read classifier must
 * keep it interpretable (rich_noncanonical), never corrupt, never valid.
 */
const pcF01ClosureClass = {
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

/**
 * classifyPersistedRichAnswer is the single typed persisted-read authority
 * (§7 read contract, #669 Phase D3): it distinguishes empty / plain /
 * legacy_plain / rich_valid / rich_noncanonical / unsupported_version /
 * corrupt, and a string in a Rich slot is never legacy_plain without
 * explicit provenance.
 */
describe("classifyPersistedRichAnswer — §7 typed read states", () => {
  it("classifies absent values as empty regardless of mode", () => {
    expect(
      classifyPersistedRichAnswer({ value: null, answerMode: "rich" }),
    ).toEqual({
      kind: "empty",
    });
    expect(
      classifyPersistedRichAnswer({ value: undefined, answerMode: "plain" }),
    ).toEqual({ kind: "empty" });
  });

  it("R1 positive control: a string on a plain-mode slot is plain (frozen mode is the provenance)", () => {
    expect(
      classifyPersistedRichAnswer({ value: "普通答案", answerMode: "plain" }),
    ).toEqual({ kind: "plain", text: "普通答案" });
    // Legacy snapshots omit answerMode; the contract normalizes null to
    // plain, so a plain string there is the legitimate representation.
    expect(
      classifyPersistedRichAnswer({ value: "旧答案", answerMode: null }),
    ).toEqual({ kind: "plain", text: "旧答案" });
  });

  it("R1: a string in a rich slot is corrupt, never legacy_plain (no runtime-shape provenance)", () => {
    const read = classifyPersistedRichAnswer({
      value: "未解释的旧字符串",
      answerMode: "rich",
    });
    expect(read).toEqual({
      kind: "corrupt",
      raw: "未解释的旧字符串",
    });
  });

  it("legacy_plain is reachable only through explicit provenance evidence", () => {
    expect(
      classifyPersistedRichAnswer({
        value: "历史纯文本",
        answerMode: "rich",
        legacyPlainProvenance: true,
      }),
    ).toEqual({ kind: "legacy_plain", text: "历史纯文本" });
    // Provenance never upgrades a string on an already-plain slot into a
    // different state, and shape alone never establishes it.
    expect(
      classifyPersistedRichAnswer({
        value: "普通答案",
        answerMode: "plain",
        legacyPlainProvenance: true,
      }),
    ).toEqual({ kind: "plain", text: "普通答案" });
  });

  it("R2: a future docVersion envelope is unsupported_version, not empty/corrupt/plain", () => {
    expect(
      classifyPersistedRichAnswer({
        value: unsupportedVersion,
        answerMode: "rich",
      }),
    ).toEqual({ kind: "unsupported_version", raw: unsupportedVersion });
    // The version signal wins even where the rest of the envelope is odd.
    expect(
      classifyPersistedRichAnswer({
        value: { docVersion: 3 },
        answerMode: "rich",
      }),
    ).toEqual({ kind: "unsupported_version", raw: { docVersion: 3 } });
  });

  it("R3: a corrupt envelope-shaped value is corrupt (deep gate, not the shallow hint)", () => {
    expect(
      classifyPersistedRichAnswer({
        value: corruptEnvelope,
        answerMode: "rich",
      }),
    ).toEqual({ kind: "corrupt", raw: corruptEnvelope });
  });

  it("classifies non-envelope payloads as corrupt on a rich slot", () => {
    for (const value of [42, [validDoc], { type: "doc" }, { foo: "bar" }]) {
      expect(
        classifyPersistedRichAnswer({ value, answerMode: "rich" }),
      ).toEqual({
        kind: "corrupt",
        raw: value,
      });
    }
  });

  it("classifies a hostile deep document as corrupt (bounded preflight before the recursive parse)", () => {
    let content: unknown = [{ type: "text", text: "leaf" }];
    for (let i = 0; i < 500; i++) content = [content];
    const hostile = { docVersion: 1, type: "doc", content };
    expect(
      classifyPersistedRichAnswer({ value: hostile, answerMode: "rich" }),
    ).toEqual({
      kind: "corrupt",
      raw: hostile,
    });
  });

  it("classifies a canonical document as rich_valid", () => {
    const read = classifyPersistedRichAnswer({
      value: validDoc,
      answerMode: "rich",
    });
    expect(read.kind).toBe("rich_valid");
    expect(read.kind === "rich_valid" && read.document).toEqual(validDoc);
  });

  it("classifies a schema-valid noncanonical document as rich_noncanonical and returns it UNREPAIRED", () => {
    const read = classifyPersistedRichAnswer({
      value: noncanonicalDoc,
      answerMode: "rich",
    });
    expect(read.kind).toBe("rich_noncanonical");
    // Read classification must not mutate or silently normalize persisted
    // data: the returned document is the persisted shape.
    expect(read.kind === "rich_noncanonical" && read.document).toEqual(
      noncanonicalDoc,
    );
  });

  it("classifies the PC-F01 canonical-closure class as rich_noncanonical (interpretable, not valid)", () => {
    const read = classifyPersistedRichAnswer({
      value: pcF01ClosureClass,
      answerMode: "rich",
    });
    // Schema accepts the split runs; normalization merges them past the
    // textRun limit so canonicalization fails — a canonical-invariant
    // violation, not generic corruption.
    expect(read.kind).toBe("rich_noncanonical");
  });
});

/**
 * resolveRichAnswerDocument is the binary projection of the classifier for
 * read-only rendering — one authority, no second read oracle (D3-I).
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

  it("stays binary-consistent with the classifier: valid/noncanonical render, everything else rejects", () => {
    const corpus: Array<[unknown, string | null]> = [
      [validDoc, "rich"],
      [noncanonicalDoc, "rich"],
      [pcF01ClosureClass, "rich"],
      [unsupportedVersion, "rich"],
      [corruptEnvelope, "rich"],
      ["legacy-looking string", "rich"],
      [null, "rich"],
      [validDoc, "plain"],
    ];
    for (const [value, mode] of corpus) {
      const read = classifyPersistedRichAnswer({ value, answerMode: mode });
      const resolved = resolveRichAnswerDocument(value, mode);
      const interpretable =
        read.kind === "rich_valid" || read.kind === "rich_noncanonical";
      expect(interpretable).toBe(resolved !== null);
    }
  });
});

describe("durable-unrepresentable persisted values (#669 Phase F)", () => {
  it("classify as corrupt and refuse resolution — never rich_valid", () => {
    for (const bad of ["\u0000", "\uD800", "\uDC00"]) {
      const value = {
        docVersion: 1,
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: bad }] },
        ],
      };
      const read = classifyPersistedRichAnswer({ value, answerMode: "rich" });
      expect(read.kind, JSON.stringify(bad)).toBe("corrupt");
      expect(resolveRichAnswerDocument(value, "rich")).toBeNull();
    }
  });
});
