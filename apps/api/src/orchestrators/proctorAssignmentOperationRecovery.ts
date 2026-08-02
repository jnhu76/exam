/**
 * Proctor-assignment operation recovery — ADR-015 §7 fresh-transaction
 * conflict recovery for `assignProctorToExam` / `revokeProctorFromExam`.
 *
 * The engine command functions run inside `executeInTransaction` at the
 * default REPEATABLE READ isolation. Two named unique constraints arbitrate
 * the races:
 *
 *   - `exam_proctor_assignments_active_unique` (one active episode per
 *     org+exam+proctor): two concurrent assigns with DIFFERENT operationIds
 *     admit exactly one INSERT winner. The loser must NOT simply fresh-read
 *     the winner and return — it must form its own durable `no_change`
 *     receipt, otherwise a later replay of the loser's operationId cannot be
 *     distinguished from a fresh command (ADR-015 §7 recovery algorithm).
 *
 *   - `exam_proctor_assignment_events_org_operation_unique` (the idempotency
 *     arbiter): two concurrent commands with the SAME operationId admit one
 *     event insert; the loser is a replay or conflict, decided by a fresh
 *     lookup.
 *
 * Cases handled here:
 *
 * Case 1 — active-unique 23505 (concurrent assign loser): rollback the failed
 *   transaction, then in a FRESH REPEATABLE READ transaction: (a) look up the
 *   event row by (organizationId, operationId) → replay or
 *   IDEMPOTENCY_CONFLICT (this first statement also establishes the recovery
 *   snapshot); (b) otherwise resolve an episode from that fixed MVCC snapshot —
 *   the active episode if one is visible, else the most-recent episode of ANY
 *   status by the frozen `(created_at DESC, id DESC)` order. The referenced
 *   episode is a durable recovery anchor, not necessarily the physical row that
 *   caused the collision; a reassignment committed before the snapshot may be
 *   selected, one committed after it cannot (ADR-015 §7 Amendment A1); (c)
 *   insert the loser's own no_change event referencing that episode; (d) commit
 *   and return `no_change` + the episode. NO compliance audit (no state change).
 *
 * Case 2 — events operation-unique 23505 (append race): re-run the SAME
 *   command once in a fresh transaction; its own pre-read resolves
 *   replay/conflict. A second loss is decided by a final read-only committed
 *   lookup (matching committed op → idempotent_replayed; different payload →
 *   conflict; otherwise the retry error is preserved). Never recursion.
 *
 * Case 3 — serialization failure (40001) after retry exhaustion: a single
 *   fresh-transaction read-only lookup checks whether the operation committed
 *   during the wait (matching → replay; different → conflict; absent → the
 *   original business error is preserved).
 *
 * Any other error propagates unchanged. 23505 from any constraint other than
 * the two named arbiters is surfaced, never swallowed.
 */
import type { RequestContext } from "@exam/domain";
import { IdempotencyConflictError, NotFoundError } from "@exam/domain";
import type { Database, TransactionDatabase } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createProctorAssignmentRepo } from "@exam/db/src/repository/proctorAssignmentRepo.js";
import {
  isConstraintViolation,
  payloadsEqual,
  PROCTOR_ASSIGNMENT_ACTIVE_UNIQUE_CONSTRAINT,
  PROCTOR_ASSIGNMENT_EVENTS_OPERATION_UNIQUE_CONSTRAINT,
} from "@exam/exam-engine";
import type { ProctorAssignmentRepo } from "@exam/exam-engine";
import type { ExamProctorAssignmentCommandResult } from "@exam/exam-engine";

/** Checks if an error is a serialization failure (40001) anywhere in the chain. */
function isSerializationFailure(err: unknown): boolean {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current === "object" && current !== null) {
      const e = current as Record<string, unknown>;
      if (e.code === "40001") return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : null;
  }
  return false;
}

/**
 * Resolves a committed operation for `operationId` in a FRESH transaction.
 * Returns `{ kind: "replay", result }` when a matching committed operation
 * exists, throws `IdempotencyConflictError` when it committed with a
 * different command/payload, or returns `{ kind: "absent" }`.
 */
async function resolveCommittedOperation(
  db: Database,
  ctx: RequestContext,
  operationId: string,
  commandType: string,
  canonicalPayload: Record<string, unknown>,
): Promise<
  | { kind: "replay"; result: ExamProctorAssignmentCommandResult }
  | { kind: "absent" }
> {
  return executeInTransaction(db, async (tx) => {
    const repo = createProctorAssignmentRepo(
      tx,
    ) as unknown as ProctorAssignmentRepo;
    const existing = await repo.findEventByOperationId(ctx, operationId);
    if (!existing) return { kind: "absent" };
    if (
      existing.commandType === commandType &&
      payloadsEqual(existing.canonicalPayload, canonicalPayload)
    ) {
      const assignment = await repo.findById(ctx, existing.assignmentId);
      if (!assignment) {
        // The committed event's episode vanished — extremely unlikely, but
        // surface it rather than synthesizing a replay.
        throw new IdempotencyConflictError(
          `Operation ${operationId} committed but its assignment is missing`,
        );
      }
      return {
        kind: "replay",
        result: { outcome: "idempotent_replayed", assignment },
      };
    }
    throw new IdempotencyConflictError(
      `Operation ${operationId} already used for ${existing.commandType}`,
    );
  });
}

/**
 * ADR-015 §7 loser-receipt recovery: in a fresh REPEATABLE READ transaction,
 * form the losing assign's own durable `no_change` receipt referencing an
 * episode visible in this transaction's fixed MVCC snapshot — the active
 * episode if one is visible, otherwise the most-recent episode of ANY status
 * under the frozen `(created_at DESC, id DESC)` order, so the loser ALWAYS
 * leaves permanent evidence.
 *
 * The referenced episode is a durable recovery anchor; it is NOT guaranteed to
 * be the physical row that triggered the original unique violation. A
 * reassignment committed before the recovery snapshot may be selected; one
 * committed after the snapshot cannot (ADR-015 §7 Amendment A1). The snapshot
 * is established by the first statement of this transaction
 * (`findEventByOperationId`); no application time bound is used, avoiding the
 * dual-clock (DB `now()` vs app `created_at`) skew hole.
 *
 * The event insert may itself race another recoverer with the same
 * operationId → events operation-unique 23505 → rollback → fresh lookup →
 * replay/conflict (the same rule as Case 2).
 *
 * `opts.afterOperationLookupAbsent` is a test-only, SQL-free seam: it fires
 * after the event lookup returns absent (i.e. after the RR snapshot is
 * established) and before the episode lookup, letting a test pause recovery to
 * prove the snapshot-window boundary. It executes no SQL and does not change
 * the snapshot establishment point.
 *
 * @internal opts is a test-only seam; production callers omit it.
 */
export async function formLoserReceipt(
  db: Database,
  ctx: RequestContext,
  operationId: string,
  commandType: string,
  canonicalPayload: Record<string, unknown>,
  now: Date,
  opts?: { afterOperationLookupAbsent?: () => Promise<void> },
): Promise<ExamProctorAssignmentCommandResult> {
  return executeInTransaction(db, async (tx) => {
    const repo = createProctorAssignmentRepo(
      tx,
    ) as unknown as ProctorAssignmentRepo;
    // 1. Look up the event row by (organizationId, operationId). This first
    //    statement establishes the recovery transaction's RR snapshot.
    const existing = await repo.findEventByOperationId(ctx, operationId);
    if (existing) {
      if (
        existing.commandType === commandType &&
        payloadsEqual(existing.canonicalPayload, canonicalPayload)
      ) {
        const assignment = await repo.findById(ctx, existing.assignmentId);
        if (!assignment) throw new NotFoundError("Assignment not found");
        return { outcome: "idempotent_replayed", assignment };
      }
      throw new IdempotencyConflictError(
        `Operation ${operationId} already used for ${existing.commandType}`,
      );
    }
    // 2. Test-only snapshot-window seam (no SQL; does not move the snapshot).
    await opts?.afterOperationLookupAbsent?.();
    // 3. Resolve an episode from this transaction's MVCC snapshot: the active
    //    episode if one is visible, otherwise the most-recent episode of ANY
    //    status. The winner may have been revoked before this snapshot, and a
    //    later reassignment visible in the snapshot may also be selected — the
    //    anchor need not be the physical collision row (ADR-015 §7 A1).
    const episode =
      (await repo.findActiveByExamAndProctor(
        ctx,
        String(canonicalPayload.examId),
        String(canonicalPayload.proctorUserId),
      )) ??
      (await repo.findMostRecentEpisodeByExamAndProctor(
        ctx,
        String(canonicalPayload.examId),
        String(canonicalPayload.proctorUserId),
      ));
    if (!episode) {
      // Unreachable in valid states: the 23505 proves a colliding episode
      // existed, and episodes are append-only — never deleted.
      throw new NotFoundError("Assignment episode not found");
    }
    // 4. Insert the loser's own no_change receipt against that episode.
    await repo.appendEvent(ctx, {
      assignmentId: episode.id,
      commandType: commandType as "assign" | "revoke",
      operationId,
      canonicalPayload,
      outcome: "no_change",
      actorId: ctx.actorId,
      createdAt: now,
    });
    // 5. NO compliance audit (no state change).
    return { outcome: "no_change", assignment: episode };
  });
}

/**
 * Runs a proctor-assignment command with full ADR-015 §7 conflict recovery.
 * `commandType` and `canonicalPayload` must be byte-identical to what the
 * engine stores in the event (the route builds them with the same helpers).
 * `now` is the single authoritative command timestamp captured by the route
 * and reused unchanged across the recovery rerun (ADR-006).
 */
export async function withProctorAssignmentOperationRecovery(
  db: Database,
  ctx: RequestContext,
  operationId: string,
  commandType: "assign" | "revoke",
  canonicalPayload: Record<string, unknown>,
  now: Date,
  run: (tx: TransactionDatabase) => Promise<ExamProctorAssignmentCommandResult>,
): Promise<ExamProctorAssignmentCommandResult> {
  let primaryError: unknown;
  try {
    return await executeInTransaction(db, run);
  } catch (err: unknown) {
    primaryError = err;
  }

  // Case 1: active-unique 23505 — the concurrent assign loser forms its own
  // durable no_change receipt in a fresh transaction (ADR-015 §7).
  if (
    isConstraintViolation(
      primaryError,
      PROCTOR_ASSIGNMENT_ACTIVE_UNIQUE_CONSTRAINT,
    )
  ) {
    try {
      return await formLoserReceipt(
        db,
        ctx,
        operationId,
        commandType,
        canonicalPayload,
        now,
      );
    } catch (receiptError: unknown) {
      if (
        isConstraintViolation(
          receiptError,
          PROCTOR_ASSIGNMENT_EVENTS_OPERATION_UNIQUE_CONSTRAINT,
        )
      ) {
        // Another recoverer consumed the same operationId first. Fresh lookup
        // decides: replay / conflict / preserved error.
        const resolved = await resolveCommittedOperation(
          db,
          ctx,
          operationId,
          commandType,
          canonicalPayload,
        );
        if (resolved.kind === "replay") return resolved.result;
        throw receiptError;
      }
      throw receiptError;
    }
  }

  // Case 2: events operation-unique 23505 (append race). Re-run the SAME
  // command once in a fresh transaction; its pre-read resolves the winner.
  // A second loss is decided by a final read-only committed-operation lookup.
  if (
    isConstraintViolation(
      primaryError,
      PROCTOR_ASSIGNMENT_EVENTS_OPERATION_UNIQUE_CONSTRAINT,
    )
  ) {
    try {
      return await executeInTransaction(db, run);
    } catch (retryError: unknown) {
      const resolved = await resolveCommittedOperation(
        db,
        ctx,
        operationId,
        commandType,
        canonicalPayload,
      );
      if (resolved.kind === "replay") return resolved.result;
      throw retryError;
    }
  }

  // Case 3: serialization failure after retry exhaustion. Re-check the
  // committed operation in a fresh transaction first: if the operation
  // committed during the wait, replay or conflict wins over the error.
  if (isSerializationFailure(primaryError)) {
    const resolved = await resolveCommittedOperation(
      db,
      ctx,
      operationId,
      commandType,
      canonicalPayload,
    );
    if (resolved.kind === "replay") return resolved.result;
    throw primaryError;
  }

  // Any other error propagates unchanged (including unrelated 23505s).
  throw primaryError;
}
