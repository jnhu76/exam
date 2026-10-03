/**
 * Phase-E Campaign S — plainTextProjection purity differential (L1, E-WR02
 * foundations). The projection feeds questions.content, SQL search, CSV
 * export and every plain display fallback, so it must be a DERIVATION only:
 *
 *   1. PURE / READ-ONLY: a deep-frozen input document is never mutated
 *      (strict-mode write would throw; a structural witness double-checks).
 *   2. DETERMINISTIC: repeated calls and a wire round-trip of the same
 *      document yield the identical string.
 *   3. CANONICAL FIXED POINT: for a canonicalized value, re-canonicalization
 *      can never move the projection — this is what makes E-WR02's stored
 *      `content` permanently equal to a read-side recomputation from the
 *      stored document. (The raw-input claim P(d) === P(C(d)) is NOT part of
 *      the contract: normalization intentionally drops empty structural
 *      artifacts, e.g. trailing empty paragraphs inside list items.)
 *   4. EQUIVALENCE-INVARIANT: split-adjacent-run, mark-order-shuffle and
 *      key-order-shuffle — the mutations canonicalization erases — leave the
 *      raw projection untouched; the distinguishing append-paragraph moves it.
 *
 * A purity violation here would make every derived consumer (search index,
 * export, fallback display) observe write-order-dependent text.
 */
import fc from "fast-check";
import { describe, expect, it, afterAll } from "vitest";
import { plainTextProjection, type ContentDocumentV1 } from "@exam/domain";
import {
  canonicalizeContentDocument,
  ContentDocumentV1Schema,
} from "@exam/contracts";
import {
  arbitraryDocument,
  exactLimitDocs,
  identityMutationPairs,
} from "./generators.js";
import { CampaignRecorder } from "./campaignStats.js";

const recorder = new CampaignRecorder("S-projection-purity", [0x669e0003]);
const NUM_RUNS = 200;

function isSchemaLegal(d: ContentDocumentV1): boolean {
  return ContentDocumentV1Schema.safeParse(d).success;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe("Campaign S — plainTextProjection purity (L1, E-WR02)", () => {
  it("property: projection is read-only, deterministic, a canonical fixed point, and equivalence-invariant", () => {
    let schemaLegalDocs = 0;
    let canonicalDocs = 0;
    let canonicalFixedPoints = 0;
    let eqPairsChecked = 0;
    let distinctPairsChecked = 0;

    fc.assert(
      fc.property(arbitraryDocument("small"), (raw) => {
        if (!isSchemaLegal(raw)) return;
        // Wire representation first (drops in-memory `marks: undefined`),
        // then deep-freeze: any in-place write inside the projection throws
        // TypeError in strict-mode ESM and fails the run.
        const doc = deepFreeze(
          JSON.parse(JSON.stringify(raw)) as ContentDocumentV1,
        );
        const witness = JSON.parse(JSON.stringify(raw)) as ContentDocumentV1;
        schemaLegalDocs += 1;

        const started = Date.now();
        const p1 = plainTextProjection(doc);
        const elapsed = Date.now() - started;

        // Determinism: same input, same string — repeated and wire-shaped.
        expect(plainTextProjection(doc)).toBe(p1);
        expect(
          plainTextProjection(
            JSON.parse(JSON.stringify(raw)) as ContentDocumentV1,
          ),
        ).toBe(p1);

        // Canonical fixed point: the stored canonical document's projection
        // is stable under re-canonicalization (read-path recomputation).
        const c1 = canonicalizeContentDocument(doc);
        if (c1.ok) {
          canonicalDocs += 1;
          const c2 = canonicalizeContentDocument(c1.value);
          expect(c2.ok).toBe(true);
          if (c2.ok) {
            canonicalFixedPoints += 1;
            expect(plainTextProjection(c2.value)).toBe(
              plainTextProjection(c1.value),
            );
          }
        }

        // Equivalence mutations must not move the raw projection; the
        // distinguishing mutation must.
        for (const { name, other } of identityMutationPairs(doc)) {
          deepFreeze(other);
          const pOther = plainTextProjection(other);
          if (name === "append-paragraph") {
            expect(
              pOther,
              "append-paragraph: distinguishing mutation did not move the projection",
            ).not.toBe(p1);
            distinctPairsChecked += 1;
          } else {
            expect(
              pOther,
              `${name}: projection moved under an equivalence mutation`,
            ).toBe(p1);
            eqPairsChecked += 1;
          }
        }

        // Mutation witness: the frozen input is structurally untouched.
        expect(doc).toEqual(witness);
        // Headroom-rich bound: projection of even boundary-size documents is
        // linear and sub-millisecond; this only catches accidental
        // superlinear blowups, not machine load (flake discipline).
        expect(elapsed).toBeLessThan(2000);
      }),
      { numRuns: NUM_RUNS, seed: 0x669e0003 },
    );

    recorder.record({
      probe: "projection-purity-summary",
      outcome: "done",
      schemaLegalDocs,
      canonicalDocs,
      canonicalFixedPoints,
      eqPairsChecked,
      distinctPairsChecked,
    });
    // Composition census: the property must actually exercise all classes.
    expect(schemaLegalDocs).toBeGreaterThan(40);
    expect(canonicalDocs).toBeGreaterThan(40);
    expect(canonicalFixedPoints).toBeGreaterThan(40);
    expect(eqPairsChecked).toBeGreaterThan(60);
    expect(distinctPairsChecked).toBeGreaterThan(20);
  });

  it("boundary grid: projection stays pure and deterministic at every CONTENT_LIMITS edge", () => {
    const grid = exactLimitDocs();
    let checked = 0;
    for (const { name, doc } of grid) {
      if (!isSchemaLegal(doc)) continue;
      const frozen = deepFreeze(
        JSON.parse(JSON.stringify(doc)) as ContentDocumentV1,
      );
      const witness = JSON.parse(JSON.stringify(doc)) as ContentDocumentV1;
      const started = Date.now();
      const p1 = plainTextProjection(frozen);
      expect(plainTextProjection(frozen), `${name}: nondeterministic`).toBe(p1);
      const elapsed = Date.now() - started;
      expect(frozen, `${name}: mutated the input`).toEqual(witness);
      expect(elapsed, `${name}: projection not bounded`).toBeLessThan(2000);
      checked += 1;
    }
    recorder.record({ probe: "boundary-grid", outcome: "done", checked });
    // Every clean-limit grid entry must have survived the schema filter and
    // been exercised (over-limit entries are schema-illegal by design).
    expect(checked).toBe(grid.filter((d) => d.expectLimitsClean).length);
  });

  afterAll(() => {
    recorder.flush();
  });
});
