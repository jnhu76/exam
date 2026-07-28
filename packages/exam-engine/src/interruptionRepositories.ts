import type {
  AttemptInterruption,
  AttemptInterruptionEvent,
  AttemptTimeAdjustment,
  InterruptionDetectionSource,
  InterruptionEventType,
  InterruptionTimePolicy,
  TimeAdjustmentSource,
} from "@exam/domain";

/**
 * Engine-facing input for inserting one interruption episode event.
 *
 * Mirrors the domain {@link AttemptInterruptionEvent} minus the
 * repo-managed identity/timestamp fields. The engine never imports Drizzle
 * row types; this local shape is the engine-side contract.
 */
export interface InsertInterruptionEventInput {
  attemptId: string;
  interruptionId: string;
  eventType: InterruptionEventType;
  occurredAt: Date;
  observedLastActivityAt: Date | null;
  detectionSource: InterruptionDetectionSource | null;
  timeoutSeconds: number | null;
  policy: InterruptionTimePolicy;
  eligibleSeconds: number | null;
  timeAdjustmentId: string | null;
  actorId: string | null;
  reasonCode: string;
}

/**
 * Engine-facing input for inserting one positive time-adjustment ledger row.
 *
 * Mirrors the domain {@link AttemptTimeAdjustment} minus the repo-managed
 * identity/timestamp fields.
 */
export interface InsertTimeAdjustmentInput {
  operationId?: string;
  attemptId: string;
  interruptionId: string | null;
  incidentId: string | null;
  policy: InterruptionTimePolicy;
  source: TimeAdjustmentSource;
  beforeDeadline: Date;
  afterDeadline: Date;
  addedSeconds: number;
  eligibleSeconds: number | null;
  reasonCode: string;
  reasonText: string | null;
  actorId: string | null;
}

/**
 * Engine port for the durable interruption episode parent
 * (`attempt_interruptions`). Append-only: no update/delete surface.
 */
export interface InterruptionEpisodeRepository {
  /** Creates a new episode parent for the attempt, returning its row. */
  create(attemptId: string): Promise<AttemptInterruption>;
  /** Loads an episode by id (no lock). */
  findById(interruptionId: string): Promise<AttemptInterruption | null>;
  /**
   * Loads a specific episode for an attempt under the caller's row lock.
   * The factory must receive the active transaction's repo handle so the
   * lock remains held through the caller's transaction.
   */
  findByAttemptForUpdate(
    attemptId: string,
    interruptionId: string,
  ): Promise<AttemptInterruption | null>;
  /** Returns the most recent episode for an attempt, or null. */
  findLatestByAttempt(attemptId: string): Promise<AttemptInterruption | null>;
}

/**
 * Engine port for the append-only interruption event ledger
 * (`attempt_interruption_events`).
 */
export interface InterruptionEventRepository {
  /** Appends one event row. */
  insert(
    input: InsertInterruptionEventInput,
  ): Promise<AttemptInterruptionEvent>;
  /** Returns the unique detected event for an episode, or null. */
  findDetected(
    interruptionId: string,
  ): Promise<AttemptInterruptionEvent | null>;
  /** Returns the single outcome event (restored|terminalized) for an episode, or null. */
  findOutcome(interruptionId: string): Promise<AttemptInterruptionEvent | null>;
  /**
   * Returns the latest outcome event across all of an attempt's episodes,
   * ordered deterministically by (occurredAt DESC, createdAt DESC, id DESC).
   * Used for restore idempotency reconstruction.
   */
  findLatestOutcomeByAttempt(
    attemptId: string,
  ): Promise<AttemptInterruptionEvent | null>;
}

/**
 * Engine port for the append-only positive-adjustment ledger
 * (`attempt_time_adjustments`).
 */
export interface TimeAdjustmentRepository {
  /** Inserts one positive adjustment row. */
  insert(input: InsertTimeAdjustmentInput): Promise<AttemptTimeAdjustment>;
  /** Loads an adjustment by id, used for retry reconstruction validation. */
  findById(adjustmentId: string): Promise<AttemptTimeAdjustment | null>;
  /**
   * Returns the existing bounded_grace adjustment for an interruption, or
   * null. The partial unique index makes this the idempotency authority for
   * automatic bounded grants.
   */
  findBoundedByInterruption(
    interruptionId: string,
  ): Promise<AttemptTimeAdjustment | null>;
  /** Sums committed bounded_grace added_seconds for an attempt. */
  sumBoundedGraceSeconds(attemptId: string): Promise<number>;
}
