import type { JSONContent } from "@tiptap/core";
import {
  CODE_LANGUAGE_PATTERN,
  CONTENT_DOC_VERSION,
  normalizeContentDocument,
  plainTextProjection,
  type ContentBlock,
  type ContentDocumentV1,
  type ContentInline,
  type ContentListItem,
  type ContentMarkType,
  type ContentParagraph,
} from "@exam/domain";

/**
 * Thin, replaceable mapping between the frozen ContentDocumentV1 grammar and
 * Tiptap's JSON (issue 301). Tiptap is an EDIT-SURFACE detail, never the
 * storage authority: the editor emits Tiptap JSON, this adapter maps it into
 * the canonical grammar (then normalizes), and the server re-validates every
 * write. Anything outside the allow-listed vocabulary throws — the editor
 * allow-list makes that unreachable in practice; the throw is the fail-safe.
 *
 * Known downgrades (grammar has no such node): Tiptap `tableHeader` →
 * `tableCell`; `code` mark → `inlineCode`; colspan/rowspan/colwidth table
 * attrs are dropped (grammar tables are rectangular and unspanned).
 */

/** Marks the grammar supports, keyed by their Tiptap mark names. */
const TIPTAP_MARK_TO_GRAMMAR: Record<string, ContentMarkType> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  code: "inlineCode",
};

/** Reverse map for emitting Tiptap JSON from grammar marks. */
const GRAMMAR_MARK_TO_TIPTAP: Record<string, string> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  inlineCode: "code",
};

function sanitizeLanguage(language: unknown): string | null {
  return typeof language === "string" && CODE_LANGUAGE_PATTERN.test(language)
    ? language
    : null;
}

/** Maps one grammar inline node to its Tiptap JSON shape. */
function inlineToTiptap(inline: ContentInline): JSONContent {
  switch (inline.type) {
    case "text":
      return {
        type: "text",
        text: inline.text,
        ...(inline.marks?.length
          ? {
              marks: inline.marks
                .map((mark) => GRAMMAR_MARK_TO_TIPTAP[mark] ?? mark)
                .map((type) => ({ type })),
            }
          : {}),
      };
    case "hardBreak":
      return { type: "hardBreak" };
    case "inlineMath":
      return { type: "inlineMath", attrs: { latex: inline.latex } };
  }
}

/** Maps one grammar block node to its Tiptap JSON shape. */
function blockToTiptap(block: ContentBlock): JSONContent {
  switch (block.type) {
    case "paragraph":
      return {
        type: "paragraph",
        ...(block.content.length
          ? { content: block.content.map(inlineToTiptap) }
          : {}),
      };
    case "bulletList":
    case "orderedList":
      return {
        type: block.type,
        content: block.content.map((item) => ({
          type: "listItem",
          content: item.content.map(blockToTiptap),
        })),
      };
    case "codeBlock":
      return {
        type: "codeBlock",
        attrs: { language: block.language },
        ...(block.text
          ? { content: [{ type: "text", text: block.text }] }
          : {}),
      };
    case "blockMath":
      return { type: "blockMath", attrs: { latex: block.latex } };
    case "table":
      return {
        type: "table",
        content: block.content.map((row) => ({
          type: "tableRow",
          content: row.content.map((cell) => ({
            type: "tableCell",
            content: cell.content.map(blockToTiptap),
          })),
        })),
      };
  }
}

/** Converts a canonical document into Tiptap JSON for editor consumption. */
export function contentDocumentToTiptap(
  document: ContentDocumentV1,
): JSONContent {
  return { type: "doc", content: document.content.map(blockToTiptap) };
}

/** Marks passthrough for text nodes; unknown marks are dropped. */
function marksFromTiptap(
  marks: JSONContent["marks"],
): ContentMarkType[] | undefined {
  const mapped = (marks ?? []).flatMap((m) => {
    const grammarMark = TIPTAP_MARK_TO_GRAMMAR[m.type ?? ""];
    return grammarMark ? [grammarMark] : [];
  });
  return mapped.length ? mapped : undefined;
}

function inlinesFromTiptap(nodes: JSONContent[] | undefined): ContentInline[] {
  return (nodes ?? []).flatMap((node): ContentInline[] => {
    switch (node.type) {
      case "text":
        return [
          {
            type: "text",
            text: node.text ?? "",
            ...(marksFromTiptap(node.marks)
              ? { marks: marksFromTiptap(node.marks) }
              : {}),
          },
        ];
      case "hardBreak":
        return [{ type: "hardBreak" }];
      case "inlineMath":
        return [
          {
            type: "inlineMath",
            latex:
              typeof node.attrs?.latex === "string" ? node.attrs.latex : "",
          },
        ];
      default:
        // Allow-listed extensions cannot produce anything else here; a hit
        // means an extension regression — fail loudly instead of losing data.
        throw new Error(`unmappable inline node: ${node.type ?? "missing"}`);
    }
  });
}

function blocksFromTiptap(nodes: JSONContent[] | undefined): ContentBlock[] {
  return (nodes ?? []).flatMap((node): ContentBlock[] => {
    switch (node.type) {
      case "paragraph":
        return [
          { type: "paragraph", content: inlinesFromTiptap(node.content) },
        ];
      case "bulletList":
      case "orderedList":
        return [
          {
            type: node.type,
            content: listItemsFromTiptap(node.content),
          },
        ];
      case "codeBlock":
        return [
          {
            type: "codeBlock",
            language: sanitizeLanguage(node.attrs?.language),
            text: (node.content ?? []).map((n) => n.text ?? "").join(""),
          },
        ];
      case "blockMath":
        return [
          {
            type: "blockMath",
            latex:
              typeof node.attrs?.latex === "string" ? node.attrs.latex : "",
          },
        ];
      case "table":
        return [
          {
            type: "table",
            content: (node.content ?? []).map((row) => ({
              type: "tableRow",
              // tableHeader downgrades to tableCell (grammar has no header).
              // Cells hold paragraphs only; richer pasted blocks degrade to
              // their plain-text projection.
              content: (row.content ?? []).map((cell) => ({
                type: "tableCell",
                content: (cell.content ?? []).flatMap(
                  (child): ContentParagraph[] => {
                    if (child.type === "paragraph") {
                      return [
                        {
                          type: "paragraph",
                          content: inlinesFromTiptap(child.content),
                        },
                      ];
                    }
                    try {
                      const projected = plainTextProjection({
                        docVersion: CONTENT_DOC_VERSION,
                        type: "doc",
                        content: blocksFromTiptap([child]),
                      });
                      return [
                        {
                          type: "paragraph",
                          content: [
                            { type: "text", text: projected.trimEnd() },
                          ],
                        },
                      ];
                    } catch {
                      return [];
                    }
                  },
                ),
              })),
            })),
          },
        ];
      default:
        throw new Error(`unmappable block node: ${node.type ?? "missing"}`);
    }
  });
}

/**
 * List items only accept paragraph / nested lists in the grammar. Tiptap's
 * schema would allow richer blocks there (paste of a table into a list item),
 * so those downgrade: codeBlock → text paragraph, blockMath → inline math in
 * a paragraph, table → plain-text projection paragraph.
 */
function listItemsFromTiptap(
  nodes: JSONContent[] | undefined,
): ContentListItem[] {
  return (nodes ?? []).map((item) => ({
    type: "listItem",
    content: (item.content ?? []).flatMap(
      (child): ContentListItem["content"] => {
        switch (child.type) {
          case "paragraph":
            return [
              { type: "paragraph", content: inlinesFromTiptap(child.content) },
            ];
          case "bulletList":
          case "orderedList":
            return [
              { type: child.type, content: listItemsFromTiptap(child.content) },
            ];
          case "codeBlock":
            return [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: (child.content ?? [])
                      .map((n) => n.text ?? "")
                      .join(""),
                  },
                ],
              },
            ];
          case "blockMath":
            return [
              {
                type: "paragraph",
                content: [
                  {
                    type: "inlineMath",
                    latex:
                      typeof child.attrs?.latex === "string"
                        ? child.attrs.latex
                        : "",
                  },
                ],
              },
            ];
          default: {
            const projected = plainTextProjection({
              docVersion: CONTENT_DOC_VERSION,
              type: "doc",
              content: blocksFromTiptap([child]),
            });
            return [
              {
                type: "paragraph",
                content: [{ type: "text", text: projected.trimEnd() }],
              },
            ];
          }
        }
      },
    ),
  }));
}

/**
 * Converts Tiptap editor JSON into a canonical ContentDocumentV1. Throws on
 * nodes outside the grammar (unreachable under the editor allow-list — the
 * throw is the fail-safe against extension regressions). Normalization is
 * applied so emitted documents are already canonical.
 */
export function tiptapToContentDocument(json: JSONContent): ContentDocumentV1 {
  return normalizeContentDocument({
    docVersion: CONTENT_DOC_VERSION,
    type: "doc",
    content: blocksFromTiptap(json.content),
  });
}
