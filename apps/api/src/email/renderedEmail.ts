// Shared rendered-Email content contract (#300 convergence).
//
// Every production Email renderer (notifications/gradeNotificationEmail.ts,
// identity/identityEmails.ts) returns this shape and escapes interpolated
// values through `escapeEmailHtml`. Renderers stay separate pure functions —
// this module only owns the ONE content shape and the ONE HTML escaping rule.

/** Rendered Email content handed to the outbox. */
export interface RenderedEmailContent {
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

/**
 * HTML-escapes a string for safe interpolation into `bodyHtml`. Escapes the
 * five XML/HTML-significant characters. Does NOT attempt to sanitize full
 * HTML documents (renderer bodies are fixed templates with interpolated
 * trusted/escaped values only).
 */
export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
