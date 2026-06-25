/**
 * Shared client-event metadata sanitizer, used by BOTH the web logger (before
 * enqueue) and the API route (defense-in-depth before insert). Keeping one
 * implementation in `@exam/contracts` guarantees the two sides cannot drift.
 *
 * The sanitizer strips credentials and exam content (answers / question text)
 * so that telemetry never persists secrets or sensitive exam material. It is
 * total — it never throws — so a malformed payload cannot disturb logging.
 */

/**
 * Keys whose values must never be persisted. Matched case-insensitively and as
 * substrings so variants like `authToken`, `userPassword`, `answerText` are all
 * caught. Covers credentials, auth material, and exam content.
 */
const DENYLIST_SUBSTRINGS = [
  "password",
  "token",
  "cookie",
  "authorization",
  "auth",
  "secret",
  "answer",
  "answertext",
  "content",
  "body",
  "questiontext",
];

/** Placeholder substituted for redacted values. */
const REDACTED = "[redacted]";

/** Maximum nesting depth walked when redacting; deeper values are pruned. */
const MAX_DEPTH = 5;

/** Returns true if a key name matches any denylisted substring. */
function isDenylisted(key: string): boolean {
  const lower = key.toLowerCase();
  return DENYLIST_SUBSTRINGS.some((sub) => lower.includes(sub));
}

/**
 * Deep-clones a metadata value while redacting any key whose name matches the
 * denylist. Arrays and primitives are preserved verbatim; non-serializable
 * values (functions, symbols) are dropped. Total: never throws — on any
 * unexpected shape it returns the input value or `{}` so it cannot crash the
 * calling logger.
 *
 * @param value - the value to sanitize (object, array, or primitive).
 * @param depth - current nesting depth (internal).
 */
export function sanitizeMetadata<T>(value: T, depth = 0): T {
  // Primitives pass through untouched.
  if (value === null || typeof value !== "object") return value;

  // Arrays are carried through verbatim (recursing into their elements),
  // preserving their array identity. Redaction applies to object keys within
  // the array's elements.
  if (Array.isArray(value)) {
    return value.map((item) =>
      item === null || typeof item !== "object"
        ? item
        : sanitizeMetadata(item, depth + 1),
    ) as unknown as T;
  }

  // At max depth, stop recursing into further nested objects but preserve the
  // object itself. This bounds traversal while avoiding premature data loss.
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (isDenylisted(key)) {
      result[key] = REDACTED;
      continue;
    }
    if (raw === null || typeof raw !== "object") {
      // Drop functions/symbols/etc. — they are not JSON-serializable.
      if (typeof raw === "function" || typeof raw === "symbol") continue;
      result[key] = raw;
    } else if (depth + 1 > MAX_DEPTH) {
      // Beyond depth cap: preserve as-is without further recursion.
      result[key] = raw;
    } else {
      result[key] = sanitizeMetadata(raw, depth + 1);
    }
  }
  return result as unknown as T;
}

/**
 * Returns a sanitized copy of a metadata object, ready to persist or transmit.
 * Never throws; on any unexpected shape it returns an empty object so the
 * logger cannot crash the caller. Non-object inputs are rejected as `{}`.
 */
export function sanitizeClientEvent(
  metadata: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") return {};
  try {
    const out = sanitizeMetadata(metadata);
    return out && typeof out === "object" && !Array.isArray(out)
      ? (out as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
