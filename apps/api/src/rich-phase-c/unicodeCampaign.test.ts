/**
 * Phase-C Campaign K (#669) — Unicode / text integrity.
 *
 * The frozen contract does NOT introduce Unicode normalization: NFC/NFD
 * equivalence is NOT an oracle. Limits are defined on JS UTF-16 code units
 * (kernel: "Character counts ... JS string length, not UTF-8 bytes").
 *
 * Focus: UTF-16 accounting at textRun boundaries, merge (concatenation)
 * behavior across surrogate-pair boundaries, ZWJ/combining/bidi controls,
 * CRLF/LF/tabs, JSON escaped Unicode, and non-ASCII B-F01 class variants —
 * all through the production canonicalization seam.
 */

import { describe, expect, it } from "vitest";
import { ContentDocumentV1Schema } from "@exam/contracts";
import {
  CONTENT_LIMITS,
  checkContentDocumentLimits,
  preflightContentDocumentStructure,
  type ContentDocumentV1,
  type QuestionSnapshot,
} from "@exam/domain";
import { validateAnswerForQuestion } from "../lib/validateAnswerForQuestion.js";
import { structuralEqual } from "./generators.js";

const RICH_TEXT_QUESTION: QuestionSnapshot = {
  originalQuestionId: "phase-c-unicode-q",
  type: "text_response",
  content: "unicode question",
  contentDocument: null,
  answerMode: "rich",
  attachments: [],
  options: [],
  standardAnswer: null,
  score: 10,
  gradingRule: {
    multiSelectScoring: "all_correct_full",
    fillBlankMatchMode: "exact",
  },
  order: 0,
  rubric: null,
};

function oneRunDoc(text: string, marks?: string[]): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text, ...(marks ? { marks: marks as never } : {}) },
        ],
      },
    ],
  };
}

function twoRunDoc(
  t1: string,
  t2: string,
  marks?: string[],
): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: t1,
            ...(marks ? { marks: marks as never } : {}),
          },
          {
            type: "text",
            text: t2,
            ...(marks ? { marks: marks as never } : {}),
          },
        ],
      },
    ],
  };
}

function firstMergedText(c: ContentDocumentV1): string {
  return (c.content[0] as { content: Array<{ text: string }> }).content[0]
    ?.text as string;
}

function closureAccepts(d: ContentDocumentV1): boolean {
  const r = validateAnswerForQuestion(RICH_TEXT_QUESTION, d);
  if (!r.ok) return false;
  const c = r.value as ContentDocumentV1;
  return (
    ContentDocumentV1Schema.safeParse(c).success &&
    checkContentDocumentLimits(c).length === 0 &&
    preflightContentDocumentStructure(c).length === 0
  );
}

describe("Phase-C Campaign K — Unicode / text integrity", () => {
  it("textRun counts UTF-16 code units: 10000 astral emoji = exactly 20000 units = at the limit", () => {
    const emoji = "👍"; // U+1F44D, 2 UTF-16 code units
    expect(emoji.length).toBe(2);
    const atLimit = oneRunDoc(emoji.repeat(10000));
    expect(firstMergedText(atLimit).length).toBe(CONTENT_LIMITS.textRun);
    expect(ContentDocumentV1Schema.safeParse(atLimit).success).toBe(true);

    // One more emoji → 20002 units → over the limit as a SINGLE run.
    const overLimit = oneRunDoc(emoji.repeat(10001));
    expect(ContentDocumentV1Schema.safeParse(overLimit).success).toBe(false);
  });

  it("B-F01 astral variant: 10000 emoji + 1 emoji in same-mark runs merges past textRun", () => {
    const emoji = "👍";
    const input = twoRunDoc(emoji.repeat(10000), emoji, ["bold"]);
    expect(ContentDocumentV1Schema.safeParse(input).success).toBe(true);
    const canonical = validateAnswerForQuestion(RICH_TEXT_QUESTION, input);
    expect(canonical.ok).toBe(true);
    const c = (canonical as { ok: true; value: ContentDocumentV1 }).value;
    // Exact code-unit evidence: 10001 emoji = 20002 UTF-16 code units.
    expect(firstMergedText(c).length).toBe(20002);
    expect(firstMergedText(c)).toBe(emoji.repeat(10001));
    expect(ContentDocumentV1Schema.safeParse(c).success).toBe(false);
    expect(closureAccepts(input)).toBe(false);
  });

  it("B-F01 CJK variant: 20000 CJK chars + 1 merges past textRun (BMP, 1 unit each)", () => {
    const input = twoRunDoc("中".repeat(20000), "文");
    expect(ContentDocumentV1Schema.safeParse(input).success).toBe(true);
    expect(closureAccepts(input)).toBe(false);
  });

  it("lone surrogate halves in adjacent runs concatenate without corruption or failure", () => {
    // A surrogate pair split across two same-mark runs: merging is code-unit
    // concatenation, so the merged value is a VALID pair. No closure break,
    // no throw — boundary behavior recorded.
    const split = twoRunDoc("a\uD800", "\uDC00b");
    expect(ContentDocumentV1Schema.safeParse(split).success).toBe(true);
    const canonical = validateAnswerForQuestion(RICH_TEXT_QUESTION, split);
    expect(canonical.ok).toBe(true);
    const c = (canonical as { ok: true; value: ContentDocumentV1 }).value;
    expect(firstMergedText(c)).toBe("a\u{10000}b"); // \uD800\uDC00 = U+10000
    expect(closureAccepts(split)).toBe(true);
    // Well-formed JSON.stringify escapes lone surrogates; the preflight
    // stringify path must not throw on either representation.
    expect(() =>
      preflightContentDocumentStructure(oneRunDoc("\uD800")),
    ).not.toThrow();
  });

  it("ZWJ sequences, combining marks, bidi controls: merge-safe, unit-accounted, no silent change", () => {
    const family = "👨‍👩‍👧‍👦"; // 4 astral (8 units) + 3 ZWJ (3 units) = 11 units
    expect(family.length).toBe(11);
    const accents = "e\u0301"; // e + combining acute = 2 units, 1 grapheme
    expect(accents.length).toBe(2);
    const rtl = "\u200F\u202Etext\u202C\u200E"; // bidi controls preserved verbatim
    for (const sample of [family, accents, rtl]) {
      const input = twoRunDoc(sample, sample);
      const canonical = validateAnswerForQuestion(RICH_TEXT_QUESTION, input);
      expect(canonical.ok).toBe(true);
      const c = (canonical as { ok: true; value: ContentDocumentV1 }).value;
      const merged = firstMergedText(c);
      expect(merged).toBe(sample + sample);
      expect(merged.length).toBe(sample.length * 2);
    }
    // NFC/NFD are NOT canonicalized: "é" precomposed vs e+combining stay distinct.
    const nfc = validateAnswerForQuestion(
      RICH_TEXT_QUESTION,
      oneRunDoc("\u00E9"),
    );
    const nfd = validateAnswerForQuestion(
      RICH_TEXT_QUESTION,
      oneRunDoc("e\u0301"),
    );
    expect(
      structuralEqual(
        (nfc as { value: unknown }).value,
        (nfd as { value: unknown }).value,
      ),
    ).toBe(false);
  });

  it("CRLF / LF / tabs: preserved verbatim in text runs and code blocks (no trim, no rewrite)", () => {
    const whitespace = "a\r\nb\nc\td";
    const textDoc = oneRunDoc(whitespace);
    const codeDoc: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [{ type: "codeBlock", language: "ts", text: whitespace }],
    };
    for (const d of [textDoc, codeDoc]) {
      const canonical = validateAnswerForQuestion(RICH_TEXT_QUESTION, d);
      expect(canonical.ok).toBe(true);
      expect(structuralEqual((canonical as { value: unknown }).value, d)).toBe(
        true,
      );
    }
  });

  it("JSON escaped Unicode round-trips to identical code units before the grammar sees it", () => {
    const escaped = JSON.parse('"\\u4e2d\\u6587"') as string;
    expect(escaped).toBe("中文");
    expect(escaped.length).toBe(2);
    const doc = oneRunDoc(escaped);
    const canonical = validateAnswerForQuestion(RICH_TEXT_QUESTION, doc);
    expect(canonical.ok).toBe(true);
    expect(structuralEqual((canonical as { value: unknown }).value, doc)).toBe(
      true,
    );
  });

  it("unicode boundary sweep (seed 0x66900001): closure holds for legal unicode docs below the merge floor", () => {
    // Deterministic sweep of unicode-rich docs with merged total ≤ 20000:
    // the merge class cannot fire, so closure must hold.
    const samples = ["中", "👍", "👨‍👩‍👧‍👦", "e\u0301", "\u200F", "\r\n", "\t"];
    let cases = 0;
    for (const s of samples) {
      for (const split of [1, 2, 3, 1000, 9999, 10000]) {
        if (s.length * split + s.length > CONTENT_LIMITS.textRun) continue;
        const input = twoRunDoc(s.repeat(split), s);
        cases += 1;
        const r = validateAnswerForQuestion(RICH_TEXT_QUESTION, input);
        expect(r.ok).toBe(true);
        const c = (r as { ok: true; value: ContentDocumentV1 }).value;
        expect(firstMergedText(c).length).toBeLessThanOrEqual(
          CONTENT_LIMITS.textRun,
        );
        expect(ContentDocumentV1Schema.safeParse(c).success).toBe(true);
      }
    }
    expect(cases).toBeGreaterThan(20);
  });
});
