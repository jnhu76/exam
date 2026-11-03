/**
 * Finite error-category whitelist for failure telemetry (#800/#858 review).
 * INVARIANT: the returned string is always one of a bounded set — never a
 * content-derived string. `Error.name` is a mutable arbitrary property: a
 * forged name can carry secrets into persisted metadata, and unique names
 * would multiply the per-category rate-limiter keys. Unknown or hostile
 * names collapse to the single stable `OtherError`.
 */
const KNOWN_ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "DOMException",
  "AbortError",
  "TimeoutError",
]);

/** Stable fallback for any name outside {@link KNOWN_ERROR_NAMES}. */
const OTHER_ERROR = "OtherError";

/**
 * Maps an unknown thrown value to a bounded stable category: a whitelisted
 * standard error class name, `OtherError`, or — for non-Error values — the
 * existing bounded `non-error:<typeof>` tag (`typeof` yields a small closed
 * set).
 *
 * `err.name` is read defensively: a hostile getter that throws, or a name
 * coerced to a non-string, degrades to `OtherError` instead of crashing the
 * telemetry path or forwarding the raw value.
 */
export function toErrorCategory(err: unknown): string {
  if (!(err instanceof Error)) return `non-error:${typeof err}`;
  let name: unknown;
  try {
    name = err.name;
  } catch {
    return OTHER_ERROR;
  }
  return typeof name === "string" && KNOWN_ERROR_NAMES.has(name)
    ? name
    : OTHER_ERROR;
}
