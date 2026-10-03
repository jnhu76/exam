/**
 * Phase-E adversarial generators (fast-check arbitraries).
 *
 * ORACLE DISCIPLINE (Phase-E §31): these arbitraries produce STRUCTURES only.
 * They never decide validity, never normalize, never compute projections or
 * identity — every semantic judgment in the campaigns is made by importing the
 * production authorities (@exam/domain kernel, @exam/contracts schema and
 * classifiers, @exam/exam-engine protocol).
 *
 * Document arbitraries deliberately generate NON-canonical features (duplicate
 * / unsorted marks, adjacent same-mark runs, empty runs/items/paragraphs,
 * invalid code languages, ragged tables) so the production schema and
 * canonicalizer — not the generator — decide what survives.
 */
import fc from "fast-check";
import type {
  ContentBlock,
  ContentDocumentV1,
  ContentInline,
  ContentMarkType,
} from "@exam/domain";

/** Size classes fed to every recursive builder. */
export type SizeClass = "tiny" | "small" | "boundary";

const MARKS: ContentMarkType[] = ["bold", "italic", "underline", "inlineCode"];

/** Kernel limit values (imported values, not copies — single authority). */
import { CONTENT_LIMITS } from "@exam/domain";
export const TEXT_RUN_LIMIT = CONTENT_LIMITS.textRun;
export const CODE_LIMIT = CONTENT_LIMITS.codeBlock;
export const LATEX_LIMIT = CONTENT_LIMITS.latex;
export const SERIALIZED_LIMIT = CONTENT_LIMITS.serializedChars;
export const TOTAL_NODES_LIMIT = CONTENT_LIMITS.totalNodes;
export const DEPTH_LIMIT = CONTENT_LIMITS.depth;
export const LIST_DEPTH_LIMIT = CONTENT_LIMITS.listDepth;
export const TABLE_ROWS_LIMIT = CONTENT_LIMITS.tableRows;
export const TABLE_COLS_LIMIT = CONTENT_LIMITS.tableCols;
export const TABLE_CELLS_LIMIT = CONTENT_LIMITS.tableCells;

/** Small repeatable text with unicode bias (Campaign Q corpora ride on this). */
export function arbitraryText(size: SizeClass = "small"): fc.Arbitrary<string> {
  const alphabets = [
    "abc ",
    "a",
    "hello world \n\t",
    "naïve 中文 🚀 \u0301 bidi\u202E \u0000",
    "\\frac{a}{b} $ % _ { } ~ ^ \\",
  ];
  const base =
    size === "tiny"
      ? fc.constantFrom("", "a", "ab", " ", "\n", "\u0000", "🚀", "é")
      : size === "small"
        ? fc.string({ maxLength: 24, size: "small" })
        : fc.string({ maxLength: 200, size: "small" });
  return fc.oneof(
    { arbitrary: base, weight: 6 },
    { arbitrary: fc.constantFrom(...alphabets), weight: 1 },
  );
}

/**
 * Length distribution biased to limit boundaries. Exact-limit probes are
 * weighted LOW (each is an expensive near-131k serialized document); the
 * deterministic exact-boundary grids in `nearLimitCases()` cover every
 * CONTENT_LIMITS edge once, without random giant documents.
 */
export function biasedLength(
  max: number,
  largeWeight = 0,
): fc.Arbitrary<number> {
  const parts: fc.WeightedArbitrary<number>[] = [
    { arbitrary: fc.nat(Math.min(max + 1, 64)), weight: 8 },
    {
      arbitrary: fc.constantFrom(
        0,
        1,
        2,
        Math.floor(max / 2),
        max - 1,
        max,
        max + 1,
      ),
      weight: 1,
    },
  ];
  if (largeWeight > 0) {
    parts.push({
      arbitrary: fc.integer({ min: 0, max: max + 1 }),
      weight: largeWeight,
    });
  }
  return fc.oneof(...parts);
}

function repeatedText(len: number): string {
  // Cheap deterministic payload; length is the property under test.
  return "x".repeat(len);
}

/** Text payload with explicit boundary probing (incl. > limit values). */
export function arbitraryTextRun(
  size: SizeClass = "small",
): fc.Arbitrary<string> {
  if (size === "boundary") {
    return biasedLength(TEXT_RUN_LIMIT, 1).map(repeatedText);
  }
  return arbitraryText(size);
}

const MARK_LIST: fc.Arbitrary<ContentMarkType[] | undefined> = fc.oneof(
  { arbitrary: fc.constant(undefined), weight: 4 },
  {
    arbitrary: fc
      .array(fc.constantFrom(...MARKS), { maxLength: 5 })
      .map((marks) => (marks.length === 0 ? undefined : marks)),
    weight: 4,
  },
  // Structured non-canonical shapes: duplicates, reversed canonical order,
  // inlineCode combined with others (schema rejects, normalizer dedups).
  {
    arbitrary: fc
      .array(fc.constantFrom(...MARKS), { minLength: 2, maxLength: 6 })
      .map((marks) => [...marks, ...marks.slice(0, 2)]),
    weight: 2,
  },
);

export function arbitraryInline(
  size: SizeClass = "small",
  withMath = true,
): fc.Arbitrary<ContentInline> {
  const text = fc
    .record({
      type: fc.constant("text"),
      text: arbitraryTextRun(size),
      marks: MARK_LIST,
    })
    .map((v) => v as unknown as ContentInline);
  const hardBreak = fc.constant({
    type: "hardBreak",
  }) as unknown as fc.Arbitrary<ContentInline>;
  const latexArb =
    size === "boundary"
      ? biasedLength(LATEX_LIMIT, 1).map(repeatedText)
      : fc.oneof(
          { arbitrary: arbitraryText("tiny"), weight: 5 },
          { arbitrary: fc.constant("x\\frac{1}{2}y"), weight: 2 },
        );
  const inlineMath = fc
    .record({
      type: fc.constant("inlineMath"),
      // InlineMathSchema requires min(1); include "" to let the schema reject.
      latex: fc.oneof(
        { arbitrary: latexArb, weight: 8 },
        { arbitrary: fc.constant(""), weight: 1 },
      ),
    })
    .map((v) => v as unknown as ContentInline);
  const parts = withMath
    ? [
        { arbitrary: text, weight: 7 },
        { arbitrary: hardBreak, weight: 1 },
        { arbitrary: inlineMath, weight: 2 },
      ]
    : [
        { arbitrary: text, weight: 8 },
        { arbitrary: hardBreak, weight: 2 },
      ];
  return fc.oneof(...parts);
}

/** Grammar-shaped arbitrary: no fixed depth ceiling beyond the size class. */
export function arbitraryDocument(
  size: SizeClass = "small",
): fc.Arbitrary<ContentDocumentV1> {
  // Size discipline for the RANDOM campaigns: the closure/classifier
  // properties need adversarial SHAPES, not adversarial SIZES — giant
  // boundary documents are covered deterministically by exactLimitDocs().
  // Bounds here keep every generated document small enough that even a
  // rejected recursive parse stays in the millisecond range.
  const cap =
    size === "tiny"
      ? { top: 4, inline: 4, item: 2, list: 2, row: 2, cell: 1 }
      : size === "small"
        ? { top: 6, inline: 8, item: 3, list: 3, row: 2, cell: 2 }
        : { top: 10, inline: 12, item: 4, list: 4, row: 3, cell: 3 };
  const inline = arbitraryInline(size);

  const { block } = fc.letrec((tie) => {
    const paragraph: fc.Arbitrary<ContentBlock> = fc
      .record({
        type: fc.constant("paragraph"),
        content: fc.array(inline, { maxLength: cap.inline, size: "small" }),
      })
      .map((p) => p as unknown as ContentBlock);

    const listItem: fc.Arbitrary<ContentBlock> = fc
      .record({
        type: fc.constant("listItem"),
        content: fc.array(
          fc.oneof(
            {
              arbitrary: tie("paragraph") as fc.Arbitrary<ContentBlock>,
              weight: 5,
            },
            {
              arbitrary: tie("bulletList") as fc.Arbitrary<ContentBlock>,
              weight: 2,
            },
            {
              arbitrary: tie("orderedList") as fc.Arbitrary<ContentBlock>,
              weight: 2,
            },
          ),
          { maxLength: cap.item, size: "small" },
        ),
      })
      .map((v) => v as unknown as ContentBlock);

    const bulletList: fc.Arbitrary<ContentBlock> = fc
      .record({
        type: fc.constant("bulletList"),
        content: fc.array(tie("listItem") as fc.Arbitrary<ContentBlock>, {
          maxLength: cap.list,
          size: "small",
        }),
      })
      .map((v) => v as unknown as ContentBlock);

    const orderedList: fc.Arbitrary<ContentBlock> = fc
      .record({
        type: fc.constant("orderedList"),
        content: fc.array(tie("listItem") as fc.Arbitrary<ContentBlock>, {
          maxLength: cap.list,
          size: "small",
        }),
      })
      .map((v) => v as unknown as ContentBlock);

    const codeBlock: fc.Arbitrary<ContentBlock> = fc
      .record({
        type: fc.constant("codeBlock"),
        language: fc.oneof(
          { arbitrary: fc.constant(null), weight: 3 },
          {
            arbitrary: fc.oneof(
              {
                arbitrary: fc.constantFrom("ts", "py", "C++", "node.js"),
                weight: 5,
              },
              // Off-grammar languages: invalid chars / over 32 chars.
              { arbitrary: arbitraryText("tiny"), weight: 2 },
              { arbitrary: fc.constant("a".repeat(33)), weight: 1 },
            ),
            weight: 2,
          },
        ),
        text:
          size === "boundary"
            ? biasedLength(CODE_LIMIT, 1).map(repeatedText)
            : arbitraryText(size),
      })
      .map((v) => v as unknown as ContentBlock);

    const blockMath: fc.Arbitrary<ContentBlock> = fc
      .record({
        type: fc.constant("blockMath"),
        latex:
          size === "boundary"
            ? biasedLength(LATEX_LIMIT, 1).map(repeatedText)
            : fc.oneof(
                { arbitrary: arbitraryText("tiny"), weight: 6 },
                { arbitrary: fc.constant(""), weight: 1 },
              ),
      })
      .map((v) => v as unknown as ContentBlock);

    const tableRow: fc.Arbitrary<ContentBlock> = fc
      .record({
        type: fc.constant("tableRow"),
        content: fc.array(
          fc.record({
            type: fc.constant("tableCell"),
            content: fc.array(paragraph, {
              minLength: 0,
              maxLength: cap.cell,
              size: "small",
            }),
          }),
          { maxLength: cap.row, size: "small" },
        ),
      })
      .map((v) => v as unknown as ContentBlock);

    const table: fc.Arbitrary<ContentBlock> = fc
      .record({
        type: fc.constant("table"),
        content: fc.array(tableRow, { maxLength: cap.row, size: "small" }),
      })
      .map((v) => v as unknown as ContentBlock);

    const anyBlock: fc.Arbitrary<ContentBlock> = fc.oneof(
      { arbitrary: paragraph, weight: 6 },
      { arbitrary: bulletList, weight: 2 },
      { arbitrary: orderedList, weight: 2 },
      { arbitrary: codeBlock, weight: 1 },
      { arbitrary: blockMath, weight: 1 },
      { arbitrary: table, weight: 1 },
    );

    // letrec requires EVERY tie-referenced name to appear in the returned
    // record; `block` is the public entry the callers consume.
    return {
      paragraph,
      listItem,
      bulletList,
      orderedList,
      block: anyBlock,
    };
  });

  return fc
    .record({
      docVersion: fc.constant(1),
      type: fc.constant("doc"),
      content: fc.array(block, { maxLength: cap.top, size: "small" }),
    })
    .map((d) => d as ContentDocumentV1);
}

/** Deeply nested chain of `depth` list levels (grammar-legal depth probes). */
export function nestedListChain(depth: number): ContentDocumentV1 {
  let inner: ContentBlock = {
    type: "paragraph",
    content: [{ type: "text", text: "leaf" }],
  };
  for (let i = 0; i < depth; i++) {
    // Fixture builder: crosses the ContentBlock/ContentListItem type split
    // by construction (listItem lives inside lists, not in ContentBlock).
    inner = {
      type: "bulletList",
      content: [{ type: "listItem", content: [inner] }],
    } as unknown as ContentBlock;
  }
  return { docVersion: 1, type: "doc", content: [inner] };
}

/** Raw array nesting NOT shaped like the grammar (hostile-depth probes). */
export function hostileDeepArray(depth: number): unknown {
  let node: unknown = "leaf";
  for (let i = 0; i < depth; i++) node = [node];
  return { docVersion: 1, type: "doc", content: node };
}

/**
 * `listLevels` nested bullet lists whose innermost listItem is EMPTY. This
 * shape is CONTENT_LIMITS-clean at listDepth 8 (tree depth exactly 16) but
 * grammar-ILLEGAL (listItem requires ≥1 child), which is how the census in
 * Campaign B proves listDepth 8 is unreachable: a legal leaf is either a
 * paragraph (tree depth 17 > 16) or a 9th list (listDepth 9 > 8).
 */
export function emptyLeafListChain(listLevels: number): ContentDocumentV1 {
  // Fixture builder: the seed is a listItem, which the grammar only admits
  // INSIDE a list — the type split is crossed by construction (that is the
  // hostile shape under test).
  let inner = { type: "listItem", content: [] } as unknown as ContentBlock;
  for (let i = 0; i < listLevels; i++) {
    inner = {
      type: "bulletList",
      content: [inner],
    } as unknown as ContentBlock;
  }
  return { docVersion: 1, type: "doc", content: [inner] };
}

/** Bounded Unicode / serialization corpus (Campaign Q). */
export const UNICODE_CORPUS: readonly string[] = [
  "",
  "a",
  "combining: a\u0301e\u0308i\u030A",
  "emoji family: 👨‍👩‍👧‍👦 🏳️‍🌈",
  "lone surrogate half: \uD83D",
  "zwj: 👩‍💻",
  "bidi: ‎abc‏ ‫x‬",
  "newlines: \r\n \n \r \u2028 \u2029",
  "nul-ish: \u0000\u0001\u007F",
  "cjk: 中文漢字テスト한국어",
  "astral: 𝕏𝕐ℤ 𝄞 𝕌𝕟𝕚",
  "rtl override: ‮mirrored",
  "tab/vt: \t\u000B\f",
  "latex-ish: \\frac{中文}{🚀}",
];

/** All §7 corpus shapes for one persisted answer slot. */
export type PersistedCorpusCase = {
  name: string;
  value: unknown;
  answerMode: "plain" | "rich";
  legacyPlainProvenance?: boolean;
};

export function persistedAnswerCorpus(): PersistedCorpusCase[] {
  const canonical: ContentDocumentV1 = {
    docVersion: 1,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "ok" }] }],
  };
  const noncanonical: ContentDocumentV1 = {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a", marks: ["italic", "bold", "bold"] },
          { type: "text", text: "b", marks: ["bold", "italic"] },
        ],
      },
    ],
  };
  const corruptNode = {
    docVersion: 1,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "wat" }] }],
  };
  return [
    { name: "empty-null", value: null, answerMode: "rich" },
    { name: "empty-undefined", value: undefined, answerMode: "rich" },
    { name: "plain-on-plain-mode", value: "text", answerMode: "plain" },
    {
      name: "string-rich-no-provenance",
      value: "legacy text",
      answerMode: "rich",
    },
    {
      name: "string-rich-with-provenance",
      value: "legacy text",
      answerMode: "rich",
      legacyPlainProvenance: true,
    },
    { name: "rich-canonical", value: canonical, answerMode: "rich" },
    { name: "rich-noncanonical", value: noncanonical, answerMode: "rich" },
    {
      name: "rich-limit-invalid",
      value: {
        docVersion: 1,
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x".repeat(TEXT_RUN_LIMIT + 5) }],
          },
        ],
      },
      answerMode: "rich",
    },
    {
      name: "unsupported-v2",
      value: { docVersion: 2, type: "doc", content: [] },
      answerMode: "rich",
    },
    {
      name: "unsupported-float",
      value: { docVersion: 2.5, type: "doc", content: [] },
      answerMode: "rich",
    },
    {
      name: "corrupt-envelope",
      value: { docVersion: 1, type: "not-doc", content: [] },
      answerMode: "rich",
    },
    { name: "corrupt-node", value: corruptNode, answerMode: "rich" },
    {
      name: "corrupt-string-docVersion",
      value: { docVersion: "1", type: "doc", content: [] },
      answerMode: "rich",
    },
    { name: "corrupt-number", value: 42, answerMode: "rich" },
    { name: "corrupt-array", value: [canonical], answerMode: "rich" },
    { name: "objective-boolean", value: true, answerMode: "plain" },
    {
      name: "objective-array",
      value: ["opt-1", "opt-2"],
      answerMode: "plain",
    },
  ];
}

/** Canonical identity probe pairs (Campaign R): mutation operators on docs. */
export function identityMutationPairs(
  doc: ContentDocumentV1,
): Array<{ name: string; other: ContentDocumentV1 }> {
  const clones = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const out: Array<{ name: string; other: ContentDocumentV1 }> = [];
  const findPara = (
    d: ContentDocumentV1,
  ): Extract<ContentBlock, { type: "paragraph" }> | undefined =>
    d.content.find(
      (b): b is Extract<ContentBlock, { type: "paragraph" }> =>
        b.type === "paragraph",
    );
  const para = findPara(doc);
  if (para && para.content.length > 0 && para.content[0].type === "text") {
    const run = para.content[0];
    if (run.type === "text" && run.text.length >= 2) {
      // Split one run into two adjacent same-mark runs (equivalent after N).
      const d = clones(doc);
      const p = findPara(d)!;
      const r = p.content[0];
      if (r.type === "text") {
        const half = Math.floor(r.text.length / 2);
        p.content.splice(
          0,
          1,
          {
            type: "text",
            text: r.text.slice(0, half),
            ...(r.marks ? { marks: [...r.marks] } : {}),
          },
          {
            type: "text",
            text: r.text.slice(half),
            ...(r.marks ? { marks: [...r.marks] } : {}),
          },
        );
        out.push({ name: "split-adjacent-run", other: d });
      }
    }
    if (run.type === "text" && run.marks && run.marks.length > 1) {
      const d2 = clones(doc);
      const p2 = findPara(d2)!;
      const r2 = p2.content[0];
      if (r2.type === "text" && r2.marks) r2.marks = [...r2.marks].reverse();
      out.push({ name: "mark-order-shuffle", other: d2 });
    }
  }
  // Key-order shuffle of the JSON object (identity must not care).
  const d3 = {
    type: doc.type,
    content: clones(doc.content),
    docVersion: doc.docVersion,
  } as unknown as ContentDocumentV1;
  out.push({ name: "key-order-shuffle", other: d3 });
  // Distinct-content mutation (must differ semantically).
  const d4 = clones(doc);
  const added: ContentBlock = {
    type: "paragraph",
    content: [{ type: "text", text: "phase-e-added" }],
  };
  d4.content = [...d4.content, added];
  out.push({ name: "append-paragraph", other: d4 });
  return out;
}

// ── Deterministic exact-boundary grids (campaigns A/B/D) ────────────────
//
// Every CONTENT_LIMITS edge, probed exactly once each — cheap, complete, and
// independent of random generation sizing.

function paraRun(length: number): ContentDocumentV1 {
  return {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "x".repeat(length) }],
      },
    ],
  };
}

/** Adjacent same-mark run pairs whose merge length straddles textRun (B-F01). */
export function nearLimitMergeGrid(): Array<{
  name: string;
  doc: ContentDocumentV1;
}> {
  const out: Array<{ name: string; doc: ContentDocumentV1 }> = [];
  const lengths = [TEXT_RUN_LIMIT - 1, TEXT_RUN_LIMIT, TEXT_RUN_LIMIT + 1];
  for (const a of lengths) {
    for (const b of lengths) {
      out.push({
        name: `merge-${a}+${b}`,
        doc: {
          docVersion: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "x".repeat(a), marks: ["bold"] },
                { type: "text", text: "y".repeat(b), marks: ["bold"] },
              ],
            },
          ],
        },
      });
    }
  }
  return out;
}

/**
 * Boundary grid. `expectLimitsClean` is the grid's OWN composition claim —
 * the test asserts it against the kernel authority, so a mislabeled entry
 * fails loudly instead of silently narrowing coverage.
 *
 * Combined-limit facts encoded here (as-built, kernel counting semantics):
 * - a leafed listDepth-8 chain peaks at tree depth 17 > 16, so listDepth 8
 *   is reachable ONLY with an empty innermost listItem (depth exactly 16);
 * - a 100×20 table with paragraph-bearing cells costs 4101 nodes, so the
 *   table edge that matters under totalNodes 2000 is cells ≤ 400
 *   (100 rows × 4 cols);
 * - serialized overhead of the JSON envelope is subtracted from the real
 *   envelope, not from a guessed constant.
 */
export function exactLimitDocs(): Array<{
  name: string;
  doc: ContentDocumentV1;
  expectLimitsClean: boolean;
  dirtyReason?: RegExp;
}> {
  // Paragraph docs whose runs each stay under textRun, so the serialized
  // edge is the ONLY limit engaged — a single codeBlock sized to ~131k chars
  // would trip `code block exceeds 40000` long before serialization.
  const runDoc = (runLengths: number[]): ContentDocumentV1 => ({
    docVersion: 1,
    type: "doc",
    content: runLengths.map((n) => ({
      type: "paragraph" as const,
      content: [{ type: "text" as const, text: "x".repeat(n) }],
    })),
  });
  // Empirical envelope math: grow full-limit runs until one more would
  // overshoot LIMIT - 1, then size the final run to land exactly on it.
  const serializedLen = (rs: number[]): number =>
    JSON.stringify(runDoc(rs)).length;
  const atLimitRuns: number[] = [];
  while (
    serializedLen([...atLimitRuns, TEXT_RUN_LIMIT]) <=
    SERIALIZED_LIMIT - 1
  ) {
    atLimitRuns.push(TEXT_RUN_LIMIT);
  }
  atLimitRuns.push(SERIALIZED_LIMIT - 1 - serializedLen([...atLimitRuns, 0]));
  return [
    {
      name: "textRun-at-limit",
      doc: paraRun(TEXT_RUN_LIMIT),
      expectLimitsClean: true,
    },
    {
      name: "textRun-over-limit",
      doc: paraRun(TEXT_RUN_LIMIT + 1),
      expectLimitsClean: false,
      dirtyReason: /text run exceeds 20000 chars/,
    },
    {
      name: "latex-at-limit",
      doc: {
        docVersion: 1,
        type: "doc",
        content: [{ type: "blockMath", latex: "x".repeat(LATEX_LIMIT) }],
      },
      expectLimitsClean: true,
    },
    {
      name: "latex-over-limit",
      doc: {
        docVersion: 1,
        type: "doc",
        content: [{ type: "blockMath", latex: "x".repeat(LATEX_LIMIT + 1) }],
      },
      expectLimitsClean: false,
      dirtyReason: /latex exceeds 5000 chars/,
    },
    {
      name: "codeBlock-at-limit",
      doc: {
        docVersion: 1,
        type: "doc",
        content: [
          { type: "codeBlock", language: "ts", text: "x".repeat(CODE_LIMIT) },
        ],
      },
      expectLimitsClean: true,
    },
    {
      name: "codeBlock-over-limit",
      doc: {
        docVersion: 1,
        type: "doc",
        content: [
          {
            type: "codeBlock",
            language: "ts",
            text: "x".repeat(CODE_LIMIT + 1),
          },
        ],
      },
      expectLimitsClean: false,
      dirtyReason: /code block exceeds 40000 chars/,
    },
    {
      name: "listDepth-7-leafed (depth 15)",
      doc: nestedListChain(7),
      expectLimitsClean: true,
    },
    {
      name: "listDepth-8-leafed-paragraph (depth 17 > 16)",
      doc: nestedListChain(8),
      expectLimitsClean: false,
      dirtyReason: /tree depth exceeds 16/,
    },
    {
      name: "listDepth-9-leafed-over",
      doc: nestedListChain(9),
      expectLimitsClean: false,
      dirtyReason: /list nesting exceeds 8/,
    },
    {
      name: "nodes-exact-2000",
      doc: {
        docVersion: 1,
        type: "doc",
        content: Array.from({ length: TOTAL_NODES_LIMIT }, () => ({
          type: "paragraph" as const,
          content: [],
        })),
      },
      expectLimitsClean: true,
    },
    {
      name: "nodes-over-2000",
      doc: {
        docVersion: 1,
        type: "doc",
        content: Array.from({ length: TOTAL_NODES_LIMIT + 1 }, () => ({
          type: "paragraph" as const,
          content: [],
        })),
      },
      expectLimitsClean: false,
      dirtyReason: /document exceeds 2000 nodes/,
    },
    {
      name: "table-max-cells-400 (100 rows × 4 cols)",
      doc: {
        docVersion: 1,
        type: "doc",
        content: [
          {
            type: "table",
            content: Array.from({ length: TABLE_ROWS_LIMIT }, () => ({
              type: "tableRow" as const,
              content: Array.from({ length: 4 }, () => ({
                type: "tableCell" as const,
                content: [{ type: "paragraph" as const, content: [] }],
              })),
            })),
          },
        ],
      },
      expectLimitsClean: true,
    },
    {
      name: "table-100x20-cells-2000-over",
      doc: {
        docVersion: 1,
        type: "doc",
        content: [
          {
            type: "table",
            content: Array.from({ length: TABLE_ROWS_LIMIT }, () => ({
              type: "tableRow" as const,
              content: Array.from({ length: TABLE_COLS_LIMIT }, () => ({
                type: "tableCell" as const,
                content: [{ type: "paragraph" as const, content: [] }],
              })),
            })),
          },
        ],
      },
      expectLimitsClean: false,
      dirtyReason: /table exceeds 400 cells/,
    },
    {
      name: "serialized-at-limit-minus-1",
      doc: runDoc(atLimitRuns),
      expectLimitsClean: true,
    },
    {
      name: "serialized-over-limit",
      // Kernel limit checks are strict `>`: exactly-at-limit is legal, so the
      // over-probe is LIMIT + 1 (at-limit-minus-1 baseline + 2 chars).
      doc: runDoc([
        ...atLimitRuns.slice(0, -1),
        atLimitRuns[atLimitRuns.length - 1] + 2,
      ]),
      expectLimitsClean: false,
      dirtyReason: /serialized document exceeds 131072 chars/,
    },
  ];
}
