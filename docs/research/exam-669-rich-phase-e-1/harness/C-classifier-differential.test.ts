/**
 * Phase-E Campaign C — dual classifier differential (L1, invariants E-RD01–RD03).
 *
 * The two context-specific classifiers legitimately differ in provenance
 * vocabulary (plain / legacy_plain / empty vs prompt-mode plain). But for the
 * SHARED non-null Rich document domain the Rich-state judgment must be
 * IDENTICAL: rich_valid / rich_noncanonical / unsupported_version / corrupt.
 * A disagreement in shared Rich validity is authority drift.
 *
 * Seeds: 0x669E0003 + regression continuity 0x68100001.
 */
import fc from "fast-check";
import { describe, expect, it, afterAll } from "vitest";
import type { ContentDocumentV1 } from "@exam/domain";
import {
  classifyPersistedQuestionContent,
  classifyPersistedRichAnswer,
} from "@exam/contracts";
import { arbitraryDocument } from "./generators.js";
import { CampaignRecorder } from "./campaignStats.js";

const recorder = new CampaignRecorder(
  "C-classifier-differential",
  [0x669e0003, 0x68100001],
);

const SHARED_KINDS = new Set([
  "rich_valid",
  "rich_noncanonical",
  "unsupported_version",
  "corrupt",
]);

function assertSharedDomainAgreement(v: unknown, label: string): void {
  const answer = classifyPersistedRichAnswer({ value: v, answerMode: "rich" });
  const question = classifyPersistedQuestionContent(v);
  // The answer classifier (rich mode, no provenance) and the question
  // classifier share the identical Rich interpretation primitive sequence.
  expect(
    answer.kind,
    `${label}: answer classifier left the shared domain`,
  ).toSatisfy((k: string) => SHARED_KINDS.has(k));
  expect(
    question.kind,
    `${label}: question classifier left the shared domain`,
  ).toSatisfy((k: string) => SHARED_KINDS.has(k));
  expect(
    answer.kind,
    `${label}: AUTHORITY DRIFT — answer=${answer.kind} question=${question.kind}`,
  ).toBe(question.kind);
  recorder.record({
    probe: label,
    answer: answer.kind,
    question: question.kind,
  });
}

/** Mutations that explore the shared-domain boundary of any document. */
function boundaryMutations(d: ContentDocumentV1): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const c = clone(d);
  // docVersion numeric handling: NaN, 0, -1, 1.5, 2, "1", 1 (as-is).
  for (const v of [2, 0, -1, 1.5, Number.NaN, "1"]) {
    const m = clone(d);
    (m as { docVersion: unknown }).docVersion = v;
    out.push([`docVersion=${String(v)}`, m]);
  }
  out.push(["missing-type", { ...c, type: undefined }]);
  out.push(["wrong-type", { ...c, type: "not-doc" }]);
  out.push(["content-not-array", { ...c, content: {} }]);
  out.push(["extra-key", { ...c, hostile: true }]);
  out.push(["array-root", [c]]);
  out.push(["number", 7]);
  out.push(["string", "plain text"]);
  out.push([
    "deep-hostile",
    (() => {
      let node: unknown = "x";
      for (let i = 0; i < 3000; i++) node = [node];
      return { ...c, content: node };
    })(),
  ]);
  out.push([
    "off-grammar-node",
    {
      ...c,
      content: [{ type: "image", attrs: { src: "x" } }],
    },
  ]);
  out.push([
    "text-over-limit",
    {
      ...c,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x".repeat(20_001) }],
        },
      ],
    },
  ]);
  return out;
}

describe("Campaign C — dual classifier differential (E-RD01..RD03)", () => {
  it("property: shared Rich-domain judgment is identical across both classifiers (generated corpus)", () => {
    fc.assert(
      fc.property(
        arbitraryDocument("tiny"),
        fc.integer({ min: 0, max: 9 }),
        (d, pick) => {
          const mutations = boundaryMutations(d);
          const [label, value] = mutations[pick % mutations.length];
          assertSharedDomainAgreement(value, label);
        },
      ),
      {
        seed: 0x669e0003,
        numRuns: 600,
        endOnFailure: true,
        verbose: true,
        timeout: 60000,
      },
    );
  });

  it("property: unmutated schema-admissible docs agree (typically rich_valid / rich_noncanonical)", () => {
    fc.assert(
      fc.property(arbitraryDocument("small"), (d) => {
        const answer = classifyPersistedRichAnswer({
          value: d,
          answerMode: "rich",
        });
        const question = classifyPersistedQuestionContent(d);
        expect(answer.kind).toBe(question.kind);
      }),
      {
        seed: 0x669e0003,
        numRuns: 150,
        endOnFailure: true,
        verbose: true,
        timeout: 60000,
      },
    );
  });

  it("regression 0x68100001: near-limit documents agree and unexplained Rich-slot strings stay corrupt in BOTH", () => {
    // Unexplained string on a rich-authoritative slot: corrupt in both.
    expect(
      classifyPersistedRichAnswer({ value: "legacy", answerMode: "rich" }).kind,
    ).toBe("corrupt");
    expect(classifyPersistedQuestionContent("legacy").kind).toBe("corrupt");
    // …and provenance only moves the ANSWER classifier to legacy_plain.
    expect(
      classifyPersistedRichAnswer({
        value: "legacy",
        answerMode: "rich",
        legacyPlainProvenance: true,
      }).kind,
    ).toBe("legacy_plain");
    // Empty/non-null mapping difference is allowed: null → empty vs plain.
    expect(
      classifyPersistedRichAnswer({ value: null, answerMode: "rich" }).kind,
    ).toBe("empty");
    expect(classifyPersistedQuestionContent(null).kind).toBe("plain");
    recorder.record({ probe: "provenance-and-null-mapping", outcome: "ok" });
  });

  it("regression: objective typed answers never enter Rich interpretation (export policy, E-EX02)", async () => {
    const { resolveExportAnswerView } =
      await import("@exam/api/src/lib/attemptExportAnswer.js");
    // boolean / array / record answers on non-text_response slots are typed
    // protocol answers — never corrupt-Rich.
    for (const [type, value] of [
      ["true_false", true],
      ["multiple_choice", ["a", "b"]],
      ["fill_blank", { "blank-1": "x" }],
      ["single_choice", "a"],
    ] as const) {
      const view = resolveExportAnswerView({
        questionType: type,
        answerMode: null,
        value,
      });
      expect(view.integrity, `${type} ${JSON.stringify(value)}`).toBe("plain");
      expect(view.projection).not.toBeNull();
    }
    recorder.record({ probe: "objective-slots-outside-rich", outcome: "ok" });
  });

  afterAll(() => {
    recorder.flush({});
  });
});
