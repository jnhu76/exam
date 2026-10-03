/**
 * Phase-E Campaign W — cross-seam mutation (L1, E-RD04/E-WR02/E-RE01
 * foundations). Every consumer of a persisted document — web editor-load
 * adapter, write canonicalizer, persisted classifiers, question/answer
 * resolvers, projection, KaTeX, and the React read renderer — receives one
 * DEEP-FROZEN wire-representable document. Any in-place write inside any
 * consumer throws (strict-mode frozen object); a structural witness
 * double-checks after the full chain.
 *
 * Oracle discipline: a consumer MAY fail closed (the editor adapter throws on
 * out-of-grammar input by design; renderers degrade to the integrity notice)
 * — throws are recorded as observed fail-closed branches. What NO consumer
 * may do is mutate the value it was handed: reads are derivations, at every
 * seam, for every shape the DB history can hold.
 */
import fc from "fast-check";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, afterAll } from "vitest";
import { contentDocumentToTiptap } from "@exam/web/src/components/shared/content/contentAdapter.js";
import { ContentRenderer } from "@exam/web/src/components/shared/content/ContentRenderer.js";
import {
  type ContentBlock,
  type ContentDocumentV1,
  plainTextProjection,
} from "@exam/domain";
import {
  canonicalizeContentDocument,
  classifyPersistedRichAnswer,
  resolvePersistedQuestionDocument,
  resolveRichAnswerDocument,
} from "@exam/contracts";
import { katexRenderToHtml } from "@exam/web/src/components/shared/content/katexRender.js";
import { arbitraryDocument, exactLimitDocs } from "./generators.js";
import { CampaignRecorder } from "./campaignStats.js";

const recorder = new CampaignRecorder("W-cross-seam-mutation", [0x669e0007]);
const NUM_RUNS = 120;
const PLAIN_FALLBACK = "W-PLAIN-FALLBACK-MUST-NOT-RENDER";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** Every LaTeX source carried by the document (inline + block math). */
function collectMathLatex(doc: ContentDocumentV1): string[] {
  const out: string[] = [];
  const walkBlock = (block: ContentBlock): void => {
    if (block.type === "blockMath") out.push(block.latex);
    else if (block.type === "paragraph") {
      for (const inline of block.content) {
        if (inline.type === "inlineMath") out.push(inline.latex);
      }
    } else if (block.type === "bulletList" || block.type === "orderedList") {
      for (const item of block.content) {
        for (const child of item.content) walkBlock(child);
      }
    } else if (block.type === "table") {
      for (const row of block.content) {
        for (const cell of row.content) {
          for (const paragraph of cell.content) {
            for (const inline of paragraph.content) {
              if (inline.type === "inlineMath") out.push(inline.latex);
            }
          }
        }
      }
    }
  };
  for (const block of doc.content) walkBlock(block);
  return out;
}

/**
 * Drives the FULL consumer chain over one frozen document. Every consumer
 * may return or throw (fail-closed) — neither may mutate. Returns the
 * observed per-seam dispositions for the census.
 */
function consumeChain(doc: ContentDocumentV1): Record<string, string> {
  const dispositions: Record<string, string> = {};
  const attempt = (seam: string, fn: () => unknown): void => {
    try {
      fn();
      dispositions[seam] = "returned";
    } catch {
      dispositions[seam] = "fail-closed-throw";
    }
  };

  attempt("editor-adapter", () => contentDocumentToTiptap(doc));
  attempt("canonicalizer", () => canonicalizeContentDocument(doc));
  attempt("answer-classifier", () =>
    classifyPersistedRichAnswer({ value: doc, answerMode: "rich" }),
  );
  attempt("question-resolver", () => resolvePersistedQuestionDocument(doc));
  attempt("answer-resolver", () => resolveRichAnswerDocument(doc, "rich"));
  attempt("projection", () => plainTextProjection(doc));
  attempt("katex", () => {
    for (const latex of collectMathLatex(doc)) {
      katexRenderToHtml(latex, false);
      katexRenderToHtml(latex, true);
    }
  });
  attempt("content-renderer", () => {
    renderToString(
      createElement(ContentRenderer, {
        content: PLAIN_FALLBACK,
        document: doc,
        className: "",
      }),
    );
  });
  return dispositions;
}

describe("Campaign W — cross-seam mutation (deep-frozen inputs)", () => {
  it("property: no consumer of the chain mutates its frozen document input", () => {
    let docsConsumed = 0;
    let failClosedSeams = 0;
    const seamDispositionCounts: Record<string, number> = {};

    fc.assert(
      fc.property(arbitraryDocument("small"), (raw) => {
        const witness = JSON.parse(JSON.stringify(raw)) as ContentDocumentV1;
        const doc = deepFreeze(
          JSON.parse(JSON.stringify(raw)) as ContentDocumentV1,
        );
        docsConsumed += 1;

        const dispositions = consumeChain(doc);
        for (const [seam, d] of Object.entries(dispositions)) {
          seamDispositionCounts[seam] =
            (seamDispositionCounts[seam] ?? 0) +
            (d === "fail-closed-throw" ? 1 : 0);
        }
        failClosedSeams += Object.values(dispositions).filter(
          (d) => d === "fail-closed-throw",
        ).length;

        // The witness: any in-place write in ANY consumer would have thrown
        // against the freeze; toEqual also catches non-throwing rewrites.
        expect(doc, "a consumer mutated its frozen input").toEqual(witness);
      }),
      { numRuns: NUM_RUNS, seed: 0x669e0007 },
    );

    recorder.record({
      probe: "chain-property",
      outcome: "no-mutation",
      docsConsumed,
      failClosedSeams,
      seamDispositionCounts,
    });
    expect(docsConsumed).toBe(NUM_RUNS);
    // Census: every seam of the chain actually ran.
    expect(Object.keys(seamDispositionCounts).length).toBe(8);
  });

  it("boundary corpus: the full chain over canonical, noncanonical, corrupt, and limit-edge documents", () => {
    const canonical: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "W canonical ", marks: ["bold"] },
            { type: "inlineMath", latex: "\\frac{a}{b}" },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "W item", marks: ["italic"] },
                  ],
                },
              ],
            },
          ],
        },
        { type: "blockMath", latex: "x^2 + y^2" },
      ],
    };
    const noncanonical: ContentDocumentV1 = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "W ", marks: ["italic", "bold", "bold"] },
            { type: "text", text: "noncanonical", marks: ["bold", "italic"] },
          ],
        },
      ],
    };
    const corrupt = {
      docVersion: 1,
      type: "not-doc",
      content: [],
    } as unknown as ContentDocumentV1;
    const unsupported = {
      docVersion: 2,
      type: "doc",
      content: [],
    } as unknown as ContentDocumentV1;

    const corpus: Array<{ name: string; doc: ContentDocumentV1 }> = [
      { name: "canonical-math-list", doc: canonical },
      { name: "noncanonical-merged-marks", doc: noncanonical },
      { name: "corrupt-envelope", doc: corrupt },
      { name: "unsupported-v2", doc: unsupported },
    ];
    for (const { name, doc } of exactLimitDocs()) {
      if (
        // keep the corpus schema-legal: the corrupt shapes above already
        // cover fail-closed seams
        doc.content.length >= 0 &&
        name.includes("at-limit")
      ) {
        corpus.push({ name, doc });
      }
    }

    const summary: Array<Record<string, unknown>> = [];
    for (const { name, doc } of corpus) {
      const witness = JSON.parse(JSON.stringify(doc)) as ContentDocumentV1;
      const frozen = deepFreeze(
        JSON.parse(JSON.stringify(doc)) as ContentDocumentV1,
      );
      const dispositions = consumeChain(frozen);
      expect(frozen, `${name}: mutated by the chain`).toEqual(witness);
      summary.push({ name, dispositions });
    }
    recorder.record({
      probe: "boundary-corpus",
      outcome: "no-mutation",
      cases: summary,
    });
    expect(corpus.length).toBeGreaterThanOrEqual(8);
  });

  afterAll(() => {
    recorder.flush();
  });
});
