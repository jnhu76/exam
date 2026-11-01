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
import { ContentScrollViewport } from "./ContentScrollViewport";

/**
 * Static rich-content renderer (#301 §28).
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
      return (
        <ContentScrollViewport
          kind="inline"
          labelKey="content.scrollRegion.inlineFormula"
          nowrap
        >
          <MathRenderer latex={inline.latex} displayMode={false} />
        </ContentScrollViewport>
      );
    default:
      // Unknown inline node (corrupt data only — the write boundary rejects
      // it): render nothing. The block-level fail-safe covers unknown BLOCK
      // types; raw HTML is never a fallback.
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
        <ContentScrollViewport
          kind="block"
          labelKey="content.scrollRegion.formula"
          nowrap
        >
          <MathRenderer latex={block.latex} displayMode={true} />
        </ContentScrollViewport>
      );
    case "codeBlock":
      return (
        <ContentScrollViewport kind="code" labelKey="content.scrollRegion.code">
          {/* The scroll region is the bare <pre> (the measurement owner's
              "no border/padding" contract); the code surface and padding live
              on the inner block so they expand with the scrolled line. */}
          <code className="block w-max min-w-full rounded-md surface-subtle p-3">
            {block.text}
          </code>
        </ContentScrollViewport>
      );
    case "table":
      return (
        <ContentScrollViewport
          kind="block"
          labelKey="content.scrollRegion.table"
        >
          <table className="w-full border-collapse">
            <tbody>
              {block.content.map((row, index) => (
                <RowRenderer key={index} row={row} />
              ))}
            </tbody>
          </table>
        </ContentScrollViewport>
      );
    default:
      // Controlled fail-safe for invalid persisted data (#301 §28): never a
      // raw-HTML fallback.
      return <p className="type-body">{t("content.unsupportedBlock")}</p>;
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
