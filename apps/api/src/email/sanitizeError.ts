/**
 * Sanitize an email-send error into a single safe string for `lastError`
 * persistence and logs (M3 — Email Outbox).
 *
 * Keeps ONLY the diagnostic allowlist:
 *   - error name
 *   - error message
 *   - SMTP `code`      (e.g. "EAUTH", "ECONNECTION")
 *   - SMTP `command`   (e.g. "AUTH PLAIN", "MAIL FROM")
 *   - SMTP `response` / `responseCode`
 *
 * Explicitly does NOT include arbitrary own-properties (auth tokens, passwords,
 * transporter config, `.env` values). In addition, every literal string in
 * `secretsToScrub` is redacted wherever it appears — the SMTP sender passes its
 * known password here so a provider that echoes credentials inside its
 * message/response text cannot leak them via `lastError`.
 *
 * @param error          - The thrown value (Error or otherwise).
 * @param secretsToScrub - Literal substrings to redact (e.g. the SMTP password).
 * @returns A single-line sanitized error string.
 */
export function sanitizeEmailError(
  error: unknown,
  secretsToScrub: ReadonlyArray<string> = [],
): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    if (error.name && error.name !== "Error") parts.push(error.name);
    if (error.message) parts.push(error.message);
  } else if (typeof error === "string") {
    parts.push(error);
  } else {
    parts.push(String(error));
  }

  // nodemailer-shaped SMTP diagnostic fields (kept — they are non-secret).
  if (error !== null && typeof error === "object") {
    const rec = error as Record<string, unknown>;
    const code = rec.code;
    if (typeof code === "string" && code.length > 0) parts.push(`code=${code}`);
    const command = rec.command;
    if (typeof command === "string" && command.length > 0) {
      parts.push(`command=${command}`);
    }
    const responseCode = rec.responseCode;
    if (
      (typeof responseCode === "number" || typeof responseCode === "string") &&
      String(responseCode).length > 0
    ) {
      parts.push(`responseCode=${String(responseCode)}`);
    }
    // `response` (SMTP server text) is kept but scrubbed below.
    const response = rec.response;
    if (typeof response === "string" && response.length > 0) {
      parts.push(`response=${response}`);
    }
  }

  const joined = parts.filter((p) => p.length > 0).join(" | ");
  return scrubSecrets(joined, secretsToScrub);
}

/**
 * Defensive scrub of credential-like substrings from an assembled diagnostic
 * string. Two layers:
 *  (1) literal redaction of every caller-supplied secret (exact-match, global),
 *      so the known SMTP password is removed even when embedded in free text;
 *  (2) pattern-based redaction of common `password=...` / `bearer=...` shapes.
 */
function scrubSecrets(
  text: string,
  secretsToScrub: ReadonlyArray<string>,
): string {
  let out = text;
  for (const secret of secretsToScrub) {
    if (secret && secret.length > 0) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out
    .replace(/pass(word)?=\S+/gi, "$1=[redacted]")
    .replace(/\bpass(word)?\b\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/(authorization|auth-token|bearer)\s*=\S+/gi, "$1=[redacted]");
}
