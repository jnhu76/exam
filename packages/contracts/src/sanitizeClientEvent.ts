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
 * caught. Covers credentials, auth material, and exam content, plus exception
 * carriers (`message` / `stack` / `cause` / `url`): raw exception text can
 * embed answers, tokens, or URL query strings, so any key carrying it is
 * redacted wherever such a substring appears.
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
  "message",
  "stack",
  "cause",
  "url",
];

/**
 * Keys matched exactly (case-insensitive) rather than as substrings. The bare
 * `error` / `err` keys carry raw exception values when used intuitively
 * (`{ error: err }`), but substring matching would also deny the
 * `errorCode` / `errorName` stable machine-code channel that failure
 * telemetry contractually relies on — so only the exact key names are denied.
 */
const DENYLIST_EXACT = ["error", "err"];

/** Placeholder substituted for redacted values. */
const REDACTED = "[redacted]";

/** Maximum nesting depth walked when redacting; deeper values are pruned. */
const MAX_DEPTH = 5;

/**
 * High-confidence credential VALUE shapes (#875). The key denylist cannot see
 * a credential stuffed under an innocent key (`{ note: "<jwt>" }`), so string
 * values matching one of these structured shapes are redacted too. Deliberately
 * narrow — a general sensitive-content detector is out of scope (#875
 * non-goal); anything not matching keeps flowing verbatim.
 *
 * - JWT compact form (three base64url segments with plausible header/payload/
 *   signature lengths), matched even when embedded in surrounding prose;
 * - a whole-value credential scheme (`Bearer <token>` / `Basic <token>`) —
 *   anchored, so prose merely mentioning the word is untouched;
 * - any URL carrying userinfo credentials (`scheme://user:pass@host`), e.g. a
 *   pasted DSN, matched anywhere in the string.
 */
const CREDENTIAL_VALUE_SHAPES: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{10,}/,
  /^(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}$/i,
  /[a-z][a-z0-9+.-]*:\/\/[^\s/@]*:[^\s/@]*@/i,
];

/**
 * Returns the redaction-safe form of a string value: `REDACTED` when it
 * carries a credential shape, otherwise the value verbatim. Exported for the
 * API ingestion route, which applies the same rule to the top-level
 * `route` / `clientSessionId` free strings (single authority, no second
 * implementation).
 */
export function redactCredentialShapedValue(value: string): string {
  return CREDENTIAL_VALUE_SHAPES.some((re) => re.test(value))
    ? REDACTED
    : value;
}

/** Returns true if a key name matches any denylisted substring or exact key. */
function isDenylisted(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    DENYLIST_SUBSTRINGS.some((sub) => lower.includes(sub)) ||
    DENYLIST_EXACT.includes(lower)
  );
}

/** Applies value-level credential-shape redaction to a carried primitive. */
function carryPrimitive(value: unknown): unknown {
  return typeof value === "string" ? redactCredentialShapedValue(value) : value;
}

/**
 * Deep-clones a metadata value while redacting any key whose name matches the
 * denylist, plus any credential-shaped string value under a surviving key
 * (#875). Arrays and primitives are preserved verbatim otherwise;
 * non-serializable values (functions, symbols) are dropped. This walk is not
 * itself total — a hostile value (getter, proxy) can still throw; totality is
 * provided by the {@link sanitizeClientEvent} wrapper.
 *
 * @param value - the value to sanitize (object, array, or primitive).
 * @param depth - current nesting depth (internal).
 */
export function sanitizeMetadata<T>(value: T, depth = 0): T {
  // Primitives pass through, with credential-shaped strings redacted.
  if (value === null || typeof value !== "object")
    return carryPrimitive(value) as T;

  // Arrays are carried through verbatim (recursing into their elements),
  // preserving their array identity. Redaction applies to object keys within
  // the array's elements.
  if (Array.isArray(value)) {
    return value.map((item) =>
      item === null || typeof item !== "object"
        ? carryPrimitive(item)
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
      result[key] = carryPrimitive(raw);
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
