/**
 * Phase-E Campaign A — canonicalization algebra (L1, invariant E-RC03).
 *
 * Attacks the post-D5.1 kernel: for every generated schema-admissible input d
 * where canonicalization succeeds with c, the SAME authority must accept c
 * (schema + limits + normalize fixed point + idempotent canonicalization +
 * every read path classifies rich_valid + identity stability).
 *
 * Rejection is a legal outcome (D1 closure-by-rejection); an ACCEPTED output
 * outside the accepted set is the B-F01 counterexample class and fails the
 * campaign.
 *
 * Seeds: 0x669E0001 (new) + regression continuity 0x66900001.
 */
import fc from "fast-check";
import { describe, expect, it, afterAll } from "vitest";
import {
  CONTENT_LIMITS,
  checkContentDocumentLimits,
  normalizeContentDocument,
  plainTextProjection,
  type ContentDocumentV1,
} from "@exam/domain";
import {
  ContentDocumentV1Schema,
  canonicalizeContentDocument,
} from "@exam/contracts";
import { classifyPersistedQuestionContent } from "@exam/contracts";
import { classifyPersistedRichAnswer } from "@exam/contracts";
import { canonicalAnswerIdentity } from "@exam/exam-engine";
import {
  arbitraryDocument,
  exactLimitDocs,
  nearLimitMergeGrid,
  nestedListChain,
} from "./generators.js";
import { CampaignRecorder } from "./campaignStats.js";

const recorder = new CampaignRecorder(
  "A-canonical-algebra",
  [0x669e0001, 0x66900001],
);
const NUM_RUNS = 300;

function structuralEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function assertClosure(d: ContentDocumentV1, label: string): void {
  const canonical = canonicalizeContentDocument(d);
  if (!canonical.ok) {
    // Legal rejection. The only forbidden shape is accept-then-reject.
    recorder.record({
      probe: label,
      outcome: "rejected",
      reason: canonical.reason,
    });
    return;
  }
  const c = canonical.value;
  // RC-03 closure clauses, in contract order:
  expect(
    ContentDocumentV1Schema.safeParse(c).success,
    `${label}: canonical output must pass the schema`,
  ).toBe(true);
  expect(
    checkContentDocumentLimits(c),
    `${label}: canonical output must pass CONTENT_LIMITS`,
  ).toEqual([]);
  expect(
    structuralEqual(normalizeContentDocument(c), c),
    `${label}: Normalize(c) == c`,
  ).toBe(true);
  const again = canonicalizeContentDocument(c);
  expect(
    again.ok && structuralEqual(again.value, c),
    `${label}: canonicalize(c) == c`,
  ).toBe(true);
  // Every supported read path must classify the accepted output rich_valid.
  expect(
    classifyPersistedRichAnswer({ value: c, answerMode: "rich" }).kind,
    `${label}: answer classifier`,
  ).toBe("rich_valid");
  expect(
    classifyPersistedQuestionContent(c).kind,
    `${label}: question classifier`,
  ).toBe("rich_valid");
  // Projection must terminate deterministically and identity must be stable.
  const p1 = plainTextProjection(c);
  const p2 = plainTextProjection(c);
  expect(p1).toBe(p2);
  expect(canonicalAnswerIdentity(c)).toBe(
    canonicalAnswerIdentity(
      normalizeContentDocument(JSON.parse(JSON.stringify(c))),
    ),
  );
  recorder.record({
    probe: label,
    outcome: "accepted",
    serialized: JSON.stringify(c).length,
  });
}

/**
 * Every schema rejection must be sourced by a PRODUCTION authority — the
 * preflight walker, the recursive grammar, or the CONTENT_LIMITS superRefine.
 * An unexplained rejection message would mean a hidden validation layer
 * decides Rich admissibility outside the documented authorities.
 */
function assertProductionSourcedRejection(
  d: ContentDocumentV1,
  label: string,
): number {
  const parsed = ContentDocumentV1Schema.safeParse(d);
  expect(parsed.success, `${label}: expected rejection`).toBe(false);
  if (parsed.success) return 0;
  const messages = parsed.error.issues.map((i) => String(i.message ?? ""));
  expect(
    messages.length,
    `${label}: rejection must carry issues`,
  ).toBeGreaterThan(0);
  for (const message of messages) {
    const sourced =
      PREFLIGHT_VOCABULARY.some((p) => p.test(message)) ||
      GRAMMAR_VOCABULARY.some((p) => p.test(message)) ||
      LIMITS_VOCABULARY.some((p) => p.test(message));
    expect(
      sourced,
      `${label}: unexplained rejection layer: ${message}\n${JSON.stringify(d).slice(0, 400)}`,
    ).toBe(true);
  }
  return messages.length;
}

const PREFLIGHT_VOCABULARY: RegExp[] = [
  /document is not JSON-representable/,
  /document nesting exceeds/,
  /document must be a ContentDocumentV1 object/,
  /^type must be "doc"$/,
  /^content must be an array$/,
  /^docVersion must be 1$/,
];
const GRAMMAR_VOCABULARY: RegExp[] = [
  /Invalid literal value/,
  /Invalid input/,
  /Unrecognized key/,
  /String must contain at least 1 character/,
  /Array must contain at least 1 element/,
  /bounded language grammar/,
  /inlineCode mark must not be combined/,
  /rectangular/,
];
const LIMITS_VOCABULARY: RegExp[] = [
  /exceeds \d+ (chars|nodes|levels)$/,
  /tree depth exceeds \d+/,
  /list nesting exceeds \d+/,
  /table exceeds \d+ (rows|cells)/,
];

describe("Campaign A — canonicalization closure algebra (E-RC03)", () => {
  it("property: schema-admissible docs → successful canonicalization is closed over schema/limits/idempotence/readability", () => {
    let acceptedChecks = 0;
    let rejectionChecks = 0;
    fc.assert(
      fc.property(arbitraryDocument("small"), (d) => {
        // BRANCH, don't fc.pre: rejected executions stay in the campaign as
        // rejection-sourcing checks (no regeneration amplification), accepted
        // executions run the full closure algebra.
        if (ContentDocumentV1Schema.safeParse(d).success) {
          assertClosure(d, "generated-small");
          acceptedChecks += 1;
        } else {
          assertProductionSourcedRejection(d, "generated-small");
          rejectionChecks += 1;
        }
      }),
      {
        seed: 0x669e0001,
        numRuns: NUM_RUNS,
        endOnFailure: true,
        verbose: true,
        timeout: 60000,
      },
    );
    // Composition census: the corpus must exercise BOTH sides of the schema
    // boundary (harness-internal; not a production oracle).
    expect(
      acceptedChecks,
      `closure algebra exercised only ${acceptedChecks}× / ${NUM_RUNS}`,
    ).toBeGreaterThanOrEqual(60);
    recorder.record({
      probe: "generated-small-split",
      acceptedChecks,
      rejectionChecks,
    });
  });

  it("property: same closure holds over boundary-biased generation near every CONTENT_LIMITS edge", () => {
    fc.assert(
      fc.property(arbitraryDocument("boundary"), (d) => {
        fc.pre(ContentDocumentV1Schema.safeParse(d).success);
        assertClosure(d, "generated-boundary");
      }),
      {
        seed: 0x669e0002,
        numRuns: 80,
        endOnFailure: true,
        verbose: true,
        timeout: 60000,
      },
    );
  });

  it("deterministic exact-limit grid: classification algebra over every CONTENT_LIMITS edge (accept-closes / schema-legal-reject-stays-noncanonical / schema-reject-stays-corrupt)", () => {
    const cases = [...exactLimitDocs(), ...nearLimitMergeGrid()];
    let accepted = 0;
    let canonicalRejected = 0;
    let schemaRejected = 0;
    let schemaRejectedCanonicalized = 0;
    for (const { name, doc } of cases) {
      const schemaOk = ContentDocumentV1Schema.safeParse(doc).success;
      if (!schemaOk) {
        schemaRejected += 1;
        // The persisted-read authority must hold the corrupt line for
        // schema-rejected Rich shapes — canonical trust never resurrects a
        // value the single parse authority rejected.
        expect(
          classifyPersistedQuestionContent(doc).kind,
          `${name}: schema-rejected doc must not read back as valid`,
        ).toBe("corrupt");
        // CENSUS (recorded, not asserted): canonicalize normalizes before it
        // re-parses, so a schema-rejected input CAN canonicalize cleanly when
        // normalization removes the offending shape (e.g. a node-count
        // violation built entirely from trailing empty paragraphs). This is
        // unreachable on the wire: every production canonicalize call site is
        // downstream of a ContentDocumentV1Schema parse (route validation,
        // validateAnswerForQuestion, both persisted classifiers).
        const c = canonicalizeContentDocument(doc);
        if (c.ok) schemaRejectedCanonicalized += 1;
        recorder.record({
          probe: `schema-rejected:${name}`,
          canonicalizeAccepted: c.ok,
        });
        continue;
      }
      const before = classifyPersistedQuestionContent(doc).kind;
      const canonical = canonicalizeContentDocument(doc);
      if (!canonical.ok) {
        canonicalRejected += 1;
        // Schema-legal but canonicalization rejects → the persisted judgment
        // is rich_noncanonical (interpretable, never valid, never corrupt).
        expect(before, name).toBe("rich_noncanonical");
        recorder.record({ probe: `canonical-rejected:${name}` });
        continue;
      }
      accepted += 1;
      assertClosure(doc, name);
    }
    recorder.record({
      probe: "exact-limit-grid",
      cases: cases.length,
      accepted,
      canonicalRejected,
      schemaRejected,
      schemaRejectedCanonicalized,
    });
  });

  it("property: normalize idempotence holds over the whole grammar-shaped corpus", () => {
    fc.assert(
      fc.property(arbitraryDocument("small"), (d) => {
        // normalize is total on grammar-shaped input (known node types only),
        // so idempotence is checked WITHOUT a schema gate — rejected-side
        // documents get the same guarantee.
        const once = normalizeContentDocument(d);
        const twice = normalizeContentDocument(once);
        expect(structuralEqual(twice, once)).toBe(true);
      }),
      {
        seed: 0x669e0003,
        numRuns: NUM_RUNS,
        endOnFailure: true,
        verbose: true,
        timeout: 60000,
      },
    );
  });

  it("regression 0x66900001 / B-F01 class: adjacent same-mark runs merging past textRun must REJECT, never accept an over-limit canonical", () => {
    const half = CONTENT_LIMITS.textRun - 5;
    const d: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x".repeat(half), marks: ["bold"] },
            { type: "text", text: "y".repeat(half), marks: ["bold"] },
          ],
        },
      ],
    };
    // Input itself is schema+limit legal; its canonical merge exceeds textRun.
    expect(ContentDocumentV1Schema.safeParse(d).success).toBe(true);
    const canonical = canonicalizeContentDocument(d);
    expect(canonical.ok).toBe(false);
    recorder.record({
      probe: "bf01-adjacent-merge",
      outcome: canonical.ok ? "accepted" : "rejected",
    });
  });

  it("regression 0x67300001: grammar-legal maximum-depth chain (listDepth/depth at limit) closes", () => {
    // depth 16 exactly: paragraph(1) wrapped by listDepth-8 chain… build the
    // deepest chain that stays inside both depth and listDepth budgets.
    for (const depth of [8, 12, 14, 15, 16, 17, 20]) {
      const d = nestedListChain(depth);
      const schemaOk = ContentDocumentV1Schema.safeParse(d).success;
      const canonical = canonicalizeContentDocument(d as ContentDocumentV1);
      if (schemaOk) {
        // Legal at this depth → closure must hold if canonicalization accepts;
        // over-listDepth inputs are rejected by the schema before canonicalize.
        if (canonical.ok) assertClosure(d, `nested-chain-${depth}`);
        else {
          // Rejection must agree with the classifier's canonical-trust verdict.
          const kind = classifyPersistedQuestionContent(d).kind;
          expect(kind).toBe("rich_noncanonical");
        }
      } else {
        expect(canonical.ok).toBe(false);
        recorder.record({
          probe: `nested-chain-${depth}`,
          outcome: "schema-rejected",
        });
      }
    }
  });

  it("regression 0x68100001: unnormalized legal doc stays rich_noncanonical and canonicalizes to rich_valid on write", () => {
    const d: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "a",
              marks: ["underline", "bold", "underline"],
            },
            { type: "text", text: "b", marks: ["bold", "underline"] },
            { type: "text", text: "" },
          ],
        },
      ],
    };
    expect(ContentDocumentV1Schema.safeParse(d).success).toBe(true);
    expect(classifyPersistedQuestionContent(d).kind).toBe("rich_noncanonical");
    const canonical = canonicalizeContentDocument(d);
    expect(canonical.ok).toBe(true);
    if (canonical.ok) {
      expect(classifyPersistedQuestionContent(canonical.value).kind).toBe(
        "rich_valid",
      );
    }
    recorder.record({ probe: "noncanonical-legal-roundtrip", outcome: "ok" });
  });

  afterAll(() => {
    recorder.flush({ numRunsMain: NUM_RUNS });
  });
});
