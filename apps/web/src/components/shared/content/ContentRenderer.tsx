import { memo } from "react";
import { useTranslation } from "react-i18next";
import { resolvePersistedQuestionDocument } from "@exam/contracts";
import type { ContentDocumentV1 } from "@exam/domain";
import { cn } from "@/lib/utils";
import { ContentDocumentRenderer } from "./ContentDocumentRenderer";

/**
 * The unified READ entry for question content (#301 §28/§33).
 *
 * Plain (document null/undefined) renders the prompt as a single text node —
 * the same thin path the app has always had (TakeExamPage), zero editor or
 * math cost. Rich renders the static ContentDocumentRenderer (pure React
 * nodes, lazy math). READ never mounts an editor.
 *
 * INVARIANT (trust boundary, #669): a TypeScript
 * ContentDocumentV1 annotation is not persisted trust. Every non-null
 * document is classified by the shared static read authority
 * (resolvePersistedQuestionDocument) BEFORE rendering; only rich_valid /
 * rich_noncanonical reach ContentDocumentRenderer. rich_noncanonical grants
 * read-only DISPLAY, never canonicality or repair. unsupported_version /
 * corrupt fail closed to the controlled integrity notice — never a
 * render-time TypeError, never a silent fall back to the plain `content`
 * projection (on a Rich question `content` is a server-derived
 * search/display text, not an authority).
 */
function ContentRendererImpl({
  content,
  document,
  className,
}: {
  content: string;
  document?: ContentDocumentV1 | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  // INVARIANT (#699): the READ entry contains long unbreakable tokens
  // (serial numbers, identifiers, URLs). `break-words` gives the token a wrap
  // opportunity; `min-w-0` releases the automatic minimum size when this box
  // is a flex item (option rows) — with `min-width: auto` alone the token
  // would still widen its row. Both are required, and every read path below
  // shares them so no consumer can reintroduce page-level overflow.
  const readClassName = cn("min-w-0 break-words", className);
  if (document == null) {
    return <div className={readClassName}>{content}</div>;
  }
  const trusted = resolvePersistedQuestionDocument(document);
  if (trusted) {
    return (
      <ContentDocumentRenderer document={trusted} className={readClassName} />
    );
  }
  return (
    <div
      className={readClassName}
      data-testid="content-integrity-notice"
      role="note"
    >
      {t("content.unsafeDocument")}
    </div>
  );
}

/** Plain/Rich content read renderer. Memoized on identity. */
export const ContentRenderer = memo(ContentRendererImpl);
