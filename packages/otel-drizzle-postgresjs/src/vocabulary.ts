/**
 * Frozen W2 vocabulary of the DB telemetry plugin (#964 W2, ADR-028 D3/D4).
 *
 * Every span name, metric instrument, attribute key, and attribute VALUE
 * category the plugin can emit lives here. The vocabulary is deliberately
 * closed: statement TEXT, bind parameters, connection URLs, credentials, and
 * business payload have no key they could travel under (W2.1 probe §5
 * constraint 5 — DrizzleQueryError.message/.query/.params must never reach a
 * span), and metric labels stay low-cardinality (role/outcome/SQLSTATE).
 *
 * Attribute vocabulary freeze authority: W2 introduces the initial set, W4
 * freezes the full DB metric vocabulary next to the HTTP one (compat matrix
 * §1 — "DB 词汇在 W2/W4 冻结"). Renames after the freeze are contract
 * changes, not cleanups.
 */

/** Tracer/Meter instrumentation scope of this plugin. */
export const INSTRUMENTATION_SCOPE = "exam.db";

/** Span emitted for ONE actually-submitted postgres.js statement. */
export const SPAN_STATEMENT = "db.statement";
/** Span wrapping ONE whole executeInTransaction call (all attempts + backoff). */
export const SPAN_TRANSACTION = "db.transaction";
/** Span wrapping ONE db.transaction attempt inside the retry loop. */
export const SPAN_TRANSACTION_ATTEMPT = "db.transaction.attempt";
/** Span event on the logical transaction span announcing one classified retry. */
export const EVENT_TRANSACTION_RETRY = "transaction.retry";

/** Histogram of statement settle windows (submission → settle, seconds). */
export const HISTOGRAM_STATEMENT_DURATION = "db.client.operation.duration";

export const ATTR_DB_SYSTEM = "db.system";
export const ATTR_DB_RESPONSE_STATUS_CODE = "db.response.status_code";
/** root = statement of a registered root pool; transaction = scoped handler closure. */
export const ATTR_CONNECTION_ROLE = "exam.db.connection.role";
/** Fixed result category of a settled statement (never the error message). */
export const ATTR_OUTCOME = "exam.db.outcome";
/** 0-based attempt index of a db.transaction.attempt span. */
export const ATTR_TX_ATTEMPT = "exam.db.tx.attempt";
export const ATTR_TX_ISOLATION_LEVEL = "exam.db.tx.isolation_level";
/** 1-based failed-attempt number carried by a transaction.retry event. */
export const ATTR_RETRY_FAILED_ATTEMPT = "exam.db.tx.retry.failed_attempt";

export const DB_SYSTEM_POSTGRESQL = "postgresql";
export const ROLE_ROOT = "root";
export const ROLE_TRANSACTION = "transaction";
export const OUTCOME_SUCCESS = "success";
export const OUTCOME_ERROR = "error";

/** Fixed value for errors whose cause chain carries no SQLSTATE at all. */
export const SQLSTATE_UNCLASSIFIED = "UNCLASSIFIED";

/** SemConv-aligned explicit bucket advice for the statement duration (seconds). */
export const STATEMENT_DURATION_BUCKETS = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;
