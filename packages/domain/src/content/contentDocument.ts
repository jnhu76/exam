/**
 * ContentDocumentV1 — the Exam-owned canonical rich content grammar (#301).
 *
 * This module is the single server-side authority for the V1 document shape:
 * structural limits, canonical normalization, and the deterministic plain-text
 * projection. It is pure TypeScript with zero dependencies so that every
 * consumer (contracts wire schemas, API routes, the exam engine, and the web
 * renderer/editor adapter) shares one implementation.
 *
 * Authority model (B′ additive projection, #301 §2):
 *   contentDocument == null  → Plain  → `content` is authoritative.
 *   contentDocument != null  → Rich   → the document is authoritative and
 *                                       `content` MUST equal
 *                                       plainTextProjection(contentDocument).
 * The persisted `content` of a Rich question/option is always a server-derived
 * projection, never a second authority.
 *
 * The grammar is closed: any node/mark/attribute not defined here is invalid
 * and must fail closed at the write boundary. Image/attachment nodes are
 * deliberately absent until an Asset authority exists (ContentDocumentV2).
 */

/** Current document envelope version. */
export const CONTENT_DOC_VERSION = 1;

/** Plain/Rich discriminator shared by question content mode and answer mode. */
export type ContentMode = "plain" | "rich";

// ── Marks ─────────────────────────────────────────────────────────

export type ContentMarkType = "bold" | "italic" | "underline" | "inlineCode";

/**
 * Canonical mark order. Normalized documents always carry marks in this
 * order so structurally identical inline content compares equal.
 */
const MARK_CANONICAL_ORDER: readonly ContentMarkType[] = [
  "bold",
  "italic",
  "underline",
  "inlineCode",
];

/** `inlineCode` excludes every other mark (matches the editor's code mark). */
const EXCLUSIVE_MARKS: readonly ContentMarkType[] = ["inlineCode"];

// ── Inline nodes ──────────────────────────────────────────────────

export interface ContentTextRun {
  type: "text";
  text: string;
  marks?: ContentMarkType[];
}

export interface ContentHardBreak {
  type: "hardBreak";
}

export interface ContentInlineMath {
  type: "inlineMath";
  latex: string;
}

export type ContentInline =
  | ContentTextRun
  | ContentHardBreak
  | ContentInlineMath;

// ── Block nodes ───────────────────────────────────────────────────

export interface ContentParagraph {
  type: "paragraph";
  content: ContentInline[];
}

export interface ContentListItem {
  type: "listItem";
  content: Array<ContentParagraph | ContentBulletList | ContentOrderedList>;
}

export interface ContentBulletList {
  type: "bulletList";
  content: ContentListItem[];
}

export interface ContentOrderedList {
  type: "orderedList";
  content: ContentListItem[];
}

/**
 * Display-only code block. `text` is the verbatim code (whitespace
 * significant — normalization never trims it). `language` is null or a
 * bounded identifier (CODE_LANGUAGE_PATTERN); it is presentation metadata,
 * never executed or highlighted server-side in V1.
 */
export interface ContentCodeBlock {
  type: "codeBlock";
  language: string | null;
  text: string;
}

export interface ContentBlockMath {
  type: "blockMath";
  latex: string;
}

export interface ContentTableCell {
  type: "tableCell";
  content: ContentParagraph[];
}

export interface ContentTableRow {
  type: "tableRow";
  content: ContentTableCell[];
}

export interface ContentTable {
  type: "table";
  content: ContentTableRow[];
}

export type ContentBlock =
  | ContentParagraph
  | ContentBulletList
  | ContentOrderedList
  | ContentCodeBlock
  | ContentBlockMath
  | ContentTable;

// ── Document envelope ─────────────────────────────────────────────

export interface ContentDocumentV1 {
  docVersion: typeof CONTENT_DOC_VERSION;
  type: "doc";
  content: ContentBlock[];
}

// ── Structural limits (#301 §20) ──────────────────────────────────
//
// Bounded well under the Fastify default 1 MiB body limit so a rich question
// or a rich answer can never approach the transport ceiling on its own, while
// leaving generous room for real exam workloads (multi-page prompts, code,
// tables). Character counts are the deterministic authority (JS string length,
// not UTF-8 bytes) so limits evaluate identically in node and browser.

export const CONTENT_LIMITS = {
  /** Max JSON.stringify(document).length (chars). */
  serializedChars: 131072,
  /** Max total content nodes (blocks + inlines, excluding the doc envelope). */
  totalNodes: 2000,
  /** Max tree depth (doc = depth 0; a paragraph is depth 1; etc.). */
  depth: 16,
  /** Max list nesting depth (a list inside a list inside a list …). */
  listDepth: 8,
  /** Max rows per table. */
  tableRows: 100,
  /** Max columns per table row. */
  tableCols: 20,
  /** Max total cells per table. */
  tableCells: 400,
  /** Max length of one text run. */
  textRun: 20000,
  /** Max length of one code block. */
  codeBlock: 40000,
  /** Max length of one LaTeX source (inline or block). */
  latex: 5000,
} as const;

/** Language identifiers allowed on a code block (presentation metadata only). */
export const CODE_LANGUAGE_PATTERN = /^[A-Za-z0-9+#._-]{1,32}$/;

// ── Limits checking ───────────────────────────────────────────────

/** Aggregated structural counters used by the depth/size limit checks. */
interface WalkState {
  nodes: number;
  maxDepth: number;
  listDepth: number;
  violations: string[];
}

function pushInlineViolation(state: WalkState, inline: ContentInline): void {
  state.nodes += 1;
  if (inline.type === "text" && inline.text.length > CONTENT_LIMITS.textRun) {
    state.violations.push(`text run exceeds ${CONTENT_LIMITS.textRun} chars`);
  }
  if (
    inline.type === "inlineMath" &&
    inline.latex.length > CONTENT_LIMITS.latex
  ) {
    state.violations.push(`latex exceeds ${CONTENT_LIMITS.latex} chars`);
  }
}

function pushBlockViolations(
  block: ContentBlock | ContentListItem | ContentTableCell,
  depth: number,
  listDepth: number,
  state: WalkState,
): void {
  state.nodes += 1;
  state.maxDepth = Math.max(state.maxDepth, depth);
  if (state.maxDepth > CONTENT_LIMITS.depth) {
    state.violations.push(`tree depth exceeds ${CONTENT_LIMITS.depth}`);
  }

  switch (block.type) {
    case "paragraph": {
      for (const inline of block.content) pushInlineViolation(state, inline);
      break;
    }
    case "listItem": {
      for (const child of block.content) {
        const childListDepth =
          child.type === "bulletList" || child.type === "orderedList"
            ? listDepth + 1
            : listDepth;
        if (childListDepth > CONTENT_LIMITS.listDepth) {
          state.violations.push(
            `list nesting exceeds ${CONTENT_LIMITS.listDepth}`,
          );
        }
        pushBlockViolations(child, depth + 1, childListDepth, state);
      }
      break;
    }
    case "bulletList":
    case "orderedList": {
      for (const item of block.content) {
        pushBlockViolations(item, depth + 1, listDepth, state);
      }
      break;
    }
    case "codeBlock": {
      if (block.text.length > CONTENT_LIMITS.codeBlock) {
        state.violations.push(
          `code block exceeds ${CONTENT_LIMITS.codeBlock} chars`,
        );
      }
      break;
    }
    case "blockMath": {
      if (block.latex.length > CONTENT_LIMITS.latex) {
        state.violations.push(`latex exceeds ${CONTENT_LIMITS.latex} chars`);
      }
      break;
    }
    case "table": {
      if (block.content.length > CONTENT_LIMITS.tableRows) {
        state.violations.push(`table exceeds ${CONTENT_LIMITS.tableRows} rows`);
      }
      let cells = 0;
      for (const row of block.content) {
        state.nodes += 1;
        if (row.content.length > CONTENT_LIMITS.tableCols) {
          state.violations.push(
            `table row exceeds ${CONTENT_LIMITS.tableCols} columns`,
          );
        }
        for (const cell of row.content) {
          cells += 1;
          pushBlockViolations(cell, depth + 2, listDepth, state);
        }
      }
      if (cells > CONTENT_LIMITS.tableCells) {
        state.violations.push(
          `table exceeds ${CONTENT_LIMITS.tableCells} cells`,
        );
      }
      break;
    }
  }
}

/**
 * Returns every structural-limit violation of the document (empty array =
 * within limits). Pure; the authoritative limit source is CONTENT_LIMITS.
 */
export function checkContentDocumentLimits(doc: ContentDocumentV1): string[] {
  const violations: string[] = [];
  if (doc.docVersion !== CONTENT_DOC_VERSION) {
    violations.push(`docVersion must be ${CONTENT_DOC_VERSION}`);
  }
  const serialized = JSON.stringify(doc);
  if (serialized.length > CONTENT_LIMITS.serializedChars) {
    violations.push(
      `serialized document exceeds ${CONTENT_LIMITS.serializedChars} chars`,
    );
  }
  const state: WalkState = { nodes: 0, maxDepth: 0, listDepth: 0, violations };
  for (const block of doc.content) {
    pushBlockViolations(block, 1, 1, state);
  }
  if (state.nodes > CONTENT_LIMITS.totalNodes) {
    violations.push(`document exceeds ${CONTENT_LIMITS.totalNodes} nodes`);
  }
  return violations;
}

// ── Normalization ─────────────────────────────────────────────────
//
// Canonicalization runs AFTER schema validation and BEFORE any equality,
// idempotency, persistence, or projection decision (#301 §22/§40). It must be
// deterministic and idempotent: normalize(normalize(x)) === normalize(x). It
// never alters user-visible text semantics — code and math whitespace is
// preserved verbatim.

function canonicalMarks(marks: ContentMarkType[] | undefined): {
  marks?: ContentMarkType[];
} {
  if (!marks || marks.length === 0) return {};
  const unique = [...new Set(marks)].filter((mark, _, all) =>
    EXCLUSIVE_MARKS.includes(mark) ? all.length === 1 : true,
  );
  if (unique.length === 0) return {};
  unique.sort(
    (a, b) => MARK_CANONICAL_ORDER.indexOf(a) - MARK_CANONICAL_ORDER.indexOf(b),
  );
  return { marks: unique };
}

function normalizeInline(inline: ContentInline): ContentInline | null {
  switch (inline.type) {
    case "text": {
      if (inline.text === "") return null;
      const marks = canonicalMarks(inline.marks);
      return marks.marks
        ? { ...inline, ...marks }
        : { type: "text", text: inline.text };
    }
    case "hardBreak":
      return inline;
    case "inlineMath":
      return inline;
    default:
      throw new Error("normalizeContentDocument: unknown inline node");
  }
}

function normalizeInlineList(inlines: ContentInline[]): ContentInline[] {
  const result: ContentInline[] = [];
  for (const raw of inlines) {
    const inline = normalizeInline(raw);
    if (!inline) continue;
    const previous = result[result.length - 1];
    // Merge adjacent text runs carrying identical mark sets so that
    // semantically identical inline content has one canonical form.
    if (previous && previous.type === "text" && inline.type === "text") {
      const previousMarks = canonicalMarks(previous.marks).marks;
      const inlineMarks = canonicalMarks(inline.marks).marks;
      if (previousMarks?.join("|") === inlineMarks?.join("|")) {
        result[result.length - 1] = {
          type: "text",
          text: previous.text + inline.text,
          ...(previousMarks ? { marks: previousMarks } : {}),
        };
        continue;
      }
    }
    result.push(inline);
  }
  return result;
}

function isEmptyParagraph(block: ContentBlock): boolean {
  return (
    block.type === "paragraph" &&
    (block.content.length === 0 ||
      block.content.every(
        (inline) => inline.type === "text" && inline.text === "",
      ))
  );
}

function normalizeListItemChildren(
  children: ContentListItem["content"],
): ContentListItem["content"] {
  const result: ContentListItem["content"] = [];
  for (const child of children) {
    if (child.type === "paragraph") {
      const content = normalizeInlineList(child.content);
      result.push({ type: "paragraph", content });
      continue;
    }
    const list = normalizeList(child);
    if (list) result.push(list);
  }
  // Drop trailing empty paragraphs — ProseMirror documents always terminate
  // with a paragraph, so a trailing empty paragraph is an editor artifact,
  // not user content.
  for (;;) {
    const last = result[result.length - 1];
    if (!last || last.type !== "paragraph" || last.content.length !== 0) break;
    result.pop();
  }
  return result;
}

function normalizeList(
  list: ContentBulletList | ContentOrderedList,
): ContentBulletList | ContentOrderedList | null {
  const items: ContentListItem[] = [];
  for (const rawItem of list.content) {
    const content = normalizeListItemChildren(rawItem.content);
    // INVARIANT: an empty list item carries no content and no user intent —
    // dropping it keeps list projection and equality stable.
    if (content.length === 0) continue;
    items.push({ type: "listItem", content });
  }
  if (items.length === 0) return null;
  return list.type === "bulletList"
    ? { type: "bulletList", content: items }
    : { type: "orderedList", content: items };
}

/**
 * Canonicalizes a schema-valid document: canonical mark order, merged adjacent
 * identical text runs, no empty text runs, no empty list items or lists, no
 * trailing empty paragraphs. Throws on structurally unknown nodes — the input
 * contract is a schema-valid document, and silent passthrough would leak
 * non-canonical state into equality/persistence.
 */
export function normalizeContentDocument(
  doc: ContentDocumentV1,
): ContentDocumentV1 {
  if (doc.docVersion !== CONTENT_DOC_VERSION || doc.type !== "doc") {
    throw new Error("normalizeContentDocument: unsupported document envelope");
  }
  const blocks: ContentBlock[] = [];
  for (const rawBlock of doc.content) {
    switch (rawBlock.type) {
      case "paragraph": {
        blocks.push({
          type: "paragraph",
          content: normalizeInlineList(rawBlock.content),
        });
        break;
      }
      case "bulletList":
      case "orderedList": {
        const list = normalizeList(rawBlock);
        if (list) blocks.push(list);
        break;
      }
      case "codeBlock": {
        const language =
          rawBlock.language && CODE_LANGUAGE_PATTERN.test(rawBlock.language)
            ? rawBlock.language
            : null;
        blocks.push({ type: "codeBlock", language, text: rawBlock.text });
        break;
      }
      case "blockMath": {
        blocks.push({ type: "blockMath", latex: rawBlock.latex });
        break;
      }
      case "table": {
        blocks.push({
          type: "table",
          content: rawBlock.content.map((row) => ({
            type: "tableRow",
            content: row.content.map((cell) => ({
              type: "tableCell",
              content: cell.content.map((paragraph) => ({
                type: "paragraph",
                content: normalizeInlineList(paragraph.content),
              })),
            })),
          })),
        });
        break;
      }
      default:
        throw new Error("normalizeContentDocument: unknown block node");
    }
  }
  for (;;) {
    const last = blocks[blocks.length - 1];
    if (!last || !isEmptyParagraph(last)) break;
    blocks.pop();
  }
  return { docVersion: CONTENT_DOC_VERSION, type: "doc", content: blocks };
}

// ── Plain-text projection ─────────────────────────────────────────
//
// Deterministic plain-text view of a rich document. Frozen mapping (#301 §18):
//   paragraph / list items / table rows → "\n" separated
//   table cells → single-space separated
//   inline math / block math → LaTeX source
//   code block → verbatim source
//   hardBreak → "\n"
// The projection feeds `questions.content`, SQL search, CSV export, and every
// plain display fallback. It must never contain anything but content text.

function projectInline(inlines: ContentInline[]): string {
  let result = "";
  for (const inline of inlines) {
    if (inline.type === "text") result += inline.text;
    else if (inline.type === "hardBreak") result += "\n";
    else if (inline.type === "inlineMath") result += inline.latex;
  }
  return result;
}

function projectListItems(items: ContentListItem[]): string {
  return items
    .map((item) =>
      item.content
        .map((child) =>
          child.type === "paragraph"
            ? projectInline(child.content)
            : projectBlock(child),
        )
        .join("\n"),
    )
    .join("\n");
}

function projectBlock(block: ContentBlock): string {
  switch (block.type) {
    case "paragraph":
      return projectInline(block.content);
    case "bulletList":
    case "orderedList":
      return projectListItems(block.content);
    case "codeBlock":
      return block.text;
    case "blockMath":
      return block.latex;
    case "table":
      return block.content
        .map((row) =>
          row.content
            .map((cell) =>
              cell.content
                .map((paragraph) => projectInline(paragraph.content))
                .join(" "),
            )
            .join(" "),
        )
        .join("\n");
  }
}

/**
 * Deterministic plain-text projection of a rich document (the Rich-side
 * complement of `content`). Pure; same document → same string, always.
 */
export function plainTextProjection(doc: ContentDocumentV1): string {
  return doc.content.map(projectBlock).join("\n");
}

// ── Mode helpers ──────────────────────────────────────────────────

/**
 * Resolves the content mode of a stored document slot: null/undefined is
 * Plain (content authoritative), anything else is Rich (document
 * authoritative). Single authority for the B′ discriminator.
 */
export function contentModeOf(
  document: ContentDocumentV1 | null | undefined,
): ContentMode {
  return document == null ? "plain" : "rich";
}

/**
 * Converts plain text (lines separated by "\n") into a minimal canonical
 * document — one paragraph per line, blank lines preserved as empty
 * paragraphs. Used by the authoring UI's Plain → Rich upgrade path.
 */
export function plainTextToDocument(text: string): ContentDocumentV1 {
  return {
    docVersion: CONTENT_DOC_VERSION,
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph" as const,
      content: line === "" ? [] : [{ type: "text" as const, text: line }],
    })),
  };
}
