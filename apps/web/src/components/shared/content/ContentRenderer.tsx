import { memo } from "react";
import type { ContentDocumentV1 } from "@exam/domain";
import { ContentDocumentRenderer } from "./ContentDocumentRenderer";

/**
 * The unified READ entry for question content (issue 301 §28/§33).
 *
 * Plain (document null/undefined) renders the prompt as a single text node —
 * the same thin path the app has always had (TakeExamPage), zero editor or
 * math cost. Rich renders the static ContentDocumentRenderer (pure React
 * nodes, lazy math). READ never mounts an editor.
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
  if (document == null) {
    return <div className={className}>{content}</div>;
  }
  return <ContentDocumentRenderer document={document} className={className} />;
}

/** Plain/Rich content read renderer. Memoized on identity. */
export const ContentRenderer = memo(ContentRendererImpl);
