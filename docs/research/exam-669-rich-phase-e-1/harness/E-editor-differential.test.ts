/**
 * Phase-E Campaign E — editor ↔ canonical grammar differential (L1, invariant
 * E-RC02).
 *
 * Attacks the real Tiptap adapter (`contentAdapter.ts`). Properties sought:
 *
 *   1. supported semantics SURVIVE the declared mapping (round-trip equality
 *      under canonical identity) — not literal Tiptap JSON identity;
 *   2. every downgrade (tableHeader→tableCell, code→inlineCode, blockMath in
 *      list/table-cell → inlineMath paragraph) is DECLARED and exact;
 *   3. off-grammar constructs fail closed or follow a DECLARED degradation —
 *      a NEW silent downgrade is a finding.
 *
 * Historically dangerous contexts exercised explicitly: blockMath selection
 * landing, list blockMath mapping, table-cell blockMath mapping, paste-shaped
 * unknown nodes, unknown marks.
 *
 * Seeds: 0x669E0001 (shared Phase-E seed pool), regression lineage 0x67300001.
 */
import fc from "fast-check";
import { describe, expect, it, afterAll } from "vitest";
import {
  canonicalizeContentDocument,
  ContentDocumentV1Schema,
} from "@exam/contracts";
import {
  contentDocumentsEqual,
  normalizeContentDocument,
  plainTextProjection,
  type ContentDocumentV1,
} from "@exam/domain";
import {
  contentDocumentToTiptap,
  tiptapToContentDocument,
} from "@exam/web/src/components/shared/content/contentAdapter.js";
import { arbitraryDocument } from "./generators.js";
import { CampaignRecorder } from "./campaignStats.js";

const recorder = new CampaignRecorder(
  "E-editor-differential",
  [0x669e0001, 0x67300001],
);

function canonicalOrSkip(d: ContentDocumentV1): ContentDocumentV1 | null {
  const c = canonicalizeContentDocument(d);
  return c.ok ? c.value : null;
}

describe("Campaign E — editor↔canonical differential (E-RC02)", () => {
  it("property: canonical documents survive contentDocumentToTiptap → tiptapToContentDocument exactly", () => {
    let roundTrips = 0;
    let canonicalizationRejected = 0;
    fc.assert(
      fc.property(arbitraryDocument("small"), (d) => {
        // BRANCH, don't fc.pre: canonicalize-rejected inputs belong to the
        // rich_noncanonical algebra (Campaign A) — recorded here, never
        // regenerated.
        const canonical = canonicalOrSkip(d);
        if (canonical === null) {
          canonicalizationRejected += 1;
          return;
        }
        const doc = canonical;
        const tiptap = contentDocumentToTiptap(doc);
        const back = tiptapToContentDocument(tiptap);
        expect(
          contentDocumentsEqual(back, doc),
          `round-trip diverged for ${JSON.stringify(doc)}`,
        ).toBe(true);
        // And the round-trip output is still canonical.
        expect(
          contentDocumentsEqual(
            back,
            normalizeContentDocument(JSON.parse(JSON.stringify(back))),
          ),
        ).toBe(true);
        roundTrips += 1;
      }),
      {
        seed: 0x669e0001,
        numRuns: 300,
        endOnFailure: true,
        verbose: true,
        timeout: 60000,
      },
    );
    expect(
      roundTrips,
      `round-trip algebra exercised only ${roundTrips}× / 300`,
    ).toBeGreaterThanOrEqual(80);
    recorder.record({
      probe: "roundtrip-canonical",
      roundTrips,
      canonicalizationRejected,
    });
  });

  it("declared downgrade: blockMath inside a list item maps to an inlineMath paragraph with preserved latex", () => {
    const tiptap = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "blockMath", attrs: { latex: "E=mc^2" } }],
            },
          ],
        },
      ],
    };
    const doc = tiptapToContentDocument(tiptap as never);
    const item = doc.content[0];
    expect(item.type).toBe("bulletList");
    const listItem = (
      item as { content: Array<{ type: string; content: unknown[] }> }
    ).content[0];
    expect(listItem.type).toBe("listItem");
    const para = listItem.content[0] as {
      type: string;
      content: Array<{ type: string; latex?: string }>;
    };
    expect(para.type).toBe("paragraph");
    expect(para.content[0]).toMatchObject({
      type: "inlineMath",
      latex: "E=mc^2",
    });
    // Declared mapping output is canonical-legal.
    expect(ContentDocumentV1Schema.safeParse(doc).success).toBe(true);
    recorder.record({ probe: "list-blockmath-downgrade", outcome: "declared" });
  });

  it("declared downgrade: blockMath inside a table cell maps to an inlineMath paragraph with preserved latex", () => {
    const tiptap = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    { type: "blockMath", attrs: { latex: "\\int_0^1 x\\,dx" } },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "hdr" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const doc = tiptapToContentDocument(tiptap as never);
    const table = doc.content[0] as {
      type: string;
      content: Array<{
        type: string;
        content: Array<{
          type: string;
          content: Array<{
            type: string;
            content: Array<{ type: string; latex?: string; text?: string }>;
          }>;
        }>;
      }>;
    };
    expect(table.type).toBe("table");
    const cellA = table.content[0].content[0].content[0];
    expect(cellA.type).toBe("paragraph");
    expect((cellA.content[0] as { type: string }).type).toBe("inlineMath");
    // tableHeader → tableCell is the DECLARED downgrade.
    const cellB = table.content[0].content[1];
    expect(cellB.type).toBe("tableCell");
    expect(ContentDocumentV1Schema.safeParse(doc).success).toBe(true);
    recorder.record({
      probe: "table-blockmath-and-header-downgrade",
      outcome: "declared",
    });
  });

  it("unknown marks are DROPPED (declared) while text survives; unknown top-level blocks THROW (fail-closed)", () => {
    const withUnknownMark = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "kept",
              marks: [{ type: "highlight" }, { type: "bold" }],
            },
          ],
        },
      ],
    };
    const doc = tiptapToContentDocument(withUnknownMark as never);
    const para = doc.content[0] as {
      content: Array<{ type: string; text?: string; marks?: string[] }>;
    };
    expect(para.content[0]).toMatchObject({ type: "text", text: "kept" });
    expect(para.content[0].marks).toEqual(["bold"]);

    const unknownTopLevel = {
      type: "doc",
      content: [{ type: "imageUpload", attrs: { id: "x" } }],
    };
    expect(() => tiptapToContentDocument(unknownTopLevel as never)).toThrow();
    recorder.record({
      probe: "unknown-mark-and-top-level",
      outcome: "declared/throw",
    });
  });

  it("off-grammar node inside a list item degrades to its DECLARED plain-text projection (no silent loss of semantics without declaration)", () => {
    const pasted = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "table",
                  content: [
                    {
                      type: "tableRow",
                      content: [
                        {
                          type: "tableCell",
                          content: [
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "cell" }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const doc = tiptapToContentDocument(pasted as never);
    const listItem = (
      doc.content[0] as {
        content: Array<{
          content: Array<{
            type: string;
            content: Array<{ type: string; text?: string }>;
          }>;
        }>;
      }
    ).content[0];
    const para = listItem.content[0];
    expect(para.type).toBe("paragraph");
    // The degradation is the declared projection — the text must be the
    // table's plainTextProjection (trimmed), never an empty fragment.
    expect((para.content[0] as { text?: string }).text).toBe(
      plainTextProjection({
        docVersion: 1,
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "cell" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }).trimEnd(),
    );
    recorder.record({
      probe: "list-pasted-table-degradation",
      outcome: "declared",
    });
  });

  it("paste-shaped empty-latex blockMath degrades to inlineMath with '' — and the SCHEMA then rejects it downstream (write seam owns rejection)", () => {
    // Paste shape: a listItem whose only block is a blockMath with NO latex
    // attr (editor serialization artifact). The list-items mapper degrades it
    // to an inlineMath paragraph with latex "".
    const doc = tiptapToContentDocument({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "blockMath", attrs: {} }],
            },
          ],
        },
      ],
    } as never);
    const para = (
      doc.content[0] as {
        content: Array<{
          content: Array<{ content: Array<{ latex?: string }> }>;
        }>;
      }
    ).content[0].content[0];
    expect(para.content[0]).toMatchObject({ type: "inlineMath", latex: "" });
    // The declared degradation does NOT smuggle an invalid document past the
    // wire authority: schema rejects empty latex.
    expect(ContentDocumentV1Schema.safeParse(doc).success).toBe(false);
    recorder.record({
      probe: "empty-latex-degradation-rejected-downstream",
      outcome: "declared+schema-reject",
    });
  });

  it("regression 0x67300001: no supported construct is silently dropped in round-trip (byte census)", () => {
    const cases: ContentDocumentV1[] = [
      {
        docVersion: 1,
        type: "doc",
        content: [{ type: "paragraph", content: [] }],
      },
      {
        docVersion: 1,
        type: "doc",
        content: [{ type: "blockMath", latex: "x^2" }],
      },
      {
        docVersion: 1,
        type: "doc",
        content: [
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "one" }],
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
                              { type: "hardBreak" },
                              { type: "text", text: "deep" },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        docVersion: 1,
        type: "doc",
        content: [
          {
            type: "codeBlock",
            language: "ts",
            text: "const x = 1;\n",
          },
        ],
      },
    ];
    for (const doc of cases) {
      const canonical = canonicalOrSkip(doc);
      if (!canonical) continue;
      const back = tiptapToContentDocument(contentDocumentToTiptap(canonical));
      expect(
        contentDocumentsEqual(back, canonical),
        JSON.stringify(canonical),
      ).toBe(true);
    }
    recorder.record({ probe: "byte-census", cases: cases.length });
  });

  afterAll(() => {
    recorder.flush({});
  });
});
