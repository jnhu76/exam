/**
 * Single privacy-policy owner for every email error exit (#1012).
 *
 * Every surface that persists, logs, or serves an email-worker error goes
 * through this module: `SmtpEmailSender` wrapping, `EmailOutboxService`
 * `lastError` persistence + dead-letter log, the two host transports
 * (in-process loop via Pino, standalone worker via stdout/stderr JSON),
 * `/email/test` responses, and the diagnostics read-side projection.
 *
 * INVARIANT — no free text ever leaves through this policy:
 *  - raw `message` / `name` / `stack` / `response` / `String(err)` are never
 *    read, so provider-echoed SQL, bind params, credentials, recipient
 *    addresses, body content, paths, or URLs cannot reach any sink;
 *  - only a fixed category plus strictly allowlisted SMTP transport codes /
 *    PostgreSQL SQLSTATEs and an integer SMTP response code in 400–599 are
 *    retainable — a correctly shaped value that is not in the closed sets is
 *    rejected, not passed through;
 *  - classification never throws: hostile shapes (throwing getters, circular
 *    causes, toString/toJSON tricks) degrade to the fixed `internal_error`
 *    category instead of escaping into the delivery state machine.
 */

// ── Closed categories ───────────────────────────────────────────────

/**
 * Fixed, recognizable failure categories. Diagnostics (SMTP auth failure vs
 * connection failure vs recipient rejection, DB failures) survive as these
 * labels — never as raw error text.
 */
export const EMAIL_ERROR_CATEGORIES = [
  "smtp_auth_failed",
  "smtp_connection_failed",
  "smtp_recipient_rejected",
  "smtp_send_failed",
  "db_connection_failed",
  "db_error",
  "internal_error",
] as const;

export type EmailErrorCategory = (typeof EMAIL_ERROR_CATEGORIES)[number];

// ── Allowlisted codes ───────────────────────────────────────────────

/** SMTP transport codes nodemailer / the network stack report on send. */
export type SmtpErrorCode =
  | "EAUTH"
  | "ECONNECTION"
  | "ECONNREFUSED"
  | "ETIMEDOUT"
  | "ESOCKET"
  | "EDNS"
  | "EAI_AGAIN"
  | "ESTRAYPIPE"
  | "ECONNCLOSED"
  | "EPROTO"
  | "EPROTOCOL"
  | "ETLSCRT"
  | "ETLSSRV"
  | "EENVELOPE"
  | "EMESSAGE"
  | "ECOMMAND";

/** PostgreSQL SQLSTATEs an email worker can hit, retained for operability. */
export type DbSqlstateCode =
  | "08000"
  | "08001"
  | "08003"
  | "08004"
  | "08006"
  | "08007"
  | "53300"
  | "57P01"
  | "57P02"
  | "57P03"
  | "40001"
  | "40P01"
  | "3D000"
  | "42P01"
  | "42501"
  | "28P01"
  | "23505"
  | "23503";

/** The only error-code strings the policy may ever emit. */
export type EmailErrorCode = SmtpErrorCode | DbSqlstateCode;

const SMTP_CODE_CATEGORY: Record<SmtpErrorCode, EmailErrorCategory> = {
  EAUTH: "smtp_auth_failed",
  ECONNECTION: "smtp_connection_failed",
  ECONNREFUSED: "smtp_connection_failed",
  ETIMEDOUT: "smtp_connection_failed",
  ESOCKET: "smtp_connection_failed",
  EDNS: "smtp_connection_failed",
  EAI_AGAIN: "smtp_connection_failed",
  ESTRAYPIPE: "smtp_connection_failed",
  ECONNCLOSED: "smtp_connection_failed",
  EPROTO: "smtp_send_failed",
  EPROTOCOL: "smtp_send_failed",
  ETLSCRT: "smtp_send_failed",
  ETLSSRV: "smtp_send_failed",
  EENVELOPE: "smtp_send_failed",
  EMESSAGE: "smtp_send_failed",
  ECOMMAND: "smtp_send_failed",
};

const DB_CODE_CATEGORY: Record<DbSqlstateCode, EmailErrorCategory> = {
  "08000": "db_connection_failed",
  "08001": "db_connection_failed",
  "08003": "db_connection_failed",
  "08004": "db_connection_failed",
  "08006": "db_connection_failed",
  "08007": "db_connection_failed",
  "53300": "db_connection_failed",
  "57P01": "db_connection_failed",
  "57P02": "db_connection_failed",
  "57P03": "db_connection_failed",
  "40001": "db_error",
  "40P01": "db_error",
  "3D000": "db_error",
  "42P01": "db_error",
  "42501": "db_error",
  "28P01": "db_error",
  "23505": "db_error",
  "23503": "db_error",
};

const SMTP_CODES: ReadonlySet<string> = new Set(
  Object.keys(SMTP_CODE_CATEGORY),
);
const DB_CODES: ReadonlySet<string> = new Set(Object.keys(DB_CODE_CATEGORY));
const ALLOWED_CODES: ReadonlySet<string> = new Set([
  ...SMTP_CODES,
  ...DB_CODES,
]);

// ── Classification ──────────────────────────────────────────────────

/** The safe representation of an email-worker error. */
export interface EmailErrorClassification {
  readonly category: EmailErrorCategory;
  /** Allowlisted SMTP transport code or PostgreSQL SQLSTATE; null otherwise. */
  readonly code: EmailErrorCode | null;
  /** Strictly validated integer SMTP response code (400–599); null otherwise. */
  readonly smtpResponseCode: number | null;
}

/**
 * Read one property of a hostile thrown value without letting a throwing
 * getter escape into the business flow.
 */
function safeProp<T>(error: unknown, read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function extractCode(error: unknown): EmailErrorCode | null {
  const code = safeProp(error, () =>
    error !== null && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined,
  );
  if (typeof code !== "string") return null;
  return ALLOWED_CODES.has(code) ? (code as EmailErrorCode) : null;
}

function extractResponseCode(error: unknown): number | null {
  const rc = safeProp(error, () =>
    error !== null && typeof error === "object"
      ? (error as { responseCode?: unknown }).responseCode
      : undefined,
  );
  if (typeof rc !== "number" || !Number.isInteger(rc)) return null;
  return rc >= 400 && rc <= 599 ? rc : null;
}

/**
 * Classify any thrown value into the closed safe representation. Never
 * throws, never reads free-text properties. An {@link EmailSendError} is
 * re-classified from the closed classification it was constructed with —
 * its `message` is derived by this policy, never caller text.
 */
export function classifyEmailError(error: unknown): EmailErrorClassification {
  if (error instanceof EmailSendError) {
    return error.classification;
  }
  const code = extractCode(error);
  if (code !== null) {
    const category = SMTP_CODES.has(code)
      ? SMTP_CODE_CATEGORY[code as SmtpErrorCode]
      : DB_CODE_CATEGORY[code as DbSqlstateCode];
    return { category, code, smtpResponseCode: extractResponseCode(error) };
  }
  const smtpResponseCode = extractResponseCode(error);
  if (smtpResponseCode !== null) {
    return { category: "smtp_send_failed", code: null, smtpResponseCode };
  }
  return { category: "internal_error", code: null, smtpResponseCode: null };
}

// ── Safe single-line rendering ──────────────────────────────────────

/**
 * Render the canonical safe string: `email_error:<category>` plus the
 * allowlisted code and/or the validated response code when present, e.g.
 * `email_error:smtp_auth_failed code=EAUTH rc=535`. This is the ONLY shape
 * new `lastError` writes and log emissions produce.
 */
export function formatEmailErrorClassification(
  classification: EmailErrorClassification,
): string {
  let out = `email_error:${classification.category}`;
  if (classification.code !== null) out += ` code=${classification.code}`;
  if (classification.smtpResponseCode !== null) {
    out += ` rc=${classification.smtpResponseCode}`;
  }
  return out;
}

/**
 * Sanitize any thrown email error into the single safe string persisted to
 * `lastError`, logged, or served by `/email/test`. Never throws and never
 * contains raw error content.
 */
export function sanitizeEmailError(error: unknown): string {
  return formatEmailErrorClassification(classifyEmailError(error));
}

// ── Sender error type ───────────────────────────────────────────────

/**
 * Error thrown by email senders on failure. Constructible ONLY from a
 * classification produced by this policy, so `message` is always the safe
 * rendering and downstream consumers can re-derive the closed
 * classification without parsing free text.
 */
export class EmailSendError extends Error {
  readonly classification: EmailErrorClassification;

  constructor(classification: EmailErrorClassification) {
    super(formatEmailErrorClassification(classification));
    this.name = "EmailSendError";
    this.classification = classification;
  }
}

// ── Fixed states + read-side projection ─────────────────────────────

/**
 * Fixed heartbeat label while the initial organization has not been
 * bootstrapped. A defined, recognizable state — not an error payload.
 * Lives here (not in the worker entry) because the diagnostics read-side
 * projection must recognize it without importing the worker module.
 */
export const BOOTSTRAP_PENDING_MESSAGE =
  "bootstrap_pending: initial organization not initialized";

/**
 * Fixed label for stored errors whose content cannot be disclosed
 * (historical free-text rows written before this policy, or by a worker
 * still running old code during a rolling upgrade).
 */
export const UNDISCLOSED_EMAIL_ERROR = "email_error:undisclosed";

const CANONICAL_EMAIL_ERROR_STRING =
  /^email_error:([a-z_]+)(?: code=([A-Z0-9_]{2,16}))?(?: rc=(\d{3}))?$/;

/**
 * Strict canonical-form check for a stored `lastError` value: full-string
 * grammar match, category/code/rc each validated against the closed sets,
 * the (category, code, rc) combination must be one the writer can actually
 * produce, and the re-render must be byte-identical. A value that merely
 * "looks prefixed right" — or pairs a valid code with the wrong category —
 * is rejected.
 */
function isCanonicalSafeEmailErrorString(value: string): boolean {
  const match = CANONICAL_EMAIL_ERROR_STRING.exec(value);
  if (!match) return false;
  const category = match[1] as EmailErrorCategory;
  if (!EMAIL_ERROR_CATEGORIES.includes(category)) return false;
  const code = (match[2] ?? null) as EmailErrorCode | null;
  if (code !== null && !ALLOWED_CODES.has(code)) return false;
  const rc = match[3] !== undefined ? Number(match[3]) : null;
  if (rc !== null && (rc < 400 || rc > 599)) return false;

  // Pair consistency — only writer-producible combinations pass:
  if (category === "internal_error" || category === "smtp_recipient_rejected") {
    // These categories never carry a code or response code.
    if (code !== null || rc !== null) return false;
  } else if (category === "smtp_send_failed") {
    // Either one of its own protocol codes (rc optional) or a bare
    // response-code-only rejection.
    if (code !== null) {
      if (SMTP_CODE_CATEGORY[code as SmtpErrorCode] !== "smtp_send_failed") {
        return false;
      }
    } else if (rc === null) {
      return false;
    }
  } else {
    // Code-mapped categories carry exactly their mapped code.
    if (code === null) return false;
    const mapped = SMTP_CODES.has(code)
      ? SMTP_CODE_CATEGORY[code as SmtpErrorCode]
      : DB_CODE_CATEGORY[code as DbSqlstateCode];
    if (mapped !== category) return false;
  }

  return (
    formatEmailErrorClassification({
      category,
      code,
      smtpResponseCode: rc,
    }) === value
  );
}

/**
 * Read-side projection for stored `worker_heartbeats.last_error` (and any
 * other persisted email error string re-served over HTTP): historical rows
 * are untrusted input even after every writer is fixed — an old or
 * rolling-upgrade worker may still have written free text.
 *
 *  - `null` stays `null` (the no-current-error contract is untouched);
 *  - the fixed `bootstrap_pending` state and canonical safe strings pass
 *    through unchanged;
 *  - everything else — free text, malformed or non-canonical values — maps
 *    to the fixed {@link UNDISCLOSED_EMAIL_ERROR} label.
 *
 * Read-side protection does NOT physically purge historical bytes from the
 * database; it only stops them from being disclosed.
 */
export function projectStoredEmailError(value: string | null): string | null {
  if (value === null) return null;
  if (value === BOOTSTRAP_PENDING_MESSAGE) return value;
  if (isCanonicalSafeEmailErrorString(value)) return value;
  return UNDISCLOSED_EMAIL_ERROR;
}
