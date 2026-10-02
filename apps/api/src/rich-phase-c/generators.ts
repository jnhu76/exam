/**
 * Phase-C adversarial discovery harness (#669 Phase C) — deterministic
 * generators and oracle helpers.
 *
 * RESEARCH HARNESS ONLY: this file is discovery tooling on the
 * research/669-rich-phase-c-adversarial-discovery branch, not a permanent
 * regression suite and not production code. It exercises only real production
 * functions (domain kernel, wire schema, validateAnswerForQuestion); the
 * helpers below are generator/equality infrastructure for the ORACLE side,
 * never a reimplementation of normalize/limits/preflight logic.
 *
 * Reproducibility envelope (#669 Phase C §5): fixed seeds, bounded case
 * counts, bounded wall time, reproducible fixtures.
 */

import type {
  ContentBlock,
  ContentBulletList,
  ContentDocumentV1,
  ContentInline,
  ContentMarkType,
  ContentOrderedList,
  ContentParagraph,
  ContentTableCell,
  ContentTableRow,
} from "@exam/domain";

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

export function intBetween(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ── Structural equality (oracle side only) ────────────────────────

/**
 * Sorted-key structural equality with the same semantics as the SaveAnswer
 * protocol's idempotency equality (`answersEqual` in exam-engine): primitives
 * via Object.is, arrays ordered, plain objects compared key-by-key after
 * sorting. Used here ONLY to express canonical identity of oracle outputs.
 */
export function structuralEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!structuralEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const keysA = Object.keys(a as Record<string, unknown>).sort();
    const keysB = Object.keys(b as Record<string, unknown>).sort();
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
      if (keysA[i] !== keysB[i]) return false;
      if (
        !structuralEqual(
          (a as Record<string, unknown>)[keysA[i] as string],
          (b as Record<string, unknown>)[keysA[i] as string],
        )
      ) {
        return false;
      }
    }
    return true;
  }
  return false;
}

// ── Document generator ────────────────────────────────────────────

/**
 * Mark-set pool. Everything here is wire-legal (inlineCode only alone);
 * non-canonical orderings and duplicates are deliberate closure stress.
 */
const MARK_POOLS: Array<ContentMarkType[] | undefined> = [
  undefined,
  [],
  ["bold"],
  ["italic"],
  ["underline"],
  ["inlineCode"],
  ["bold", "italic"],
  ["italic", "bold"],
  ["bold", "bold"],
  ["bold", "italic", "underline"],
  ["underline", "bold", "underline"],
  ["italic", "underline", "italic", "bold"],
];

/** Text-length pool biased at the textRun boundary (20000) and merge-heavy sizes. */
const TEXT_LENGTHS = [
  0, 1, 2, 3, 5, 17, 100, 999, 4999, 5000, 5001, 6666, 9999, 10000, 10001,
  13333, 13334, 19999, 20000, 20001,
];

const LATEX_POOL = [
  "x",
  "a+b=c",
  "\\frac{1}{2}",
  "x^{2}",
  "\\sum_{i=1}^{n} i",
  "中文公式",
  "\\frac{1}{",
  "x".repeat(4999),
  "y".repeat(5000),
  "z".repeat(5001),
];

const CODE_LANGUAGES = [
  null,
  "ts",
  "python",
  "C++",
  "has space",
  "a".repeat(33),
];

function randomInline(rng: () => number, boundaryBias: boolean): ContentInline {
  const roll = rng();
  if (roll < 0.72) {
    const len = boundaryBias ? pick(rng, TEXT_LENGTHS) : intBetween(rng, 0, 40);
    const marks = pick(rng, MARK_POOLS);
    return {
      type: "text",
      text: pick(rng, ["a", "b", "字", "👍", "e"]).repeat(len),
      ...(marks && marks.length > 0 ? { marks } : {}),
    };
  }
  if (roll < 0.8) return { type: "hardBreak" };
  const latex = boundaryBias
    ? pick(rng, LATEX_POOL)
    : pick(rng, LATEX_POOL.slice(0, 6));
  return { type: "inlineMath", latex };
}

function randomParagraph(
  rng: () => number,
  boundaryBias: boolean,
): ContentParagraph {
  const runCount = boundaryBias ? intBetween(rng, 0, 6) : intBetween(rng, 0, 4);
  const content: ContentInline[] = [];
  // Bias toward adjacent same-mark runs (merge stress for normalization).
  const sharedMarks = pick(rng, MARK_POOLS);
  for (let i = 0; i < runCount; i++) {
    const inline = randomInline(rng, boundaryBias);
    if (inline.type === "text" && rng() < 0.6) {
      content.push({
        type: "text",
        text: inline.text,
        ...(sharedMarks && sharedMarks.length > 0
          ? { marks: [...sharedMarks] }
          : {}),
      });
    } else {
      content.push(inline);
    }
  }
  return { type: "paragraph", content };
}

function randomList(
  rng: () => number,
  depth: number,
  boundaryBias: boolean,
): ContentBlock {
  const items: Array<{
    type: "listItem";
    content: Array<ContentParagraph | ContentBulletList | ContentOrderedList>;
  }> = [];
  const itemCount = intBetween(rng, 0, 3);
  for (let i = 0; i < itemCount; i++) {
    const children: Array<
      ContentParagraph | ContentBulletList | ContentOrderedList
    > = [];
    const childCount = intBetween(rng, depth < 3 ? 1 : 0, 2);
    for (let c = 0; c < childCount; c++) {
      if (depth < 3 && rng() < 0.3) {
        const nested = randomList(rng, depth + 1, boundaryBias);
        if (nested.type === "bulletList" || nested.type === "orderedList") {
          children.push(nested);
        }
      } else {
        children.push(randomParagraph(rng, boundaryBias));
      }
    }
    // Occasionally append a trailing empty paragraph (cleanup stress).
    if (rng() < 0.2) children.push({ type: "paragraph", content: [] });
    items.push({ type: "listItem", content: children });
  }
  return rng() < 0.5
    ? { type: "bulletList", content: items }
    : { type: "orderedList", content: items };
}

function randomTable(rng: () => number, boundaryBias: boolean): ContentBlock {
  const rows = intBetween(rng, 1, 3);
  const cols = intBetween(rng, 1, 3);
  const ragged = rng() < 0.05;
  const content: ContentTableRow[] = [];
  for (let r = 0; r < rows; r++) {
    const width = ragged && r === rows - 1 ? cols + 1 : cols;
    const cells: ContentTableCell[] = [];
    for (let c = 0; c < width; c++) {
      const paras = intBetween(rng, 1, 2);
      const cellContent: ContentParagraph[] = [];
      for (let p = 0; p < paras; p++) {
        const paraBlock = randomParagraph(rng, boundaryBias);
        if (paraBlock.type === "paragraph") cellContent.push(paraBlock);
      }
      if (cellContent.length === 0) {
        cellContent.push({ type: "paragraph", content: [] });
      }
      cells.push({ type: "tableCell", content: cellContent });
    }
    content.push({ type: "tableRow", content: cells });
  }
  return { type: "table", content };
}

function randomBlock(rng: () => number, boundaryBias: boolean): ContentBlock {
  const roll = rng();
  if (roll < 0.55) return randomParagraph(rng, boundaryBias);
  if (roll < 0.7) return randomList(rng, 1, boundaryBias);
  if (roll < 0.8) return randomTable(rng, boundaryBias);
  if (roll < 0.9) {
    const language = pick(rng, CODE_LANGUAGES);
    return {
      type: "codeBlock",
      language,
      text: "code".repeat(intBetween(rng, 0, boundaryBias ? 10001 : 20)),
    };
  }
  const latex = boundaryBias
    ? pick(rng, LATEX_POOL)
    : pick(rng, LATEX_POOL.slice(0, 6));
  return { type: "blockMath", latex };
}

export interface GeneratedDoc {
  doc: ContentDocumentV1;
  /** Rough shape tag for corpus accounting. */
  shape: string;
}

/**
 * Generates a V1-shaped document (grammatically valid BY CONSTRUCTION; may
 * intentionally exceed product limits — the campaign's legality gate filters).
 */
export function generateDoc(
  rng: () => number,
  boundaryBias: boolean,
): GeneratedDoc {
  const blockCount = intBetween(rng, 0, 5);
  const content: ContentBlock[] = [];
  const shapes: string[] = [];
  for (let i = 0; i < blockCount; i++) {
    const block = randomBlock(rng, boundaryBias);
    shapes.push(block.type);
    content.push(block);
    // Trailing empty paragraph stress.
    if (rng() < 0.15) {
      content.push({ type: "paragraph", content: [] });
      shapes.push("empty-paragraph");
    }
  }
  return {
    doc: { docVersion: 1, type: "doc", content },
    shape: shapes.join("+") || "empty-doc",
  };
}

// ── Shrinker ──────────────────────────────────────────────────────

type Shrinkable = { doc: ContentDocumentV1 };

function clone(doc: ContentDocumentV1): ContentDocumentV1 {
  return JSON.parse(JSON.stringify(doc)) as ContentDocumentV1;
}

function inlineTextRuns(
  doc: ContentDocumentV1,
): Array<{ para: { content: ContentInline[] }; index: number }> {
  const runs: Array<{ para: { content: ContentInline[] }; index: number }> = [];
  const visitBlocks = (blocks: ContentBlock[]): void => {
    for (const block of blocks) {
      switch (block.type) {
        case "paragraph":
          block.content.forEach((inline, index) => {
            if (inline.type === "text") runs.push({ para: block, index });
          });
          break;
        case "bulletList":
        case "orderedList":
          for (const item of block.content) visitBlocks(item.content);
          break;
        case "table":
          for (const row of block.content)
            for (const cell of row.content) visitBlocks(cell.content);
          break;
        default:
          break;
      }
    }
  };
  visitBlocks(doc.content);
  return runs;
}

/**
 * Deterministic greedy shrinker: repeatedly try (a) halving text-run lengths
 * and (b) removing blocks, keeping any mutation that preserves the failure.
 * Returns the smallest observed failing fixture.
 */
export function shrinkDoc(
  doc: ContentDocumentV1,
  fails: (candidate: ContentDocumentV1) => boolean,
): ContentDocumentV1 {
  let current: Shrinkable = { doc: clone(doc) };
  let changed = true;
  while (changed) {
    changed = false;
    // (a) shrink text runs toward the minimal {20000, 1}-class shape
    for (const run of inlineTextRuns(current.doc)) {
      const original = (run.para.content[run.index] as { text: string }).text;
      for (const candidate of [1, 2, 10, Math.floor(original.length / 2)]) {
        if (candidate >= original.length || candidate < 1) continue;
        (run.para.content[run.index] as { text: string }).text = original.slice(
          0,
          candidate,
        );
        if (fails(current.doc)) {
          changed = true;
          break;
        }
        (run.para.content[run.index] as { text: string }).text = original;
      }
    }
    // (b) drop trailing blocks while the failure survives
    while (current.doc.content.length > 1) {
      const original = current.doc.content;
      current.doc = { ...current.doc, content: original.slice(0, -1) };
      if (fails(current.doc)) {
        changed = true;
      } else {
        current.doc = { ...current.doc, content: original };
        break;
      }
    }
  }
  return current.doc;
}

/**
 * WHY: the research ledgers emit machine-readable measurements so a re-run
 * reproduces the recorded evidence. The repository quality gate
 * (scripts/check-code-quality.mjs) forbids `console.*` in committed files and
 * has no disable mechanism, so the harness writes its ledger lines through
 * stdout directly. Discovery-harness-only; never import from production code.
 */
export function emitLedgerLine(marker: string, payload: unknown): void {
  process.stdout.write(`${marker} ${JSON.stringify(payload)}\n`);
}
