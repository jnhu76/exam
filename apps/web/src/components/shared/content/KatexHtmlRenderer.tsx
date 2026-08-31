import { katexRenderToHtml } from "./katexRender";
import { CONTENT_LIMITS } from "@exam/domain";

/**
 * THE single controlled HTML seam for math rendering (issue 301 §9/§30).
 *
 * Input is ONLY the validated `latex` field of a math node (string). KaTeX
 * runs with `trust: false` and `throwOnError: false`, so \href/\htmlData and
 * friends are disabled and invalid LaTeX renders as inert source instead of
 * throwing. The generated HTML string is scoped to the KaTeX span — no
 * arbitrary user HTML can flow through this seam, and no other component in
 * the codebase may call `dangerouslySetInnerHTML` for rich content.
 *
 * If the latex exceeds the kernel's document-level LaTeX bound
 * (CONTENT_LIMITS.latex), it is treated as hostile input and rendered as
 * escaped text (defence in depth; the write boundary already rejects such
 * documents).
 */

/** Props for the lazy math renderer. */
export type MathRendererProps = {
  latex: string;
  displayMode: boolean;
};

export default function KatexHtmlRenderer({
  latex,
  displayMode,
}: MathRendererProps) {
  if (latex.length > CONTENT_LIMITS.latex) {
    return <code>{latex}</code>;
  }
  let html: string;
  try {
    html = katexRenderToHtml(latex, displayMode);
  } catch {
    // Fail safe: invalid LaTeX renders as inert source, never crashes the
    // surrounding renderer.
    html = "";
  }
  if (!html) {
    return <code>{latex}</code>;
  }
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
