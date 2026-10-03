/**
 * Phase-E Campaign R — canonical identity differential (L1, E-RP01/02
 * foundations). The replay protocol's identity digest must agree with the
 * domain's structural equality over mutation operators:
 *
 * For every generated canonical document and every mutation pair:
 *   - EQUIVALENCE mutations (split adjacent same-mark run, mark-order
 *     shuffle, JSON key-order shuffle) → contentDocumentsEqual(a, b) TRUE
 *     and canonicalAnswerIdentity(a) === canonicalAnswerIdentity(b);
 *   - the DISTINGUISHING mutation (append paragraph) → both FALSE/different.
 *
 * A divergence in either direction is authority drift: the engine would ACK
 * answers the domain calls different, or conflict answers the domain calls
 * equal.
 *
 * The equivalence mutations must also be CANONICALIZE-FIXED-POINT-stable:
 * canonicalize(mutation(a)) stays in the same identity class (N(d1) == N(d2)
 * after normalization, contract §3.1).
 */
import fc from "fast-check";
import { describe, expect, it, afterAll } from "vitest";
import { contentDocumentsEqual, type ContentDocumentV1 } from "@exam/domain";
import {
  ContentDocumentV1Schema,
  canonicalizeContentDocument,
} from "@exam/contracts";
import { canonicalAnswerIdentity } from "@exam/exam-engine";
import { arbitraryDocument, identityMutationPairs } from "./generators.js";
import { CampaignRecorder } from "./campaignStats.js";

const recorder = new CampaignRecorder("R-identity-differential", [0x669e0002]);
const NUM_RUNS = 200;

function isSchemaLegal(d: ContentDocumentV1): boolean {
  return ContentDocumentV1Schema.safeParse(d).success;
}

describe("Campaign R — canonical identity differential (L1, E-RP01/02)", () => {
  it("property: equivalence mutations share identity and domain equality; the distinguishing mutation shares neither", () => {
    let eqPairsChecked = 0;
    let distinctPairsChecked = 0;
    let schemaLegalDocs = 0;

    fc.assert(
      fc.property(arbitraryDocument("small"), (raw) => {
        // Identity is a WIRE-boundary authority: JSON round-trip drops
        // in-memory `marks: undefined` properties exactly like the transport
        // does, so the differential observes wire-representable values.
        if (!isSchemaLegal(raw)) return;
        const doc = JSON.parse(JSON.stringify(raw)) as ContentDocumentV1;
        if (!isSchemaLegal(doc)) return;
        schemaLegalDocs += 1;
        const pairs = identityMutationPairs(doc);
        for (const { name, other } of pairs) {
          // The engine's equality/identity domain is the CANONICAL value:
          // canonicalization runs before persistence, receipts and answersEqual
          // only ever see canonical documents. The differential therefore
          // compares canonicalize(doc) against canonicalize(mutation).
          const c1 = canonicalizeContentDocument(doc);
          const c2 = canonicalizeContentDocument(other);
          if (!c1.ok || !c2.ok) continue; // legal rejection — out of identity scope
          const label = `${name}`;
          const domainEqual = contentDocumentsEqual(c1.value, c2.value);
          const identityEqual =
            canonicalAnswerIdentity(c1.value) ===
            canonicalAnswerIdentity(c2.value);
          if (name === "append-paragraph") {
            // Distinguishing mutation: domain says different, identity too.
            expect(
              domainEqual,
              `${label}: domain called distinct content equal`,
            ).toBe(false);
            expect(
              identityEqual,
              `${label}: identity digest collision across distinct content`,
            ).toBe(false);
            distinctPairsChecked += 1;
          } else {
            // Equivalence mutation: both authorities must agree on equality.
            expect(
              domainEqual,
              `${label}: domain equality missed an equivalence (E-RP01 broken)`,
            ).toBe(true);
            expect(
              identityEqual,
              `${label}: identity digest missed an equivalence (replay would CONFLICT)`,
            ).toBe(true);
            eqPairsChecked += 1;
          }
        }
      }),
      { numRuns: NUM_RUNS, seed: 0x669e0002 },
    );

    recorder.record({
      probe: "identity-differential-summary",
      outcome: "done",
      schemaLegalDocs,
      eqPairsChecked,
      distinctPairsChecked,
    });
    // Composition census: the property must actually exercise both classes.
    expect(schemaLegalDocs).toBeGreaterThan(40);
    expect(eqPairsChecked).toBeGreaterThan(60);
    expect(distinctPairsChecked).toBeGreaterThan(20);
  });

  afterAll(() => {
    recorder.flush();
  });
});
