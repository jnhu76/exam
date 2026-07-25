import { z } from "zod";

/**
 * Optional recipient email field for user accounts (P5-N1 §13).
 *
 * The email is a NOT-FOR-LOGIN recipient source for operational notifications
 * (the first V1 use case is the `result_published` Inbox + Email outbox). It
 * is:
 *   - optional on every write surface;
 *   - normalized: trim, then lowercase (the repository's chosen rule);
 *   - blank / whitespace-only / empty -> absent (the route stores `null`);
 *   - validated by `z.string().email()` after normalization;
 *   - capped at 320 characters (RFC 5321 practical ceiling);
 *   - NOT unique (multiple nulls / duplicates allowed);
 *   - NOT verified (no ownership / confirmation flow in V1).
 *
 * The contract emits `undefined` for blank input so route handlers can map
 * "absent" to the `users.email = null` column uniformly, and so a PATCH that
 * omits the field is an explicit no-op rather than an accidental clear.
 */

/** Maximum length of a normalized email address (RFC 5321 practical ceiling). */
export const EMAIL_MAX_LENGTH = 320;

/**
 * Normalizes a raw email input: trims surrounding whitespace, collapses an
 * empty/whitespace-only string to `undefined` (so callers store `null`), and
 * lowercases the result. Returns `undefined` for `undefined`/`null` input.
 */
export function normalizeEmailInput(
  value: string | undefined | null,
): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return trimmed.toLowerCase();
}

/**
 * Zod schema for an optional write-side email field.
 *
 * Accepts a string (or undefined). Blank/whitespace-only normalizes to
 * `undefined`. Otherwise the trimmed+lowercased value must pass
 * `z.string().email()` and be no longer than {@link EMAIL_MAX_LENGTH}.
 *
 * Use this on create/update request schemas where the email is optional.
 */
export function optionalEmailField() {
  return z
    .string()
    .max(EMAIL_MAX_LENGTH)
    .optional()
    .transform((v) => normalizeEmailInput(v ?? undefined))
    .pipe(z.string().email().max(EMAIL_MAX_LENGTH).optional());
}

/**
 * Zod schema for the nullable read-side email field (admin read DTOs).
 *
 * The stored column is nullable; the DTO surfaces `string | null`.
 */
export function nullableEmailField() {
  return z.string().email().max(EMAIL_MAX_LENGTH).nullable();
}
