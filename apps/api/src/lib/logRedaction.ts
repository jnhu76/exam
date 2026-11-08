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

/** Whitelisted own properties kept for the top-level logged error. */
const ERR_TOP_LEVEL_PROPS = ["name", "code", "statusCode"] as const;

/** Whitelisted own properties kept for each `cause` in the error chain. */
const ERR_CAUSE_PROPS = ["name", "code", "statusCode"] as const;

/** Depth cap guards against circular `cause` chains (Error options allow them). */
const MAX_CAUSE_DEPTH = 5;

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

/** Reduces any value to a type marker without copying its contents. */
function typeMarker(value: unknown): SerializedErrorForLog {
  const typeName =
    typeof value === "object" && value !== null
      ? ((value as { constructor?: { name?: string } }).constructor?.name ??
        "Object")
      : typeof value;
  return { type: typeName, name: typeName, message: "", stack: "" };
}

/**
 * Whitelist serializer for the pino `err` channel.
 *
 * WHY: pino's default error serializer copies every own enumerable property,
 * so one `log.error({ err })` of a wrapped error dumps its payload into the
 * log — e.g. a ResponseSerializationError whose ZodError `cause` embeds the
 * rejected response values (standard answers) in its issue messages, a domain
 * error carrying `details`, or a driver error carrying row data. Path
 * redaction cannot reach inside the serialized error.
 *
 * Policy: log lines keep error identity and classification only.
 * - Top level keeps `type`/`name`/`message`/`stack` plus `code`/`statusCode`:
 *   messages are authored at throw sites in this codebase and the stack
 *   points at them (the error handler routes raw ZodErrors to the 400 branch
 *   before any `{ err }` logging, so data-derived messages do not reach the
 *   top level through request logging).
 * - `cause` chains keep ONLY type/name/code/statusCode. Message AND stack are
 *   dropped: an Error stack's header embeds its message ("Type: message"),
 *   so for data-derived causes (a ZodError cause embeds the rejected payload
 *   values in both) either would carry them into the log. Constraint
 *   diagnosis survives through the preserved SQLSTATE `code` (e.g. 23505).
 * - Non-Error values reduce to a type marker; their contents are never
 *   copied.
 * - Everything else (`details`, `issues`, `validation`, driver `detail`)
 *   is structurally absent from the log line, not merely censored.
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

  const out: Record<string, unknown> = {
    type: source.constructor?.name ?? "Error",
    name: source.name,
    message: source.message,
    stack: source.stack ?? "",
  };
  for (const key of ERR_TOP_LEVEL_PROPS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
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
    return { type: "Error", message: "[cause chain truncated]" };
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

  const out: Record<string, unknown> = {
    type: source.constructor?.name ?? "Error",
    name: source.name,
    // Stack intentionally omitted: its header embeds the cause message,
    // which is data-derived for wrapped errors (see policy above).
  };
  for (const key of ERR_CAUSE_PROPS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
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
