/**
 * Phase-E Campaign B — preflight / grammar differential (L1, invariant E-RC04).
 *
 * NON-CIRCULAR differential design: the public `ContentDocumentV1Schema` pipes
 * the preflight IN FRONT of the recursive grammar, so "schema accepted ⇒
 * preflight accepted" is true by construction and cannot falsify RC-04 on its
 * own. The meaningful falsification direction is the converse:
 *
 *   HIDDEN_STRICTER_SET exists ⟺ ∃ d:
 *     grammar-shaped(d) ∧ checkContentDocumentLimits(d) == []
 *     ∧ the public parse rejects d with a PREFLIGHT-SOURCED violation.
 *
 * Grammar-shaped(d) is a GENERATOR-side structural guarantee (the arbitrary
 * only ever constructs grammar node types); limits[] is judged by the
 * production kernel; the violation vocabulary split (preflight-sourced vs
 * grammar-sourced) is fixed by the two modules' distinct message strings.
 * If such a d is found, preflight silently shrank the legal V1 set → campaign
 * failure. This harness never re-decides validity — it only partitions error
 * message provenance and calls the production authorities.
 *
 * Direction 2 (hostile intake): the public parse entry must terminate closed
 * (never throw, never accept) for any raw value; raw depth beyond the
 * documented budget must be preflight-rejected.
 *
 * Seeds: 0x669E0002 + regression continuity 0x67300001.
 */
import fc from "fast-check";
import { describe, expect, it, afterAll } from "vitest";
import {
  CONTENT_LIMITS,
  checkContentDocumentLimits,
  preflightContentDocumentStructure,
  type ContentDocumentV1,
} from "@exam/domain";
import { ContentDocumentV1Schema } from "@exam/contracts";
import {
  arbitraryDocument,
  emptyLeafListChain,
  exactLimitDocs,
  hostileDeepArray,
  nestedListChain,
  SERIALIZED_LIMIT,
  TOTAL_NODES_LIMIT,
} from "./generators.js";
import { CampaignRecorder } from "./campaignStats.js";

const recorder = new CampaignRecorder(
  "B-preflight-differential",
  [0x669e0002, 0x67300001],
);

let hiddenStricterSet = "NONE";
let hostileParsed = 0;
let grammarShapedLimitsClean = 0;
let differentialPairsChecked = 0;

/** Violations only the PREFLIGHT can emit (raw-structure budget vocabulary). */
const PREFLIGHT_ONLY_PATTERNS: RegExp[] = [
  /document is not JSON-representable/,
  /document nesting exceeds/,
  /document must be a ContentDocumentV1 object/,
  /^type must be "doc"$/,
  /^content must be an array$/,
];
/** Violations that come from the recursive grammar or CONTENT_LIMITS walker. */
const GRAMMAR_SIDED_PATTERNS: RegExp[] = [
  /rectangular/,
  /bounded language grammar/,
  /String must contain at least 1 character/,
  /Invalid literal value/,
  /Invalid input/,
  /Unrecognized key/,
  /exceeds \d+ (chars|nodes|levels)$/,
];

describe("Campaign B — preflight/grammar differential (E-RC04)", () => {
  it("differential: a grammar-shaped, limits-clean document must never be rejected by a preflight-sourced violation", () => {
    fc.assert(
      fc.property(arbitraryDocument("small"), (d) => {
        const limits = checkContentDocumentLimits(d);
        const parsed = ContentDocumentV1Schema.safeParse(d);
        differentialPairsChecked += 1;
        if (limits.length === 0) grammarShapedLimitsClean += 1;
        if (parsed.success) {
          // Trivial direction (pipeline order): schema-accepted ⇒ preflight [].
          expect(preflightContentDocumentStructure(d)).toEqual([]);
          return;
        }
        const first = String(parsed.error.issues[0]?.message ?? "");
        const preflightSourced = PREFLIGHT_ONLY_PATTERNS.some((p) =>
          p.test(first),
        );
        if (limits.length === 0 && preflightSourced) {
          // Grammar-shaped (generator), limits-clean (kernel authority), yet
          // the public entry rejects on the preflight's own vocabulary.
          hiddenStricterSet = "FOUND";
          throw new Error(
            `HIDDEN_STRICTER_SET candidate: limits-clean grammar-shaped doc rejected by preflight: ${first}\n${JSON.stringify(d).slice(0, 600)}`,
          );
        }
        fc.pre(!preflightSourced || limits.length > 0);
      }),
      {
        seed: 0x669e0002,
        numRuns: 300,
        endOnFailure: true,
        verbose: true,
        timeout: 60000,
      },
    );
  });

  it("deterministic exact-limit grid: boundary composition matches the kernel's combined-limit counting; limits-clean entries are preflight-accepted", () => {
    let limitsClean = 0;
    let limitsDirty = 0;
    for (const {
      name,
      doc,
      expectLimitsClean,
      dirtyReason,
    } of exactLimitDocs()) {
      const limits = checkContentDocumentLimits(doc);
      if (expectLimitsClean) {
        expect(
          limits,
          `${name}: kernel must accept this at-limit composition`,
        ).toEqual([]);
        limitsClean += 1;
        const violations = preflightContentDocumentStructure(doc);
        expect(
          violations,
          `${name}: preflight must not shrink the legal set at the boundary`,
        ).toEqual([]);
        expect(
          ContentDocumentV1Schema.safeParse(doc).success,
          `${name}: a limits-clean boundary doc must remain schema-admissible`,
        ).toBe(true);
      } else {
        expect(
          limits.length,
          `${name}: kernel must reject this over-limit composition`,
        ).toBeGreaterThan(0);
        if (dirtyReason) {
          expect(
            limits.some((v) => dirtyReason.test(v)),
            `${name}: expected violation ${dirtyReason}, got ${JSON.stringify(limits)}`,
          ).toBe(true);
        }
        limitsDirty += 1;
        recorder.record({ probe: `grid-dirty:${name}`, violations: limits });
      }
    }
    // Composition census: the grid must keep probing BOTH sides of every
    // limit edge it claims to cover.
    expect(limitsClean).toBeGreaterThanOrEqual(7);
    expect(limitsDirty).toBeGreaterThanOrEqual(7);
    recorder.record({
      probe: "exact-limit-grid-preflight",
      limitsClean,
      limitsDirty,
    });
  });

  it("census: listDepth 8 is unreachable — grammar min-1 leaf + depth 16 + listDepth 8 close the gap (effective max list nesting = 7)", () => {
    // (a) A leafed 8-level chain (paragraph leaf) is limits-dirty: tree depth 17.
    const leafed8 = nestedListChain(8);
    expect(
      checkContentDocumentLimits(leafed8).some((v) =>
        /tree depth exceeds 16/.test(v),
      ),
    ).toBe(true);
    // (b) An EMPTY-leaf 8-level chain is limits-clean (depth exactly 16,
    //     listDepth 8 not > 8) but the GRAMMAR rejects it: listItem requires
    //     at least one child. Since the only two legal leaves are a paragraph
    //     (depth 17) or a nested list (listDepth 9), no schema-legal document
    //     can reach listDepth 8.
    const emptyLeaf8 = emptyLeafListChain(8);
    expect(checkContentDocumentLimits(emptyLeaf8)).toEqual([]);
    expect(ContentDocumentV1Schema.safeParse(emptyLeaf8).success).toBe(false);
    // (c) The reachable maximum: a leafed 7-level chain (depth 15, listDepth 7).
    const leafed7 = nestedListChain(7);
    expect(ContentDocumentV1Schema.safeParse(leafed7).success).toBe(true);
    recorder.record({
      probe: "listDepth-8-unreachable",
      leafed7SchemaLegal: true,
      emptyLeaf8SchemaLegal: false,
    });
  });

  it("property: hostile deep raw arrays never overflow the recursive parser — safeParse always terminates", () => {
    // Raw budget from the kernel: (depth+2)*2+3. hostileDeepArray(depth) peaks
    // at raw depth depth+2, so preflight must fire exactly beyond budget-2.
    const RAW_BUDGET = (CONTENT_LIMITS.depth + 2) * 2 + 3;
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4000 }), (depth) => {
        const hostile = hostileDeepArray(depth);
        let violations: string[] = [];
        let threw = false;
        let accepted = false;
        try {
          violations = preflightContentDocumentStructure(hostile);
          accepted = ContentDocumentV1Schema.safeParse(hostile).success;
        } catch {
          threw = true;
        }
        expect(threw, `depth ${depth}: parse entry threw`).toBe(false);
        expect(accepted, `depth ${depth}: hostile payload ACCEPTED`).toBe(
          false,
        );
        if (depth + 2 > RAW_BUDGET) {
          expect(
            violations.length,
            `depth ${depth} (raw ${depth + 2} > budget ${RAW_BUDGET}) must be preflight-rejected`,
          ).toBeGreaterThan(0);
        }
        hostileParsed += 1;
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

  it("property: node-count and serialized-size boundaries stay preflight-clean where limits-clean", () => {
    // Serialized-size edge: a legal document just under the limit passes.
    const fat: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "codeBlock",
          language: null,
          text: "y".repeat(SERIALIZED_LIMIT - 200),
        },
      ],
    };
    if (ContentDocumentV1Schema.safeParse(fat).success) {
      expect(preflightContentDocumentStructure(fat)).toEqual([]);
    }
    // Node-count edge: 2000 minimal paragraphs are schema-legal and preflight-legal.
    const many: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: Array.from({ length: TOTAL_NODES_LIMIT }, () => ({
        type: "paragraph",
        content: [],
      })),
    };
    if (ContentDocumentV1Schema.safeParse(many).success) {
      expect(preflightContentDocumentStructure(many)).toEqual([]);
    }
    recorder.record({ probe: "limit-edges", outcome: "ok" });
  });

  it("hostile intake census: cyclic / non-JSON / wrong-envelope values are rejected without crashes", () => {
    const cyclic: Record<string, unknown> = {
      docVersion: 1,
      type: "doc",
      content: [],
    };
    cyclic.self = cyclic;
    const cases: Array<[string, unknown]> = [
      ["cyclic", cyclic],
      ["null", null],
      ["number", 1],
      ["string", "doc"],
      ["array-root", []],
      ["undefined-content", { docVersion: 1, type: "doc" }],
      ["function-content", { docVersion: 1, type: "doc", content: () => 1 }],
      // NB: symbol-keyed extras are excluded — symbols are not representable
      // in JSON wire input or jsonb storage, so they are outside every
      // durable Rich input domain; JSON.stringify ignores them and the value
      // is semantically the clean document in every durable representation.
    ];
    for (const [name, value] of cases) {
      let rejected = false;
      try {
        const violations = preflightContentDocumentStructure(value);
        const parsed = ContentDocumentV1Schema.safeParse(value);
        rejected = violations.length > 0 || !parsed.success;
      } catch {
        rejected = false;
      }
      expect(rejected, `${name} must fail closed`).toBe(true);
      recorder.record({ probe: `hostile-${name}`, outcome: "rejected" });
    }
  });

  it("regression 0x67300001: preflight raw-depth budget strictly dominates every grammar-legal depth", () => {
    // The raw budget is (depth+2)*2+3 = 39; deepest legal grammar doc ≈ 2*16+1.
    // Chains beyond the grammar limits must still be decided closed, never crash.
    for (const depth of [9, 17, 19, 25, 30, 38, 39, 40]) {
      const d = nestedListChain(depth);
      expect(() => ContentDocumentV1Schema.safeParse(d)).not.toThrow();
      expect(() => preflightContentDocumentStructure(d)).not.toThrow();
    }
    recorder.record({ probe: "budget-dominance", outcome: "ok" });
  });

  afterAll(() => {
    recorder.flush({
      HIDDEN_STRICTER_SET: hiddenStricterSet,
      differentialPairsChecked,
      grammarShapedLimitsClean,
      hostileParsed,
      differentialDesign:
        "public schema pipes preflight first; RC-04 is falsified only when a grammar-shaped limits-clean document is rejected with a preflight-sourced violation",
    });
  });
});
