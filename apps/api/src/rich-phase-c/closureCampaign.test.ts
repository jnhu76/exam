/**
 * Phase-C Campaign A (#669) — canonicalization closure + idempotence.
 *
 * Oracle (RC-03, frozen by docs/architecture/rich-content-semantic-contract.md):
 *   successfulCanonicalize(d) = c  ⇒  Schema(c) ∧ Limits(c) ∧ preflight(c)
 *   ∧ Normalize(c) == c ∧ successfulCanonicalize(c) == c.
 *
 * Everything exercised here is the real production stack: the wire schema
 * (ContentDocumentV1Schema), the production canonicalization seam
 * (validateAnswerForQuestion bound to a rich text_response snapshot), the
 * domain kernel (normalize / limits / preflight). No normalize logic is
 * reimplemented; structuralEqual is oracle-side identity only.
 *
 * Budget (Phase-C §5): ≤1000 generated cases per campaign, deterministic seed,
 * bounded wall time.
 */

import { describe, expect, it } from "vitest";
import { ContentDocumentV1Schema } from "@exam/contracts";
import {
  checkContentDocumentLimits,
  normalizeContentDocument,
  preflightContentDocumentStructure,
  type ContentDocumentV1,
  type QuestionSnapshot,
} from "@exam/domain";
import { validateAnswerForQuestion } from "../lib/validateAnswerForQuestion.js";
import {
  generateDoc,
  mulberry32,
  shrinkDoc,
  structuralEqual,
} from "./generators.js";

const RICH_TEXT_QUESTION: QuestionSnapshot = {
  originalQuestionId: "phase-c-rich-q",
  type: "text_response",
  content: "rich answer question",
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

type CanonicalizeResult = ReturnType<typeof validateAnswerForQuestion>;

interface ClosureVerdict {
  ok: boolean;
  stage?: string;
  detail?: string;
}

/**
 * Full RC-03 closure oracle against the production canonicalization seam.
 * ILLEGAL inputs (schema-invalid) are not closure failures — they are
 * counted by the campaign as outside the legal set.
 */
function closureOracle(d: unknown): ClosureVerdict | "ILLEGAL_INPUT" {
  const gate = ContentDocumentV1Schema.safeParse(d);
  if (!gate.success) return "ILLEGAL_INPUT";

  const first: CanonicalizeResult = validateAnswerForQuestion(
    RICH_TEXT_QUESTION,
    d,
  );
  if (!first.ok) {
    return {
      ok: false,
      stage: "canonicalize(d)",
      detail: `schema-valid input rejected by canonicalizer: ${first.reason}`,
    };
  }
  const c = first.value as ContentDocumentV1;

  const pf = preflightContentDocumentStructure(c);
  if (pf.length > 0) {
    return { ok: false, stage: "preflight(c)", detail: pf.join("; ") };
  }
  const schemaAgain = ContentDocumentV1Schema.safeParse(c);
  if (!schemaAgain.success) {
    return {
      ok: false,
      stage: "schema(c)",
      detail: JSON.stringify(schemaAgain.error.issues),
    };
  }
  const limits = checkContentDocumentLimits(c);
  if (limits.length > 0) {
    return { ok: false, stage: "limits(c)", detail: limits.join("; ") };
  }
  if (!structuralEqual(normalizeContentDocument(c), c)) {
    return { ok: false, stage: "normalize(c) == c" };
  }
  const second = validateAnswerForQuestion(RICH_TEXT_QUESTION, c);
  if (!second.ok) {
    return { ok: false, stage: "canonicalize(c)", detail: second.reason };
  }
  if (!structuralEqual(second.value, c)) {
    return { ok: false, stage: "canonicalize(c) == c" };
  }
  return { ok: true };
}

describe("Phase-C Campaign A — canonicalization closure (RC-03)", () => {
  it("B-F01 seed: 20000+1 adjacent same-mark runs produce a canonical value the same system rejects", () => {
    const seed: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a".repeat(20000) },
            { type: "text", text: "b" },
          ],
        },
      ],
    };

    // Input is inside the legal set (each run within textRun, within all limits).
    expect(ContentDocumentV1Schema.safeParse(seed).success).toBe(true);

    const canonical = validateAnswerForQuestion(RICH_TEXT_QUESTION, seed);
    expect(canonical.ok).toBe(true);
    const c = (canonical as { ok: true; value: ContentDocumentV1 }).value;

    // Merged run exceeds textRun → same system rejects the canonical output.
    const merged = c.content[0] as {
      type: string;
      content: Array<{ text: string }>;
    };
    expect(merged.content).toHaveLength(1);
    expect(merged.content[0]?.text).toHaveLength(20001);
    expect(ContentDocumentV1Schema.safeParse(c).success).toBe(false);
    // Rejection shape: the limits walker (and the schema's limits superRefine)
    // reject; the structural preflight passes it (it bounds raw size/depth,
    // not per-run product limits) — the closure break is limits-side only.
    expect(checkContentDocumentLimits(c)).toEqual([
      "text run exceeds 20000 chars",
    ]);
    expect(preflightContentDocumentStructure(c)).toEqual([]);
    // Persisted canonical value cannot be re-accepted by the read system.
    expect(validateAnswerForQuestion(RICH_TEXT_QUESTION, c).ok).toBe(false);
  });

  it("shrunken B-F01 class floor: 20001 total chars across two same-mark runs is the minimal fixture", () => {
    // The class floor: each run ≤ textRun (20000), merged total must exceed
    // 20000 → minimum failing total is 20001 = 20000 + 1.
    const floor: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a".repeat(20000) },
            { type: "text", text: "b" },
          ],
        },
      ],
    };
    expect(typeof closureOracle(floor) === "object").toBe(true);

    // One char less total stays closed.
    const below: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a".repeat(19999) },
            { type: "text", text: "b" },
          ],
        },
      ],
    };
    expect(closureOracle(below)).toEqual({ ok: true });
  });

  it("boundary sweep: textRun limit-1/limit/limit+1 per split position stays closed below 20001 total", () => {
    // No closure failure may exist with total ≤ 20000 (each individual run and
    // every possible merge stays within textRun). Spot-check the split space
    // around the boundary deterministically.
    for (const first of [19997, 19998, 19999, 20000]) {
      for (const second of [0, 1, 2, 3]) {
        const doc: ContentDocumentV1 = {
          docVersion: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "a".repeat(first) },
                ...(second > 0
                  ? [{ type: "text" as const, text: "b".repeat(second) }]
                  : []),
              ],
            },
          ],
        };
        const verdict = closureOracle(doc);
        const total = first + second;
        if (total <= 20000) {
          expect(verdict).toEqual({ ok: true });
        } else {
          expect(typeof verdict === "object" && !verdict.ok).toBe(true);
        }
      }
    }
  });

  it("generated campaign (seed 0x66900001, 1000 cases): every closure failure is the known textRun-merge class (B-F01); any other class is flagged", () => {
    const rng = mulberry32(0x66900001);
    const CASES = 1000;
    let legal = 0;
    const failures: Array<{
      shape: string;
      stage?: string;
      detail?: string;
      shrunkTotal: number;
      shrunkRunCount: number;
      shrunk: ContentDocumentV1;
    }> = [];

    const fails = (candidate: ContentDocumentV1): boolean => {
      const verdict = closureOracle(candidate);
      return verdict !== "ILLEGAL_INPUT" && !verdict.ok;
    };

    for (let i = 0; i < CASES; i++) {
      const { doc, shape } = generateDoc(rng, true);
      const verdict = closureOracle(doc);
      if (verdict === "ILLEGAL_INPUT") continue;
      legal += 1;
      if (!verdict.ok) {
        const shrunk = shrinkDoc(doc, fails);
        const shrunkRuns =
          (shrunk.content[0] as { content?: Array<unknown> })?.content ?? [];
        failures.push({
          shape,
          ...(verdict.stage !== undefined ? { stage: verdict.stage } : {}),
          ...(verdict.detail !== undefined ? { detail: verdict.detail } : {}),
          shrunkTotal: JSON.stringify(shrunk).length,
          shrunkRunCount: shrunkRuns.length,
          shrunk,
        });
        if (failures.length >= 5) break;
      }
    }

    // The merge class MUST be found by the boundary-biased campaign (it is the
    // B-F01 class). Every failure must belong to that known class — the oracle
    // reports stage "schema(c)" (schema superRefine runs the limits walker) or
    // "limits(c)"; any other stage is a NEW defect class and fails the campaign.
    expect(failures.length).toBeGreaterThan(0);
    for (const f of failures) {
      // The closure failure lives on the CANONICAL OUTPUT of the shrunk input
      // (normalize merges adjacent same-mark runs), not on the input itself.
      const canonical = validateAnswerForQuestion(RICH_TEXT_QUESTION, f.shrunk);
      expect(canonical.ok).toBe(true);
      const co = (canonical as { ok: true; value: ContentDocumentV1 }).value;
      // Input stays inside the legal set; output leaves it (closure break).
      expect(ContentDocumentV1Schema.safeParse(f.shrunk).success).toBe(true);
      expect(ContentDocumentV1Schema.safeParse(co).success).toBe(false);
      // The violated invariant is exactly the textRun product limit (B-F01 class).
      expect(checkContentDocumentLimits(co)).toEqual([
        "text run exceeds 20000 chars",
      ]);
    }
  }, 30_000);

  it("generated campaign, plain sizes (seed 0x67300001, 1000 cases): closure holds for small mixed structures", () => {
    const rng = mulberry32(0x67300001);
    const CASES = 1000;
    let legal = 0;
    const failures: Array<{
      stage?: string;
      detail?: string;
      fixture: ContentDocumentV1;
    }> = [];
    for (let i = 0; i < CASES; i++) {
      const { doc } = generateDoc(rng, false);
      const verdict = closureOracle(doc);
      if (verdict === "ILLEGAL_INPUT") continue;
      legal += 1;
      if (!verdict.ok) {
        failures.push({
          ...(verdict.stage !== undefined ? { stage: verdict.stage } : {}),
          ...(verdict.detail !== undefined ? { detail: verdict.detail } : {}),
          fixture: doc,
        });
      }
    }
    expect({ legalCases: legal, failures }).toMatchObject({ failures: [] });
    // CI runs ~4x slower than local under v8 coverage instrumentation; the
    // full-1000-case sweep has no early exit. Budget headroom stays inside the
    // documented <=60s campaign envelope.
  }, 30_000);

  it("idempotence sweep: normalize is a fixed point on every canonical output it produces", () => {
    const rng = mulberry32(0x68100001);
    for (let i = 0; i < 500; i++) {
      const { doc } = generateDoc(rng, true);
      const gate = ContentDocumentV1Schema.safeParse(doc);
      if (!gate.success) continue;
      const c = normalizeContentDocument(gate.data);
      // Idempotence itself (independent of closure): N(N(d)) == N(d).
      expect(structuralEqual(normalizeContentDocument(c), c)).toBe(true);
    }
  });
});
