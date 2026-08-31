import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { CONTENT_LIMITS } from "@exam/domain";

/**
 * Lazy chunk boundary for KaTeX. The heavy renderer (katex + CSS) is only
 * downloaded when a page actually renders a math node (issue 301 §34); documents
 * without math never pay the cost. While the chunk loads, the LaTeX source
 * itself is displayed — content is never missing, only unformatted.
 */
const KatexHtmlRenderer = lazy(() => import("./KatexHtmlRenderer"));

/** Props for the math renderer seam. */
export type MathRendererProps = {
  latex: string;
  displayMode: boolean;
};

export function MathRenderer({ latex, displayMode }: MathRendererProps) {
  const { t } = useTranslation();
  if (latex.length > CONTENT_LIMITS.latex) {
    // Defence in depth — the write boundary already bounds latex; treat
    // oversized values as hostile and render them as escaped text.
    return <code>{latex}</code>;
  }
  return (
    <Suspense
      fallback={<code aria-label={t("content.mathLoading")}>{latex}</code>}
    >
      <KatexHtmlRenderer latex={latex} displayMode={displayMode} />
    </Suspense>
  );
}
