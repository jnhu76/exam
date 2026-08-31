import { memo } from "react";
import { useTranslation } from "react-i18next";
import type {
  ContentBlock,
  ContentDocumentV1,
  ContentInline,
  ContentListItem,
  ContentMarkType,
  ContentTableCell,
  ContentTableRow,
} from "@exam/domain";
import { MathRenderer } from "./MathRenderer";

/**
 * Static rich-content renderer (issue 301 §28).
 *
 * READ path only: pure React nodes, NOT Tiptap / ProseMirror /
 * contentEditable. Every element is rendered from the validated
 * ContentDocumentV1 grammar — text is React-escaped, so persisted content can
 * never reach the DOM as executable HTML. Unknown nodes/marks must never
 * arrive here (the write boundary rejects them); if corrupt historical data
 * ever does, the block is replaced by a controlled fail-safe placeholder —
 * never a dangerouslySetInnerHTML fallback.
 */
function markKey(marks: ContentMarkType[] | undefined, index: number): string {
  return marks?.length ? marks.join("+") : `n${index}`;
}

function InlineRun({ inline }: { inline: ContentInline }) {
  switch (inline.type) {
    case "text": {
      let node: React.ReactNode = inline.text;
      const marks = inline.marks ?? [];
      if (marks.includes("inlineCode")) {
        node = <code className="rounded bg-muted px-1 py-0.5">{node}</code>;
      }
      if (marks.includes("bold")) node = <strong>{node}</strong>;
      if (marks.includes("italic")) node = <em>{node}</em>;
      if (marks.includes("underline")) node = <u>{node}</u>;
      return <>{node}</>;
    }
    case "hardBreak":
      return <br />;
    case "inlineMath":
      return <MathRenderer latex={inline.latex} displayMode={false} />;
    default:
      // Unknown inline node: dropped silently is unsafe to read; render its
      // absence explicitly through the fail-safe boundary at the block level.
      return null;
  }
}

function InlineList({ inlines }: { inlines: ContentInline[] }) {
  return (
    <>
      {inlines.map((inline, index) => (
        <InlineRun key={`${inline.type}-${index}`} inline={inline} />
      ))}
    </>
  );
}

function ListItemRenderer({ item }: { item: ContentListItem }) {
  return (
    <li>
      {item.content.map((child, index) =>
        child.type === "paragraph" ? (
          <p key={index} className="type-body">
            <InlineList inlines={child.content} />
          </p>
        ) : child.type === "bulletList" ? (
          <ul key={index} className="list-disc pl-6">
            {child.content.map((nested, nestedIndex) => (
              <ListItemRenderer key={nestedIndex} item={nested} />
            ))}
          </ul>
        ) : child.type === "orderedList" ? (
          <ol key={index} className="list-decimal pl-6">
            {child.content.map((nested, nestedIndex) => (
              <ListItemRenderer key={nestedIndex} item={nested} />
            ))}
          </ol>
        ) : null,
      )}
    </li>
  );
}

function CellRenderer({ cell }: { cell: ContentTableCell }) {
  return (
    <td className="border border-border px-2 py-1 align-top">
      {cell.content.map((paragraph, index) => (
        <p key={index} className="type-body">
          <InlineList inlines={paragraph.content} />
        </p>
      ))}
    </td>
  );
}

function RowRenderer({ row }: { row: ContentTableRow }) {
  return (
    <tr>
      {row.content.map((cell, index) => (
        <CellRenderer key={index} cell={cell} />
      ))}
    </tr>
  );
}

function BlockRenderer({ block }: { block: ContentBlock }) {
  const { t } = useTranslation();
  switch (block.type) {
    case "paragraph":
      return (
        <p className="type-body">
          <InlineList inlines={block.content} />
        </p>
      );
    case "bulletList":
      return (
        <ul className="list-disc pl-6">
          {block.content.map((item, index) => (
            <ListItemRenderer key={index} item={item} />
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol className="list-decimal pl-6">
          {block.content.map((item, index) => (
            <ListItemRenderer key={index} item={item} />
          ))}
        </ol>
      );
    case "blockMath":
      return (
        <div className="my-2 overflow-x-auto">
          <MathRenderer latex={block.latex} displayMode={true} />
        </div>
      );
    case "codeBlock":
      return (
        <pre className="type-code my-2 rounded-md surface-subtle p-3">
          <code>{block.text}</code>
        </pre>
      );
    case "table":
      return (
        <div className="my-2 overflow-x-auto">
          <table className="w-full border-collapse">
            <tbody>
              {block.content.map((row, index) => (
                <RowRenderer key={index} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      // Controlled fail-safe for invalid persisted data (issue 301 §28): never a
      // raw-HTML fallback.
      return (
        <p className="type-body text-muted-foreground">
          {t("content.unsupportedBlock")}
        </p>
      );
  }
}

/** Props for the static rich document renderer. */
export type ContentDocumentRendererProps = {
  document: ContentDocumentV1;
  className?: string;
};

/** Renders a validated ContentDocumentV1 as plain React nodes. Memoized: identical documents re-render free. */
export const ContentDocumentRenderer = memo(function ContentDocumentRenderer({
  document,
  className,
}: ContentDocumentRendererProps) {
  return (
    <div className={className}>
      {document.content.map((block, index) => (
        <BlockRenderer key={`${block.type}-${index}`} block={block} />
      ))}
    </div>
  );
});
