import katex from "katex";
// KaTeX's stylesheet is REQUIRED for its HTML output to lay out correctly.
// Imported here (inside the lazy math chunk), not at app root: the plain
// content path must not download any KaTeX cost — CSS included (issue 301).
import "katex/dist/katex.min.css";

/**
 * Renders LaTeX to KaTeX's HTML string. Kept in its own module so `katex`
 * (and its CSS, imported alongside) only loads when a math node is actually
 * rendered (issue 301 §34: no math on the page → no KaTeX cost).
 *
 * `trust: false` is the security boundary: \href, \includegraphics,
 * \htmlClass etc. are disabled, so the output cannot carry links, remote
 * content, or event-handler attributes.
 */
export function katexRenderToHtml(latex: string, displayMode: boolean): string {
  return katex.renderToString(latex, {
    displayMode,
    throwOnError: false,
    trust: false,
    strict: "ignore",
    output: "html",
    maxSize: 50,
    maxExpand: 1000,
  });
}
