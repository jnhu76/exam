import type { Exam } from "@exam/domain";
import { QueueAdmissionRequiredError } from "@exam/domain";

/**
 * #292 — durable exam admission runtime.
 *
 * QUEUE AUTHORITY IS NOT TIME AUTHORITY: admission answers exactly one
 * question — "is this candidate admitted to START this exam?". Nothing here
 * reads or derives exam timing semantics (openAt/closeAt, timingMode,
 * syncStartedAt, personal deadlines); `now` is used only to evaluate the
 * batch release schedule against the durable join anchor.
 *
 * PROCESS MEMORY IS NOT PRODUCT STATE: membership and admission facts live
 * in `exam_admissions` (PostgreSQL) through {@link ExamAdmissionRepository}.
 * The engine owns the predicate and the transition rules; the repository owns
 * durability and uniqueness (one ACTIVE membership per candidate and exam,
 * enforced by a partial unique index).
 *
 * Batch policy source is the published exam row: controlFlags are frozen
 * post-publish (draft-only edit authority), so reading `exam.controlFlags`
 * at admission time cannot drift mid-run.
 */

/** Durable admission lifecycle states, all derived from timestamps. */
export type AdmissionState = "waiting" | "admitted" | "consumed";

/** A durable admission membership row. */
export interface ExamAdmissionRecord {
  id: string;
  organizationId: string;
  examId: string;
  candidateId: string;
  joinedAt: Date;
  admittedAt: Date | null;
  consumedAt: Date | null;
  consumedAttemptId: string | null;
}

/** Candidate-facing derived queue view (contract-mappable). */
export interface AdmissionQueueView {
  state: AdmissionState;
  /** 1-based position among active (not consumed) memberships. */
  position: number;
  /** Candidates ahead of this candidate who are not yet admitted. */
  waitCount: number;
  estimatedWaitSeconds: number;
  /** True when the durable admission fact exists and is not consumed. */
  ready: boolean;
}

export interface ExamAdmissionRepository {
  /**
   * Idempotent join: inserts a membership row, or returns the existing
   * ACTIVE row when present. Rows whose `consumed_at` is set are history;
   * a re-join inserts a fresh membership (retake flow).
   */
  joinActive(input: {
    organizationId: string;
    examId: string;
    candidateId: string;
    joinedAt: Date;
  }): Promise<ExamAdmissionRecord>;

  /** The candidate's ACTIVE (not consumed) membership, if any. */
  findActive(
    organizationId: string,
    examId: string,
    candidateId: string,
  ): Promise<ExamAdmissionRecord | null>;

  /**
   * Earliest joined_at among ALL memberships of the exam (the immutable batch
   * anchor). Consumed rows are history, but they keep the epoch from shifting
   * when the active set shrinks.
   */
  earliestJoinedAt(
    organizationId: string,
    examId: string,
  ): Promise<Date | null>;

  /**
   * Count of ALL memberships (active + consumed) strictly ahead of
   * (joinedAt, id). This is the candidate's stable schedule ordinal; it never
   * changes when another candidate starts.
   */
  countAllAhead(
    organizationId: string,
    examId: string,
    joinedAt: Date,
    id: string,
  ): Promise<number>;

  /** Count of ACTIVE memberships strictly ahead of (joinedAt, id) — UI position. */
  countActiveAhead(
    organizationId: string,
    examId: string,
    joinedAt: Date,
    id: string,
  ): Promise<number>;

  /**
   * Write-once admission: sets admitted_at iff still NULL. Returns the
   * admitted row, or null when the row was already admitted/consumed
   * (idempotent CAS — concurrent reconciliations converge on one fact).
   */
  admitOnce(id: string, admittedAt: Date): Promise<ExamAdmissionRecord | null>;

  /**
   * Consume the ACTIVE membership inside the attempt-start transaction:
   * sets consumed_at + consumed_attempt_id iff consumed_at IS NULL. Returns
   * null when there is nothing to consume (zero rows = caller must fail the
   * transaction — fail-closed against duplicate consumption).
   */
  consumeActive(
    organizationId: string,
    examId: string,
    candidateId: string,
    consumedAt: Date,
    attemptId: string,
  ): Promise<ExamAdmissionRecord | null>;

  /** Operator visibility: all memberships of the exam, join order first. */
  listByExam(
    organizationId: string,
    examId: string,
  ): Promise<ExamAdmissionRecord[]>;
}

/** Dependencies for the admission commands. */
export interface AdmissionDeps {
  repo: ExamAdmissionRepository;
}

/**
 * Pure batch release schedule: the anchor is the earliest joined_at across
 * all memberships (active + consumed). Every interval seconds another
 * batchSize candidates are released; the first batch is released at the
 * anchor instant (elapsed 0 → batch 1). Underfilled batches release on
 * schedule regardless of the actual waiting count.
 */
export function computeBatchRelease(input: {
  anchor: Date | null;
  now: Date;
  batchSize: number;
  batchIntervalSeconds: number;
}): { releasedBatches: number; releasedCount: number } {
  const { anchor, now, batchSize, batchIntervalSeconds } = input;
  if (anchor === null) {
    return { releasedBatches: 0, releasedCount: 0 };
  }
  const elapsedSeconds = Math.max(
    0,
    Math.floor((now.getTime() - anchor.getTime()) / 1000),
  );
  const releasedBatches = Math.floor(elapsedSeconds / batchIntervalSeconds) + 1;
  return { releasedBatches, releasedCount: releasedBatches * batchSize };
}

/** Stable batch number for a schedule ordinal. */
export function computeBatchNumber(ordinal: number, batchSize: number): number {
  return Math.ceil(ordinal / batchSize);
}

/** Derived lifecycle state — never stored, always computed. */
export function deriveAdmissionState(
  record: Pick<ExamAdmissionRecord, "admittedAt" | "consumedAt">,
): AdmissionState {
  if (record.consumedAt !== null) {
    return "consumed";
  }
  return record.admittedAt === null ? "waiting" : "admitted";
}

/** Stable schedule ordinal — never changes because of consumption. */
async function scheduleOrdinal(
  deps: AdmissionDeps,
  organizationId: string,
  examId: string,
  record: ExamAdmissionRecord,
): Promise<number> {
  return (
    (await deps.repo.countAllAhead(
      organizationId,
      examId,
      record.joinedAt,
      record.id,
    )) + 1
  );
}

/** UI position among currently active rows — may improve as others start. */
async function activePosition(
  deps: AdmissionDeps,
  organizationId: string,
  examId: string,
  record: ExamAdmissionRecord,
): Promise<number> {
  return (
    (await deps.repo.countActiveAhead(
      organizationId,
      examId,
      record.joinedAt,
      record.id,
    )) + 1
  );
}

/**
 * Joins the durable admission queue. Idempotent (Q4): a candidate with an
 * active membership gets that membership back unchanged.
 */
export async function joinAdmissionQueue(
  deps: AdmissionDeps,
  exam: Exam,
  candidateId: string,
  now: Date,
): Promise<ExamAdmissionRecord> {
  return deps.repo.joinActive({
    organizationId: exam.organizationId,
    examId: exam.id,
    candidateId,
    joinedAt: now,
  });
}

/**
 * Derived queue view for the candidate surface. Pure read: materialization
 * happens through {@link reconcileAdmission} before this is called on the
 * join/status path; `ready` is therefore the durable admitted fact, never a
 * second copy of the predicate. Ordering is the durable (joined_at, id) key
 * over ACTIVE rows; `now` only drives the wait estimate.
 */
export async function previewAdmissionStatus(
  deps: AdmissionDeps,
  exam: Exam,
  candidateId: string,
  now: Date,
): Promise<AdmissionQueueView> {
  const active = await deps.repo.findActive(
    exam.organizationId,
    exam.id,
    candidateId,
  );
  const anchor = await deps.repo.earliestJoinedAt(exam.organizationId, exam.id);
  const { releasedBatches, releasedCount } = computeBatchRelease({
    anchor,
    now,
    batchSize: exam.controlFlags.batchSize,
    batchIntervalSeconds: exam.controlFlags.batchInterval,
  });

  if (active === null) {
    // No active membership (never joined, or prior membership consumed):
    // no barrier fact to report — position 1, zero wait. The start gate
    // enforces membership independently.
    return {
      state: "waiting",
      position: 1,
      waitCount: 0,
      estimatedWaitSeconds: 0,
      ready: false,
    };
  }

  const state = deriveAdmissionState(active);
  const ordinal = await scheduleOrdinal(
    deps,
    exam.organizationId,
    exam.id,
    active,
  );
  const position = await activePosition(
    deps,
    exam.organizationId,
    exam.id,
    active,
  );
  const batchNumber = computeBatchNumber(ordinal, exam.controlFlags.batchSize);
  const batchesUntilReady = Math.max(0, batchNumber - releasedBatches);

  return {
    state,
    position,
    waitCount: Math.max(0, position - releasedCount),
    estimatedWaitSeconds:
      state === "waiting"
        ? batchesUntilReady * exam.controlFlags.batchInterval
        : 0,
    ready: state === "admitted",
  };
}

/**
 * Demand-driven reconciliation: materializes the durable admitted fact when
 * the derived predicate says the candidate is eligible. Idempotent (Q5):
 * the CAS write happens at most once; concurrent reconciliations converge.
 *
 * The release predicate uses the candidate's stable schedule ordinal (count
 * over ALL memberships), not their current UI position among active rows, so
 * another candidate starting cannot move this candidate's batch boundary
 * earlier (batch schedule semantics corrective).
 *
 * Returns the (possibly admitted) ACTIVE membership.
 */
export async function reconcileAdmission(
  deps: AdmissionDeps,
  exam: Exam,
  candidateId: string,
  now: Date,
): Promise<ExamAdmissionRecord | null> {
  const active = await deps.repo.findActive(
    exam.organizationId,
    exam.id,
    candidateId,
  );
  if (active === null) {
    return null;
  }
  if (active.admittedAt !== null) {
    return active;
  }

  const anchor = await deps.repo.earliestJoinedAt(exam.organizationId, exam.id);
  const { releasedBatches } = computeBatchRelease({
    anchor,
    now,
    batchSize: exam.controlFlags.batchSize,
    batchIntervalSeconds: exam.controlFlags.batchInterval,
  });
  const ordinal = await scheduleOrdinal(
    deps,
    exam.organizationId,
    exam.id,
    active,
  );
  const batchNumber = computeBatchNumber(ordinal, exam.controlFlags.batchSize);

  if (batchNumber > releasedBatches) {
    return active;
  }
  return (await deps.repo.admitOnce(active.id, now)) ?? active;
}

/**
 * THE START GATE (Q2/Q3/Q6). Called inside the attempt-start transaction
 * AFTER the canonical Enrollment lock, ONLY on the new-attempt path —
 * resume/restore of an active attempt never consults admission (queue
 * admission gates START, not re-entry).
 *
 * Fails closed: no active membership, or admission not yet eligible →
 * {@link QueueAdmissionRequiredError}. No lazy join: membership is an
 * explicit durable command (`joinAdmissionQueue`), never a guard side
 * effect.
 */
export async function ensureStartAdmission(
  deps: AdmissionDeps,
  exam: Exam,
  candidateId: string,
  now: Date,
): Promise<ExamAdmissionRecord> {
  const admitted = await reconcileAdmission(deps, exam, candidateId, now);
  if (admitted === null || admitted.admittedAt === null) {
    throw new QueueAdmissionRequiredError();
  }
  return admitted;
}

/** Operator-facing derived admission view for one membership row. */
export interface AdmissionViewItem {
  candidateId: string;
  state: AdmissionState;
  /** Position among ACTIVE rows; null for consumed rows (history). */
  position: number | null;
  joinedAt: Date;
  admittedAt: Date | null;
  consumedAt: Date | null;
  consumedAttemptId: string | null;
}

/**
 * Operator visibility derivation (Q10: the durable rows are the ONLY input).
 * Positions derive from the (joined_at, id) order of the active subset —
 * the same ordering authority the candidate surface uses.
 */
export function deriveAdmissionViews(
  records: ExamAdmissionRecord[],
): AdmissionViewItem[] {
  const activeIndices = records
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => r.consumedAt === null)
    // listByExam returns (joined_at, id) order already; re-sort defensively
    // so the derivation stays correct for any row source.
    .sort((a, b) =>
      a.r.joinedAt.getTime() !== b.r.joinedAt.getTime()
        ? a.r.joinedAt.getTime() - b.r.joinedAt.getTime()
        : a.r.id < b.r.id
          ? -1
          : 1,
    );
  const positionOf = new Map<string, number>();
  activeIndices.forEach(({ r }, position) =>
    positionOf.set(r.id, position + 1),
  );

  return records.map((r) => ({
    candidateId: r.candidateId,
    state: deriveAdmissionState(r),
    position: positionOf.get(r.id) ?? null,
    joinedAt: r.joinedAt,
    admittedAt: r.admittedAt,
    consumedAt: r.consumedAt,
    consumedAttemptId: r.consumedAttemptId,
  }));
}
