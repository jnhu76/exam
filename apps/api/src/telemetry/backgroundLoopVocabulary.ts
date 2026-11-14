/**
 * Frozen W4 vocabulary of the API background-loop signals (#964 W4, ADR-028
 * D3/D4) — the loop cycle spans AND the loop metric instruments.
 *
 * Every span name, metric name, metric label key, and label VALUE category
 * the loop layer can emit lives here. The vocabulary is deliberately closed:
 * attempt ids, organization ids, workerInstanceId, error messages, and any
 * other high-cardinality technical field have NO label or attribute key they
 * could travel under (ADR-028 D4 — metric labels stay low-cardinality; the
 * per-attempt and per-row facts stay in the existing structured logs and the
 * W3 business spans, which carry the id correlation).
 *
 * One span = ONE settled cycle of one loop (`setInterval` tick / poll pass /
 * retention pass). The cycle outcome records the tick's own 开始/结果/空轮/
 * 失败 facts: `success` (work was done), `empty` (legitimately nothing to
 * do), `failed` (the cycle settled with ≥1 per-item business failure),
 * `exception` (the cycle body threw — per-item progress at throw time is
 * unknown). These are loop-specific categories, NOT the W3 business-op ones
 * (`success/rejected/no_op/exception`): an empty round is the common healthy
 * case for a loop, and a per-item failure is not a wire "rejection".
 *
 * Layer separation: `exam.loop.*` names the loop cycle (the WHY-these-ran
 * layer); W3 `exam.attempt.*` business spans name WHAT a business operation
 * did and parent under the cycle span via the ambient context; W2 `db.*`
 * spans name HOW storage behaved. No loop span or loop metric records SQL,
 * business outcome categories, or per-row identities.
 *
 * Vocabulary freeze authority: W4 freezes THIS set next to the W2 DB metric
 * vocabulary and the W3 business span vocabulary (compat matrix §1). Renames
 * after the freeze are contract changes, not cleanups.
 */

/**
 * Meter/Tracer instrumentation scope of the API telemetry layers. The W3
 * business spans, W4 loop spans, and W4 loop metrics all come from the same
 * apps/api instrumentation (`exam.api`); the W2 DB plugin keeps its own
 * `exam.db` scope.
 */
export const LOOP_INSTRUMENTATION_SCOPE = "exam.api";

/** Heartbeat disruption + System-incident reconciliation tick (heartbeat.ts). */
export const LOOP_HEARTBEAT = "heartbeat";
/** Deadline discovery + auto-submit tick (deadlineScanner.ts). */
export const LOOP_DEADLINE_SCANNER = "deadline_scanner";
/** Client-event retention pass (clientEventRetention.ts). */
export const LOOP_CLIENT_EVENT_RETENTION = "client_event_retention";
/** In-process email outbox delivery poll (emailOutboxLoop.ts). */
export const LOOP_EMAIL_OUTBOX = "email_outbox";

/** Union of the closed loop names — the only allowed `exam.loop.name` value. */
export type BackgroundLoopName =
  | typeof LOOP_HEARTBEAT
  | typeof LOOP_DEADLINE_SCANNER
  | typeof LOOP_CLIENT_EVENT_RETENTION
  | typeof LOOP_EMAIL_OUTBOX;

/** One settled heartbeat tick (disruption scan + incident reconciliation). */
export const SPAN_LOOP_HEARTBEAT = "exam.loop.heartbeat";
/** One settled deadline scan tick (discovery + per-candidate auto-submit). */
export const SPAN_LOOP_DEADLINE_SCANNER = "exam.loop.deadline_scanner";
/** One settled retention pass (org discovery + per-org deletes). */
export const SPAN_LOOP_CLIENT_EVENT_RETENTION =
  "exam.loop.client_event_retention";
/** One settled email outbox poll (recover + claim + deliver batch). */
export const SPAN_LOOP_EMAIL_OUTBOX = "exam.loop.email_outbox";

/**
 * The bijection between a loop and its cycle span name — the span helper
 * resolves names ONLY through this record, so call sites cannot invent a
 * span name (the closure test pins it against the constants above).
 */
export const SPAN_NAME_BY_LOOP: Record<BackgroundLoopName, string> = {
  [LOOP_HEARTBEAT]: SPAN_LOOP_HEARTBEAT,
  [LOOP_DEADLINE_SCANNER]: SPAN_LOOP_DEADLINE_SCANNER,
  [LOOP_CLIENT_EVENT_RETENTION]: SPAN_LOOP_CLIENT_EVENT_RETENTION,
  [LOOP_EMAIL_OUTBOX]: SPAN_LOOP_EMAIL_OUTBOX,
};

/** Fixed cycle outcome category — always present on a settled loop span. */
export const ATTR_LOOP_OUTCOME = "exam.loop.outcome";

export const LOOP_OUTCOME_SUCCESS = "success";
export const LOOP_OUTCOME_EMPTY = "empty";
export const LOOP_OUTCOME_FAILED = "failed";
export const LOOP_OUTCOME_EXCEPTION = "exception";

/** Union of the closed cycle outcomes — call sites cannot invent a value. */
export type LoopCycleOutcome =
  | typeof LOOP_OUTCOME_SUCCESS
  | typeof LOOP_OUTCOME_EMPTY
  | typeof LOOP_OUTCOME_FAILED
  | typeof LOOP_OUTCOME_EXCEPTION;

// ── Work kinds: the per-cycle projected results, one closed enum ────────────
// Each kind projects an EXISTING counted/logged fact of its loop (the
// ScanResult / retention result / email ProcessResult counters) — no loop
// gained a second counting path.

/** deadline_scanner: attempts actually submitted+graded by this cycle. */
export const WORK_SUBMITTED = "submitted";
/** deadline_scanner: per-candidate handlers that threw (retried next scan). */
export const WORK_FAILED = "failed";
/** heartbeat: attempts transitioned in_progress → disrupted this cycle. */
export const WORK_MARKED = "marked";
/** heartbeat: disruption handlers that threw. */
export const WORK_DISRUPTION_FAILED = "disruption_failed";
/** heartbeat: System incidents durably created for committed episodes. */
export const WORK_INCIDENT_CREATED = "incident_created";
/** heartbeat: idempotent replays of already-committed incident operations. */
export const WORK_INCIDENT_REPLAYED = "incident_replayed";
/** heartbeat: per-episode deliveries and org discovery passes that threw. */
export const WORK_INCIDENT_FAILED = "incident_failed";
/** heartbeat: op-unique conflicts occupying heartbeat-derived operationIds. */
export const WORK_INCIDENT_CONFLICT = "incident_conflict";
/** client_event_retention: expired rows deleted (org-scoped DELETE). */
export const WORK_DELETED = "deleted";
/** client_event_retention: orgs whose cleanup threw this pass. */
export const WORK_FAILED_ORG = "failed_org";
/** email_outbox: abandoned `processing` rows recovered by lock timeout. */
export const WORK_RECOVERED = "recovered";
/** email_outbox: rows handled in this poll (any terminal transition). */
export const WORK_PROCESSED = "processed";
/** email_outbox: rows moved to terminal `sent`. */
export const WORK_SENT = "sent";
/** email_outbox: rows scheduled for retry with backoff. */
export const WORK_RETRY_WAIT = "retry_wait";
/** email_outbox: rows moved to terminal dead-letter (maxAttempts). */
export const WORK_DEAD = "dead";
/** email_outbox: sends fenced off because another owner holds the row. */
export const WORK_OWNERSHIP_LOST = "ownership_lost";

/** Union of the closed work kinds — the only allowed `exam.loop.work` value. */
export type LoopWorkKind =
  | typeof WORK_SUBMITTED
  | typeof WORK_FAILED
  | typeof WORK_MARKED
  | typeof WORK_DISRUPTION_FAILED
  | typeof WORK_INCIDENT_CREATED
  | typeof WORK_INCIDENT_REPLAYED
  | typeof WORK_INCIDENT_FAILED
  | typeof WORK_INCIDENT_CONFLICT
  | typeof WORK_DELETED
  | typeof WORK_FAILED_ORG
  | typeof WORK_RECOVERED
  | typeof WORK_PROCESSED
  | typeof WORK_SENT
  | typeof WORK_RETRY_WAIT
  | typeof WORK_DEAD
  | typeof WORK_OWNERSHIP_LOST;

/**
 * The work kinds each loop is allowed to project (frozen per-loop allowlist,
 * asserted by the vocabulary closure test). Series appear ONLY for kinds
 * with a nonzero count in a settled cycle, so the series bound per loop is
 * its own allowlist length — 16 distinct work series across all four loops.
 */
export const LOOP_WORK_ALLOWLIST: Record<
  BackgroundLoopName,
  readonly LoopWorkKind[]
> = {
  [LOOP_DEADLINE_SCANNER]: [WORK_SUBMITTED, WORK_FAILED],
  [LOOP_HEARTBEAT]: [
    WORK_MARKED,
    WORK_DISRUPTION_FAILED,
    WORK_INCIDENT_CREATED,
    WORK_INCIDENT_REPLAYED,
    WORK_INCIDENT_FAILED,
    WORK_INCIDENT_CONFLICT,
  ],
  [LOOP_CLIENT_EVENT_RETENTION]: [WORK_DELETED, WORK_FAILED_ORG],
  [LOOP_EMAIL_OUTBOX]: [
    WORK_RECOVERED,
    WORK_PROCESSED,
    WORK_SENT,
    WORK_RETRY_WAIT,
    WORK_DEAD,
    WORK_OWNERSHIP_LOST,
  ],
};

// ── Metric instruments (frozen names, types, units, labels, bounds) ─────────

/**
 * HISTOGRAM (unit `s`) of one settled cycle's wall duration — the SemConv
 * `{operation name}.duration` shape for a discrete operation. Labels:
 * `exam.loop.name` only (4 series). Duration advice buckets cover sub-10ms
 * empty polls through ~10min retention sweeps; the recording point is the
 * single settle boundary of the loop span helper.
 */
export const METRIC_CYCLE_DURATION = "exam.loop.cycle.duration";
/**
 * COUNTER (unit `{cycle}`) of settled cycles. Labels: `exam.loop.name` ×
 * `exam.loop.outcome` — series bound 4 × 4 = 16. The outcome dimension is
 * the metrics projection of the cycle's 开始/结果/空轮/失败 record.
 */
export const METRIC_CYCLE_COUNT = "exam.loop.cycle.count";
/**
 * COUNTER (unit `{item}`) of projected per-cycle work. Labels:
 * `exam.loop.name` × `exam.loop.work` — series bound = the per-loop
 * allowlist (16 series total). Series appear only for nonzero counts.
 */
export const METRIC_WORK_COUNT = "exam.loop.work.count";

/** Metric label key: the loop (closed union, see {@link BackgroundLoopName}). */
export const ATTR_LOOP_NAME = "exam.loop.name";
/** Metric label key: the projected work kind (closed union, see above). */
export const ATTR_LOOP_WORK = "exam.loop.work";

/**
 * SemConv-aligned explicit bucket advice for the cycle duration (seconds).
 * Background cycles range from fast empty polls (<10ms) to the daily
 * retention sweep over a large table (minutes); 600s is the top bucket.
 */
export const CYCLE_DURATION_BUCKETS = [
  0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 10, 30, 120, 600,
] as const;
