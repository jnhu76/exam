import { isErrorCode } from "@exam/contracts";

/**
 * Pino redaction configuration for sensitive fields.
 *
 * These paths are applied to all Pino log output. The `remove` strategy
 * deletes matched keys from the serialized output entirely (value recovery
 * from the log line is impossible, not merely censored).
 *
 * INVARIANT: these paths only match at their declared locations. They cannot
 * reach values nested inside a serialized `err` entry (e.g.
 * `err.cause.issues[0].message`), which is why the `err` channel needs the
 * whitelist serializer below instead of more paths.
 */
export const SENSITIVE_LOG_PATHS = [
  "password",
  "newPassword",
  "currentPassword",
  "passwordHash",
  "smtpPassword",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "auth-token",
  "req.headers.cookie",
  "req.headers.authorization",
  "standardAnswer",
  "req.body.password",
  "req.body.newPassword",
  "req.body.currentPassword",
  "req.body.smtpPassword",
] as const;

/**
 * Pino redaction configuration object consumed by the logger plugin.
 *
 * Mirrors {@link SENSITIVE_LOG_PATHS} but formatted as the `{ paths, remove }`
 * shape that Pino's redaction API expects.
 */
export const REDACT_CONFIG = {
  paths: SENSITIVE_LOG_PATHS as unknown as string[],
  remove: true,
};

/**
 * Constant replacing every raw error message in the `err` channel (#998).
 *
 * WHY: error messages have no proven trusted source at runtime. A
 * DrizzleQueryError's top-level message embeds the full SQL text and bound
 * parameter values; a wrapped driver/serialization error embeds rejected
 * payload data. Authored-in-repo messages cannot be distinguished from
 * data-derived ones structurally, so the policy withholds them uniformly.
 */
export const REDACTED_ERROR_MESSAGE = "[redacted error message]";

/**
 * Fixed classification labels for known error classes (#998). The key is the
 * constructor name (or `name`) of a class we recognize; the value is the
 * label we emit. Name-based recognition is spoofable, but spoofing only
 * SELECTS one of these fixed labels — no input text ever flows to the log.
 *
 * INVARIANT: kept as a Map — plain-object indexing answers prototype-chain
 * keys ("__proto__", "constructor", "toString") with non-undefined values,
 * which would smuggle a non-string "label" into the output. Map lookups
 * miss cleanly.
 */
const RESPONSE_SERIALIZATION_LABEL = "response_serialization_error";
const ERROR_CLASS_LABELS: ReadonlyMap<string, string> = new Map<string, string>(
  [
    ["DrizzleQueryError", "drizzle_query_error"],
    ["DrizzleError", "drizzle_error"],
    ["ResponseSerializationError", RESPONSE_SERIALIZATION_LABEL],
    ["ZodError", "zod_error"],
  ],
);

/** Label for every Error not matched by {@link ERROR_CLASS_LABELS}. */
const GENERIC_ERROR_LABEL = "error";

/**
 * SQLSTATE codes preserved as safe diagnostic `code` values. Exact-match set,
 * not format validation: 23505/40001 are the constraint codes the error
 * handler already recognizes (plugins/errors.ts, message contract D0.6/C1-A);
 * 23503/42P01 are common operational PG failures. Unlisted codes are omitted.
 */
const RECOGNIZED_SQLSTATE_CODES: ReadonlySet<string> = new Set([
  "23505",
  "40001",
  "23503",
  "42P01",
]);

/**
 * Framework error codes authored by our dependencies that are safe to echo
 * for diagnosis. Exact-match set; also used as a classification key.
 */
const RECOGNIZED_FRAMEWORK_CODES: ReadonlySet<string> = new Set([
  "FST_ERR_RESPONSE_SERIALIZATION",
]);

/** Depth cap guards against circular `cause` chains (Error options allow them). */
const MAX_CAUSE_DEPTH = 5;

/** Marker emitted where a cause chain is cut by the depth cap. */
const CAUSE_TRUNCATION_MARKER = "[cause chain truncated]";

/**
 * Shape of the serialized `err` entry. The identity fields are always
 * present so the function satisfies Fastify's `serializers.err` contract;
 * classification fields ride the index signature.
 */
export interface SerializedErrorForLog {
  type: string;
  name: string;
  message: string;
  stack: string;
  [key: string]: unknown;
}

/**
 * Reduces any non-Error value to a fixed type marker without copying its
 * contents. Labels derive ONLY from `typeof` / `null` / array checks: the
 * input's `constructor.name` is spoofable input that can carry arbitrary
 * text, or an object with a custom `toJSON` that JSON serialization would
 * then invoke (#998 review round 2) — it is never read.
 */
function typeMarker(value: unknown): SerializedErrorForLog {
  let typeName: string;
  if (value === null) {
    typeName = "null";
  } else if (Array.isArray(value)) {
    typeName = "array";
  } else {
    typeName = typeof value;
  }
  return { type: typeName, name: typeName, message: "", stack: "" };
}

/**
 * Fixed classification label for a logged Error (#998).
 *
 * Recognition order: constructor name, then the framework `code` key, then
 * `name`. Every lookup key only selects from {@link ERROR_CLASS_LABELS};
 * recognizing a known class never grants access to its message or stack.
 */
function classifyError(source: Error & Record<string, unknown>): string {
  const constructorName = source.constructor?.name;
  if (typeof constructorName === "string") {
    const byConstructor = ERROR_CLASS_LABELS.get(constructorName);
    if (byConstructor !== undefined) return byConstructor;
  }
  const code = source.code;
  if (typeof code === "string" && RECOGNIZED_FRAMEWORK_CODES.has(code)) {
    return RESPONSE_SERIALIZATION_LABEL;
  }
  if (typeof source.name === "string") {
    const byName = ERROR_CLASS_LABELS.get(source.name);
    if (byName !== undefined) return byName;
  }
  return GENERIC_ERROR_LABEL;
}

/**
 * Safe `code` projection (#998): the value is echoed only when it is an
 * exact member of a closed authoritative set — the `ErrorCode` domain
 * registry (`@exam/contracts`, same authority as the error envelope), the
 * recognized SQLSTATEs, or the recognized framework codes. Anything else
 * (arbitrary strings, objects, data-derived values) is omitted.
 */
function safeCodeOf(
  source: Error & Record<string, unknown>,
): string | undefined {
  const code = source.code;
  if (typeof code !== "string") return undefined;
  if (isErrorCode(code)) return code;
  if (RECOGNIZED_SQLSTATE_CODES.has(code)) return code;
  if (RECOGNIZED_FRAMEWORK_CODES.has(code)) return code;
  return undefined;
}

/**
 * Safe `statusCode` projection (#998): a plausibly-ranged integer HTTP
 * status. Other shapes (strings, NaN, out-of-range numbers) are omitted —
 * the value is untrusted input that must not ride into the log verbatim.
 */
function safeStatusCodeOf(
  source: Error & Record<string, unknown>,
): number | undefined {
  const statusCode = source.statusCode;
  if (
    typeof statusCode !== "number" ||
    !Number.isInteger(statusCode) ||
    statusCode < 400 ||
    statusCode > 599
  ) {
    return undefined;
  }
  return statusCode;
}

/**
 * Whitelist serializer for the pino `err` channel.
 *
 * WHY: pino's default error serializer copies every own enumerable property,
 * so one `log.error({ err })` of a wrapped error dumps its payload into the
 * log — e.g. a DrizzleQueryError whose top-level message is
 * `Failed query: <sql>\nparams: <bindings>`, a ResponseSerializationError
 * whose ZodError `cause` embeds the rejected response values (standard
 * answers) in its issue messages, or a driver error carrying row data. Path
 * redaction cannot reach inside the serialized error, and no runtime marker
 * distinguishes "authored" from "data-derived" message text, so text is not
 * the trust boundary at all (#998).
 *
 * Field policy (top level and every cause level alike):
 * - `type`/`name`: fixed classification label (see {@link classifyError});
 *   never an echo of the input's constructor/name.
 * - `message`: the constant {@link REDACTED_ERROR_MESSAGE}.
 * - `stack`: always `""` (the Fastify/pino `err` serializer contract expects
 *   the field; stack headers embed the message and frames embed SQL text).
 * - `code`: only exact members of the closed safe sets ({@link safeCodeOf}).
 * - `statusCode`: only a plausible integer HTTP status
 *   ({@link safeStatusCodeOf}).
 * - `cause`: same policy recursively, depth-capped and circular-safe.
 * - Non-Error values reduce to a type marker; their contents are never
 *   copied.
 * - Everything else (`details`, `issues`, `validation`, `query`, `params`,
 *   driver `detail`, `url`, ...) is structurally absent from the log line,
 *   not merely censored, and the input's own `toJSON`/`toString` are never
 *   invoked.
 */
export function serializeErrorForLog(error: unknown): SerializedErrorForLog {
  if (
    typeof error !== "object" ||
    error === null ||
    !(error instanceof Error)
  ) {
    return typeMarker(error);
  }
  const source = error as Error & Record<string, unknown>;
  const label = classifyError(source);

  const out: Record<string, unknown> = {
    type: label,
    name: label,
    message: REDACTED_ERROR_MESSAGE,
    stack: "",
  };
  const code = safeCodeOf(source);
  if (code !== undefined) out.code = code;
  const statusCode = safeStatusCodeOf(source);
  if (statusCode !== undefined) out.statusCode = statusCode;
  if (source.cause !== undefined) {
    out.cause = serializeCause(source.cause, 0);
  }
  return out as SerializedErrorForLog;
}

function serializeCause(
  cause: unknown,
  depth: number,
): SerializedErrorForLog | unknown {
  if (depth >= MAX_CAUSE_DEPTH) {
    return { type: GENERIC_ERROR_LABEL, message: CAUSE_TRUNCATION_MARKER };
  }
  if (
    typeof cause !== "object" ||
    cause === null ||
    !(cause instanceof Error)
  ) {
    // Non-Error cause values (plain objects) carry no classification
    // contract; emit only their type marker instead of copying contents.
    return typeMarker(cause);
  }
  const source = cause as Error & Record<string, unknown>;
  const label = classifyError(source);

  const out: Record<string, unknown> = {
    type: label,
    name: label,
    // Message and stack intentionally absent entirely: both are data-derived
    // for wrapped errors (see the serializer field policy above).
  };
  const code = safeCodeOf(source);
  if (code !== undefined) out.code = code;
  const statusCode = safeStatusCodeOf(source);
  if (statusCode !== undefined) out.statusCode = statusCode;
  if (source.cause !== undefined) {
    out.cause = serializeCause(source.cause, depth + 1);
  }
  return out;
}

/**
 * #925 fixed placeholder when no trusted route template exists (pre-routing
 * paths — e.g. Fastify's 404 fallback serializes the RAW node request,
 * which has no `routeOptions`). INVARIANT: never fall back to a raw
 * pathname — the path itself can carry client secrets, not just the query.
 */
export const UNROUTED_LOG_PLACEHOLDER = "(unrouted)";

/**
 * Structural shape the #925 request serializer accepts: a FastifyRequest
 * (has `routeOptions` and the derived `ip`) or a raw node request from the
 * pre-routing fallback paths (has neither).
 */
interface LoggableRequest {
  // `| undefined` on every member: the package compiles with
  // exactOptionalPropertyTypes, and FastifyRequest's routeOptions.url is
  // `string | undefined` — a plain optional member would reject it.
  method?: string | undefined;
  routeOptions?: { url?: string | undefined } | null | undefined;
  ip?: string | undefined;
  socket?: { remotePort?: number | undefined } | null | undefined;
}

/**
 * #925 trusted route template for a request being logged: Fastify's matched
 * route (`routeOptions.url`, e.g. `/api/exams/:id`) or the fixed
 * placeholder. INVARIANT: this never returns the raw URL — dynamic segment
 * bytes and query strings are structurally excluded, not sanitized.
 */
export function routeTemplateOf(request: LoggableRequest): string {
  return request.routeOptions?.url ?? UNROUTED_LOG_PLACEHOLDER;
}

/** Shape of the serialized `req` entry (undefined members are omitted). */
export interface SerializedReqForLog {
  // Index signature: fastify's serializers.req contract expects a
  // string-indexable return value.
  [key: string]: unknown;
  method?: string;
  route: string;
  remoteAddress?: string;
  remotePort?: number;
}

/**
 * #925 serializer for the pino `req` channel, replacing Fastify's default
 * `asReqValue` which persists the raw `req.url` (full query string) on the
 * "incoming request" line of every request.
 *
 * Policy: keep server-observed facts only — method, matched route template,
 * socket address/port. Client-controlled `url`, `host`, and `accept-version`
 * are structurally absent. No per-line URL parsing: the template is a
 * precomputed property of the matched route.
 */
export function serializeReqForLog(req: LoggableRequest): SerializedReqForLog {
  // Members are set only when observed: the package compiles with
  // exactOptionalPropertyTypes, and pino drops absent keys anyway.
  const out: SerializedReqForLog = { route: routeTemplateOf(req) };
  if (req.method !== undefined) out.method = req.method;
  if (req.ip !== undefined) out.remoteAddress = req.ip;
  const remotePort = req.socket ? req.socket.remotePort : undefined;
  if (remotePort !== undefined) out.remotePort = remotePort;
  return out;
}
