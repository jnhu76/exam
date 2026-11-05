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
 * The detectors are LINEAR in the input length. Metadata values are bounded
 * per event (32 KiB) but a 32 KiB adversarial string is enough for a
 * backtracking pattern to block the event loop for seconds on an
 * authenticated ingestion route (#875 review), so the JWT/userinfo shapes are
 * scanned by hand and the anchored Bearer/Basic form is a single class run.
 *
 * - JWT compact form (three base64url segments with plausible header/payload/
 *   signature lengths), matched as a standalone token even when embedded in
 *   surrounding prose;
 * - a whole-value credential scheme (`Bearer <token>` / `Basic <token>`) —
 *   anchored, so prose merely mentioning the word is untouched;
 * - any URL carrying userinfo credentials (`scheme://user:pass@host`), e.g. a
 *   pasted DSN, matched anywhere in the string.
 */
const BEARER_BASIC_WHOLE_VALUE = /^(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}$/i;

/** Anchored JWT test applied to one [A-Za-z0-9_-.] token. */
const COMPACT_JWT_TOKEN =
  /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{10,}$/;

/** True for UTF-16 units allowed in a base64url segment or the dot separator. */
function isJwtTokenUnit(unit: number): boolean {
  return (
    (unit >= 48 && unit <= 57) || // 0-9
    (unit >= 65 && unit <= 90) || // A-Z
    (unit >= 97 && unit <= 122) || // a-z
    unit === 45 || // -
    unit === 95 || // _
    unit === 46 // .
  );
}

/**
 * Linear compact-JWT scan: split the string into maximal [base64url + .]
 * tokens and test each token once with the anchored pattern. Every character
 * is visited a constant number of times; the previous unanchored pattern
 * backtracked quadratically on long runs containing "eyJ".
 */
function containsCompactJwt(value: string): boolean {
  let start = -1;
  for (let i = 0; i <= value.length; i++) {
    const inToken = i < value.length && isJwtTokenUnit(value.charCodeAt(i));
    if (inToken) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (COMPACT_JWT_TOKEN.test(value.slice(start, i))) return true;
      start = -1;
    }
  }
  return false;
}

/** Scheme characters (first character is checked separately as a letter). */
function isSchemeUnit(unit: number): boolean {
  return (
    (unit >= 48 && unit <= 57) ||
    (unit >= 65 && unit <= 90) ||
    (unit >= 97 && unit <= 122) ||
    unit === 43 || // +
    unit === 45 || // -
    unit === 46 // .
  );
}

/**
 * Authority terminators: the scan stops here, so `@` in a query string
 * (`https://host:3000?contact=bob@example.com`) is NOT mistaken for
 * userinfo. A linear `indexOf("://")` walk plus a bounded forward scan.
 */
function isAuthorityTerminator(unit: number): boolean {
  // whitespace, / ? # and common surrounding punctuation
  return (
    unit === 32 ||
    unit === 9 ||
    unit === 10 ||
    unit === 13 ||
    unit === 47 || // /
    unit === 63 || // ?
    unit === 35 || // #
    unit === 34 || // "
    unit === 39 || // '
    unit === 60 || // <
    unit === 62 || // >
    unit === 44 || // ,
    unit === 59 || // ;
    unit === 41 || // )
    unit === 93 || // ]
    unit === 125 // }
  );
}

/** Linear `scheme://user:pass@host` detector (userinfo requires `:`). */
function containsUserinfoUrl(value: string): boolean {
  let searchFrom = 0;
  for (;;) {
    const sep = value.indexOf("://", searchFrom);
    if (sep === -1) return false;
    searchFrom = sep + 3;

    let schemeStart = sep;
    while (schemeStart > 0 && isSchemeUnit(value.charCodeAt(schemeStart - 1))) {
      schemeStart--;
    }
    const first = value.charCodeAt(schemeStart);
    const isLetter =
      (first >= 65 && first <= 90) || (first >= 97 && first <= 122);
    if (schemeStart === sep || !isLetter) continue;

    let colon = -1;
    for (let i = sep + 3; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit === 64 /* @ */) {
        if (colon > sep + 2) return true;
        break;
      }
      if (isAuthorityTerminator(unit)) break;
      if (unit === 58 /* : */ && colon < 0) colon = i;
    }
  }
}

/**
 * Returns the redaction-safe form of a string value: `REDACTED` when it
 * carries a credential shape, otherwise the value verbatim. Exported for the
 * API ingestion route, which applies the same rule to the top-level
 * `clientSessionId` free string and metadata keys (single authority, no
 * second implementation).
 */
export function redactCredentialShapedValue(value: string): string {
  return containsCompactJwt(value) ||
    BEARER_BASIC_WHOLE_VALUE.test(value) ||
    containsUserinfoUrl(value)
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
 * denylist, dropping any entry whose KEY is credential-shaped, plus redacting
 * any credential-shaped string value under a surviving key (#875). Arrays and
 * primitives are preserved verbatim otherwise;
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
    // A credential-shaped KEY is itself the secret. Copying it through would
    // persist the exact bytes the value scan exists to remove (#875 review):
    // drop the entry rather than invent a renamed key.
    if (redactCredentialShapedValue(key) === REDACTED) continue;
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
