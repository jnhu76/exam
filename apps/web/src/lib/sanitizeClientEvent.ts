import type { ClientEvent } from "@exam/contracts";

/**
 * Keys whose values must never leave the browser. Matched case-insensitively
 * and as substrings so variants like `authToken`, `X-Auth`, `userPassword`
 * are all caught. These cover credentials, auth material, and any exam
 * content (answers / question text) that must not be persisted as telemetry.
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

/** Returns true if a key name matches any denylisted substring. */
function isDenylisted(key: string): boolean {
  const lower = key.toLowerCase();
  return DENYLIST_SUBSTRINGS.some((sub) => lower.includes(sub));
}

/** Max nesting depth we walk when redacting; deeper objects are pruned. */
const MAX_DEPTH = 5;

/**
 * Deep-clones a metadata value while redacting any key whose name matches the
 * denylist. Non-serializable values (functions, symbols) are dropped. If the
 * structure is too deep or throws during traversal, a safe empty object is
 * returned — redaction must never throw into the calling logger.
 *
 * Arrays are carried through verbatim (recursing into their elements) rather
 * than wrapped, so common cases like `{ tags: ["a","b"] }` survive intact.
 */
export function sanitizeMetadata(
  value: unknown,
  depth = 0,
): Record<string, unknown> {
  if (depth > MAX_DEPTH) return {};
  if (value === null || typeof value !== "object") return {};
  if (Array.isArray(value)) {
    return {
      __array: value.map((item) =>
        item === null || typeof item !== "object"
          ? item
          : sanitizeMetadata(item, depth + 1),
      ),
    };
  }
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isDenylisted(key)) {
      result[key] = REDACTED;
      continue;
    }
    if (raw === null || typeof raw !== "object") {
      // Drop functions/symbols/etc. — they are not JSON-serializable.
      if (typeof raw === "function" || typeof raw === "symbol") continue;
      result[key] = raw;
    } else {
      result[key] = sanitizeMetadata(raw, depth + 1);
    }
  }
  return result;
}

/**
 * Returns a sanitized copy of a client event's metadata, ready to send to
 * the server. Never throws; on any unexpected shape it returns an empty
 * object so the logger cannot crash the caller.
 */
export function sanitizeClientEvent(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  try {
    return sanitizeMetadata(metadata);
  } catch {
    return {};
  }
}

// Re-exported to keep the ClientEvent type reachable for consumers that
// build events against this module's contract.
export type { ClientEvent };
