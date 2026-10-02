/**
 * Phase-C Campaign B (#669) — CONTENT_LIMITS vs preflight.
 *
 * Frozen rule (RC-04, contract §5): preflight is a bounded SAFETY mechanism;
 * it must not create an undocumented smaller semantic set for otherwise valid
 * V1 documents. CONTENT_LIMITS is the product legal-set authority.
 *
 * Method: documents are grammar-valid BY CONSTRUCTION (typed builders), then
 * checked with the production limits walker (`checkContentDocumentLimits`).
 * Any document that is within CONTENT_LIMITS but rejected by the production
 * preflight (`preflightContentDocumentStructure`) is an RC-04 counterexample.
 * Families reproduce the #673 C1 corpus and extend it. Per-shape boundaries
 * are located by binary search (deterministic, no randomness needed).
 *
 * Classification vocabulary (Phase-C §7):
 *   PRODUCT_LIMIT_FAILURE  — rejected by CONTENT_LIMITS (legal-set authority)
 *   SAFETY_LIMIT_FAILURE   — rejected by a declared safety budget
 *   HIDDEN_STRICTER_SET    — safety/preflight rejects a within-limits document
 *   INVALID_INPUT          — not grammar-valid at all
 */

import { describe, expect, it } from "vitest";
import { emitLedgerLine } from "./generators";
import {
  checkContentDocumentLimits,
  CONTENT_LIMITS,
  preflightContentDocumentStructure,
  type ContentBlock,
  type ContentDocumentV1,
} from "@exam/domain";

function docOf(blocks: ContentBlock[]): ContentDocumentV1 {
  return { docVersion: 1, type: "doc", content: blocks };
}

function para(text: string, marks?: string[]): ContentBlock {
  return {
    type: "paragraph",
    content: [
      { type: "text", text, ...(marks ? { marks: marks as never } : {}) },
    ],
  };
}

function emptyPara(): ContentBlock {
  return { type: "paragraph", content: [] };
}

function withinLimits(d: ContentDocumentV1): boolean {
  return checkContentDocumentLimits(d).length === 0;
}

function preflightRejects(d: ContentDocumentV1): boolean {
  return preflightContentDocumentStructure(d).length > 0;
}

function preflightReason(d: ContentDocumentV1): string {
  return preflightContentDocumentStructure(d)[0] ?? "";
}

/**
 * Smallest N where pred(doc(N)) holds, via exponential ramp + binary search.
 * Returns minFail = -1 when the predicate never fires within the ramp bound.
 */
function smallestFailing(
  makeDoc: (n: number) => ContentDocumentV1,
  pred: (d: ContentDocumentV1) => boolean,
): number {
  let hi = 2;
  while (!pred(makeDoc(hi)) && hi < 200000) hi *= 2;
  if (!pred(makeDoc(hi))) return -1;
  let lo = 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (pred(makeDoc(mid))) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

interface FamilyResult {
  family: string;
  /** Smallest N (family unit) whose document the preflight rejects; -1 = never. */
  minFail: number;
  /** Grammar-node count of the family unit at minFail. */
  grammarNodesAtMinFail: number;
  rejectReason: string;
  /** true ⇒ RC-04 counterexample: within the product legal set yet rejected. */
  withinContentLimits: boolean;
  classification:
    | "HIDDEN_STRICTER_SET"
    | "PRODUCT_LIMIT_BOUND_FIRST"
    | "NEVER_REJECTED";
  serializedCharsAtMinFail: number;
}

function grammarNodes(d: ContentDocumentV1): number {
  // Grammar-node accounting matching checkContentDocumentLimits' walker
  // (blocks + inlines; marks are not grammar nodes) — used only for reporting.
  let nodes = 0;
  const visit = (block: ContentBlock): void => {
    nodes += 1;
    switch (block.type) {
      case "paragraph":
        nodes += block.content.length;
        break;
      case "bulletList":
      case "orderedList":
        for (const item of block.content) {
          nodes += 1;
          for (const child of item.content) visit(child);
        }
        break;
      case "table":
        for (const row of block.content) {
          nodes += 1;
          for (const cell of row.content) {
            nodes += 1;
            for (const p of cell.content) visit(p);
          }
        }
        break;
      default:
        break;
    }
  };
  for (const block of d.content) visit(block);
  return nodes;
}

const FAMILIES: Array<{
  name: string;
  make: (n: number) => ContentDocumentV1;
}> = [
  {
    name: "plain-runs",
    make: (n) => docOf(Array.from({ length: n }, () => para("x"))),
  },
  {
    name: "marks-empty",
    make: (n) => docOf(Array.from({ length: n }, () => para("x", []))),
  },
  {
    name: "one-mark",
    make: (n) => docOf(Array.from({ length: n }, () => para("x", ["bold"]))),
  },
  {
    name: "three-marks",
    make: (n) =>
      docOf(
        Array.from({ length: n }, () =>
          para("x", ["bold", "italic", "underline"]),
        ),
      ),
  },
  {
    name: "mark-dense",
    make: (n) =>
      docOf(
        Array.from({ length: n }, () =>
          para("x", [
            "bold",
            "bold",
            "italic",
            "italic",
            "underline",
            "underline",
          ]),
        ),
      ),
  },
  {
    name: "empty-paras",
    make: (n) => docOf(Array.from({ length: n }, emptyPara)),
  },
  {
    // Mark-dense single-column table cells: raw-node-dense per grammar node.
    name: "table-rows-marked",
    make: (n) =>
      docOf(
        Array.from({ length: n }, () => ({
          type: "table",
          content: [
            {
              type: "tableRow",
              content: Array.from({ length: 20 }, () => ({
                type: "tableCell",
                content: [para("c", ["bold", "italic", "underline"])],
              })),
            },
          ],
        })) as unknown as ContentBlock[],
      ),
  },
];

function measureFamily(
  name: string,
  make: (n: number) => ContentDocumentV1,
): FamilyResult {
  const minFail = smallestFailing(make, preflightRejects);
  if (minFail < 0) {
    return {
      family: name,
      minFail: -1,
      grammarNodesAtMinFail: -1,
      rejectReason: "",
      withinContentLimits: false,
      classification: "NEVER_REJECTED",
      serializedCharsAtMinFail: -1,
    };
  }
  const failDoc = make(minFail);
  const inLimits = withinLimits(failDoc);
  return {
    family: name,
    minFail,
    grammarNodesAtMinFail: grammarNodes(failDoc),
    rejectReason: preflightReason(failDoc),
    withinContentLimits: inLimits,
    classification: inLimits
      ? "HIDDEN_STRICTER_SET"
      : "PRODUCT_LIMIT_BOUND_FIRST",
    serializedCharsAtMinFail: JSON.stringify(failDoc).length,
  };
}

describe("Phase-C Campaign B — CONTENT_LIMITS vs preflight (RC-04)", () => {
  it("measured ledger: per-family preflight rejection boundaries vs the product legal set", () => {
    const ledger = FAMILIES.map(({ name, make }) => measureFamily(name, make));
    emitLedgerLine("PHASE-C-B-LEDGER", ledger);
    // Mechanical invariants only; the classification carries the discovery.
    for (const row of ledger) {
      if (row.minFail > 0) {
        const family = FAMILIES.find((f) => f.name === row.family);
        expect(family).toBeDefined();
        expect(
          preflightRejects(
            (family as { make: (n: number) => ContentDocumentV1 }).make(
              row.minFail,
            ),
          ),
        ).toBe(true);
      }
    }
  });

  it("RC-04 verdict: at least one family rejects within-limits documents (HIDDEN_STRICTER_SET)", () => {
    const ledger = FAMILIES.map(({ name, make }) => measureFamily(name, make));
    const hidden = ledger.filter(
      (row) => row.classification === "HIDDEN_STRICTER_SET",
    );
    expect(
      {
        hidden: hidden.map((h) => ({
          family: h.family,
          minFail: h.minFail,
          reason: h.rejectReason,
        })),
      },
      JSON.stringify(ledger, null, 2),
    ).toMatchObject({
      hidden: expect.arrayContaining([
        expect.objectContaining({ family: expect.any(String) }),
      ]),
    });
  });

  it("deepest legal list nesting passes preflight (no hidden depth shrink on the raw-depth axis)", () => {
    // Max legal grammar depth 16 via an 8-level list chain (listDepth 8 + depth 16).
    let block: ContentBlock = { type: "paragraph", content: [] };
    for (let i = 0; i < 7; i++) {
      block = {
        type: "bulletList",
        content: [{ type: "listItem", content: [block] }],
      };
    }
    const deepest: ContentDocumentV1 = docOf([block]);
    expect(withinLimits(deepest)).toBe(true);
    expect(preflightRejects(deepest)).toBe(false);
  });

  it("serializedChars axis: preflight and limits agree at limit-1/limit/limit+1", () => {
    // Legal construction: fill with codeBlocks (each ≤ 40000 chars text, no
    // per-run product limit binds before the serialized axis does).
    const build = (target: number): ContentDocumentV1 => {
      const blockOverhead = JSON.stringify({
        type: "codeBlock",
        language: null,
        text: "",
      } satisfies ContentBlock).length;
      const base = JSON.stringify(docOf([])).length;
      const commas = (count: number) => (count > 1 ? count - 1 : 0);
      for (let k = 1; k <= 8; k++) {
        const per = Math.floor(
          (target - base - k * blockOverhead - commas(k)) / k,
        );
        if (per < 0 || per > CONTENT_LIMITS.codeBlock) continue;
        const blocks: ContentBlock[] = Array.from({ length: k }, () => ({
          type: "codeBlock",
          language: null,
          text: "c".repeat(per),
        }));
        // Pad the last block so the total lands exactly on target.
        let diff = target - JSON.stringify(docOf(blocks)).length;
        if (diff >= 0 && per + diff <= CONTENT_LIMITS.codeBlock) {
          blocks[k - 1] = {
            type: "codeBlock",
            language: null,
            text: "c".repeat(per + diff),
          };
        }
        if (JSON.stringify(docOf(blocks)).length === target)
          return docOf(blocks);
      }
      throw new Error(`cannot build serialized length ${target}`);
    };
    for (const target of [
      CONTENT_LIMITS.serializedChars - 1,
      CONTENT_LIMITS.serializedChars,
      CONTENT_LIMITS.serializedChars + 1,
    ]) {
      const d = build(target);
      const serialized = JSON.stringify(d).length;
      expect(serialized).toBe(target);
      expect({
        serialized,
        limitsReject: !withinLimits(d),
        preflightReject: preflightRejects(d),
      }).toEqual({
        serialized,
        limitsReject: serialized > CONTENT_LIMITS.serializedChars,
        preflightReject: serialized > CONTENT_LIMITS.serializedChars,
      });
    }
  });

  it("node-count cross-check: a within-limits preflight rejection is a real product document (schema would accept its shape)", () => {
    // Pin one concrete minimal counterexample from the mark-dense family for
    // the ledger: measure, then assert the counterexample shape holds.
    const result = measureFamily(
      "mark-dense",
      FAMILIES[4]?.make ?? FAMILIES[0]!.make,
    );
    if (result.withinContentLimits) {
      const failDoc = (
        FAMILIES[4] as { make: (n: number) => ContentDocumentV1 }
      ).make(result.minFail);
      expect(checkContentDocumentLimits(failDoc)).toEqual([]);
      expect(preflightContentDocumentStructure(failDoc).length).toBeGreaterThan(
        0,
      );
      expect(result.rejectReason).toContain("structural nodes");
    }
  });
});
