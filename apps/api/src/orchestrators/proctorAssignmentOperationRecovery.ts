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
 *   transaction, then in a FRESH transaction: (a) look up the event row by
 *   (organizationId, operationId) → replay or IDEMPOTENCY_CONFLICT; (b)
 *   otherwise read the committed active assignment; (c) insert the loser's
 *   own no_change event referencing that episode; (d) commit and return
 *   `no_change` + the active episode. NO compliance audit (no state change).
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
 * ADR-015 §7 loser-receipt recovery: in a fresh transaction, form the losing
 * assign's own durable `no_change` receipt referencing the committed active
 * episode. The event insert may itself race another recoverer with the same
 * operationId → events operation-unique 23505 → rollback → fresh lookup →
 * replay/conflict (the same rule as Case 2).
 */
async function formLoserReceipt(
  db: Database,
  ctx: RequestContext,
  operationId: string,
  commandType: string,
  canonicalPayload: Record<string, unknown>,
  now: Date,
): Promise<ExamProctorAssignmentCommandResult> {
  return executeInTransaction(db, async (tx) => {
    const repo = createProctorAssignmentRepo(
      tx,
    ) as unknown as ProctorAssignmentRepo;
    // 1. Look up the event row by (organizationId, operationId).
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
    // 2. Read the now-committed active assignment.
    const active = await repo.findActiveByExamAndProctor(
      ctx,
      String(canonicalPayload.examId),
      String(canonicalPayload.proctorUserId),
    );
    if (!active) {
      // The winner committed but revoked before our fresh read — surface
      // rather than synthesizing a receipt against a missing episode.
      throw new NotFoundError("Active assignment not found");
    }
    // 3. Insert the loser's own no_change receipt.
    await repo.appendEvent(ctx, {
      assignmentId: active.id,
      commandType: commandType as "assign" | "revoke",
      operationId,
      canonicalPayload,
      outcome: "no_change",
      actorId: ctx.actorId,
      createdAt: now,
    });
    // 4. NO compliance audit (no state change).
    return { outcome: "no_change", assignment: active };
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
