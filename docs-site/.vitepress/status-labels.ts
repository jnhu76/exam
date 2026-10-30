import type MarkdownIt from "markdown-it";

/**
 * Presentation-only badge rendering for the status tokens already present in
 * the canonical projection. This plugin never decides support status; it only
 * styles a table cell whose entire text is one of the documented labels.
 */
const STATUS_RE =
  /^(CURRENT|SUPPORTED|PARTIAL|DEFERRED|NOT_SUPPORTED|NOT_VERIFIED)(\s*[（(][^）)]*[）)])?$/;

function classFor(status: string): string {
  if (status === "NOT_SUPPORTED") return "not-supported";
  if (status === "NOT_VERIFIED") return "not-verified";
  if (status === "SUPPORTED" || status === "CURRENT") return "supported";
  return status.toLowerCase();
}

export function statusLabelsPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "exam-status-labels", (state) => {
    let inCell = false;
    for (const token of state.tokens) {
      if (token.type === "th_open" || token.type === "td_open") {
        inCell = true;
      } else if (token.type === "th_close" || token.type === "td_close") {
        inCell = false;
      } else if (inCell && token.type === "inline" && token.children) {
        for (const child of token.children) {
          if (child.type !== "text") continue;
          const text = child.content.trim();
          const match = STATUS_RE.exec(text);
          if (!match) continue;
          child.type = "html_inline";
          child.content = `<span class="exam-status exam-status--${classFor(
            match[1],
          )}">${text}</span>`;
        }
      }
    }
  });
}
