/**
 * Incident operation recovery — ADR-014 §9 fresh-transaction conflict recovery.
 *
 * The engine command functions run inside `executeInTransaction` at the
 * default REPEATABLE READ isolation. Under that isolation a version-bumping
 * command (investigate / severity / resolve / dismiss) can lose the race for
 * the `operationId` even when it is a legitimate retry:
 *
 *   T1 commits event + version bump.
 *   T2 waits on the Incident row FOR UPDATE.
 *   T2 wakes and sees the new aggregate version, but its ordinary SELECT on
 *     the event table still uses the stale RR snapshot, so it misses T1's
 *     event and throws IncidentVersionConflictError / InvalidStateTransitionError
 *     BEFORE the event insert (so the operation-unique 23505 never fires).
 *
 * ADR-014 §9 requires: after such a conflict, rollback and re-check the
 * `operationId` in a FRESH transaction. If the same `operationId` committed
 * successfully during the wait with a matching command+payload, the business
 * error is superseded by `idempotent_replayed`; if it committed with a
 * different command/payload, it is `IdempotencyConflictError`; otherwise the
 * original business error is preserved.
 *
 * This wrapper also handles the operation-unique 23505 (append-only race) and
 * serialization failure (40001) after retry exhaustion with the same
 * fresh-transaction rule. It mirrors `grantWithOperationRaceRecovery` in
 * `operatorGrantExecution.ts` but covers the broader incident error set.
 *
 * Constraints (frozen):
 *   - recovery at most once (never recursion);
 *   - same original input / operationId / authoritative `now`;
 *   - never swallow an unrelated 23505 (only the named operation-unique);
 *   - never convert arbitrary errors;
 *   - no duplicate audit / event / version bump (the fresh run's pre-read
 *     resolves replay before any write).
 */

import type { RequestContext } from "@exam/domain";
import {
  AppError,
  IdempotencyConflictError,
  IncidentVersionConflictError,
  InvalidStateTransitionError,
} from "@exam/domain";
import type { Database, TransactionDatabase } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createIncidentRepo } from "@exam/db/src/repository/incidentRepo.js";
import { payloadsEqual } from "@exam/exam-engine";
import type { IncidentCommandResult } from "@exam/exam-engine";

/**
 * The `(organization_id, operation_id)` unique index on `exam_incident_events`
 * — the ADR-014 §9 idempotency arbiter for every incident write command.
 */
export const INCIDENT_OPERATION_UNIQUE_CONSTRAINT =
  "exam_incident_events_org_operation_unique";

/**
 * Walks the error cause chain for the incident event operation-unique 23505.
 * Mirrors `matchOrgOperationUniqueViolation` in operatorGrantExecution
 * (postgres-js surfaces the constraint as `constraint_name` on the cause).
 */
function isIncidentOperationUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current === "object" && current !== null) {
      const e = current as Record<string, unknown>;
      if (e.code === "23505") {
        const constraint = String(e.constraint ?? e.constraint_name ?? "");
        if (constraint === INCIDENT_OPERATION_UNIQUE_CONSTRAINT) {
          return true;
        }
      }
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : null;
  }
  return false;
}

/** A thrown error that is a recoverable incident conflict (version/state). */
function isRecoverableConflictError(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  return (
    err instanceof IncidentVersionConflictError ||
    err instanceof InvalidStateTransitionError
  );
}

/**
 * Returns true when the error is a PostgreSQL serialization failure that has
 * already exhausted `executeInTransaction`'s internal retries (i.e. it was
 * rethrown by the retry loop, not a transient first attempt).
 */
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
 * Resolves the committed operation for `operationId` in a FRESH transaction
 * (a new REPEATABLE READ snapshot taken AFTER the primary rolled back, so it
 * sees any commit that landed during the wait). Returns:
 *   - `{ kind: "replay", result }` when a matching committed operation exists;
 *   - throws `IdempotencyConflictError` when the operation committed with a
 *     different command/payload;
 *   - `{ kind: "absent" }` when no committed operation exists (the caller
 *     preserves the original business error).
 *
 * The `canonicalPayload` / `commandType` are the SAME values the primary
 * transaction used, so the comparison is byte-identical to the engine's
 * idempotency check.
 */
async function resolveCommittedOperation(
  db: Database,
  ctx: RequestContext,
  operationId: string,
  commandType: string,
  canonicalPayload: unknown,
): Promise<
  { kind: "replay"; result: IncidentCommandResult } | { kind: "absent" }
> {
  return executeInTransaction(db, async (tx) => {
    // Cast to the engine-facing IncidentRepo interface (the DB repo returns
    // ExamIncidentRow; the engine interface projects it as ExamIncident).
    // This mirrors the route's `repo as unknown as IncidentRepo` usage.
    const repo = createIncidentRepo(tx) as unknown as {
      findEventByOperationId: (
        ctx: RequestContext,
        operationId: string,
      ) => Promise<{
        incidentId: string;
        commandType: string;
        payload: Record<string, unknown>;
      } | null>;
      findById: (
        ctx: RequestContext,
        incidentId: string,
      ) => Promise<IncidentCommandResult["incident"] | null>;
    };
    const existing = await repo.findEventByOperationId(ctx, operationId);
    if (!existing) return { kind: "absent" };
    if (
      existing.commandType === commandType &&
      payloadsEqual(
        existing.payload,
        canonicalPayload as Record<string, unknown>,
      )
    ) {
      const incident = await repo.findById(ctx, existing.incidentId);
      if (!incident) {
        // The committed event's incident vanished — extremely unlikely, but
        // surface it rather than synthesizing a replay.
        throw new IdempotencyConflictError(
          `Operation ${operationId} committed but its incident is missing`,
        );
      }
      return {
        kind: "replay",
        result: { outcome: "idempotent_replayed", incident },
      };
    }
    throw new IdempotencyConflictError(
      `Operation ${operationId} already used for ${existing.commandType}`,
    );
  });
}

/**
 * Runs an incident command with full ADR-014 §9 conflict recovery.
 *
 * `run` executes the engine command inside a primary transaction. Recovery is
 * BRANCH-SPECIFIC, not uniform:
 *
 * Case 1 — named operation-unique 23505 (append-only race):
 *   the primary rolls back and the SAME command is re-run ONCE in a fresh
 *   transaction. The fresh run's own pre-read resolves replay/conflict exactly
 *   as the engine does, so this wrapper does NOT duplicate idempotency logic.
 *   The fresh re-run can itself lose a second race; if so, a final read-only
 *   committed-operation lookup decides: matching committed op →
 *   `idempotent_replayed`; committed with a different payload →
 *   `IdempotencyConflictError`; otherwise the retry error is preserved. The
 *   command is never executed more than twice (no recursion).
 *
 * Case 2 — recoverable version/state conflict (IncidentVersionConflictError /
 *   InvalidStateTransitionError) or serialization failure (40001) after retry
 *   exhaustion:
 *   the command is NOT re-run. Instead a single fresh-transaction read-only
 *   lookup checks whether the operation committed during the wait: matching
 *   committed op → `idempotent_replayed`; different payload →
 *   `IdempotencyConflictError`; absent → the original business error is
 *   preserved (a genuine lost-update / invalid transition, not a masked retry).
 *
 * Any other error propagates unchanged (see the trailing fall-through).
 */
export async function withIncidentOperationRecovery(
  db: Database,
  ctx: RequestContext,
  operationId: string,
  commandType: string,
  canonicalPayload: unknown,
  run: (tx: TransactionDatabase) => Promise<IncidentCommandResult>,
): Promise<IncidentCommandResult> {
  let primaryError: unknown;
  try {
    return await executeInTransaction(db, run);
  } catch (err: unknown) {
    primaryError = err;
  }

  // Case 1: named operation-unique 23505 (append-only race). Re-run the SAME
  // command once in a fresh transaction; its pre-read resolves the winner.
  // The fresh re-run can itself lose a second race, so its error is caught and
  // a final read-only committed-operation lookup decides: matching committed
  // op → idempotent_replayed; committed with a different payload →
  // IdempotencyConflictError; otherwise the retry error is preserved. The
  // command is never executed more than twice (no recursion, no infinite
  // retry).
  if (isIncidentOperationUniqueViolation(primaryError)) {
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
      if (resolved.kind === "replay") {
        return resolved.result;
      }
      throw retryError;
    }
  }

  // Case 2: recoverable version/state conflict, or serialization failure
  // after retry exhaustion. Re-check the committed operation in a fresh
  // transaction first: if the operation committed during the wait, replay or
  // conflict wins over the business error.
  const recoverable =
    isRecoverableConflictError(primaryError) ||
    isSerializationFailure(primaryError);
  if (recoverable) {
    const resolved = await resolveCommittedOperation(
      db,
      ctx,
      operationId,
      commandType,
      canonicalPayload,
    );
    if (resolved.kind === "replay") return resolved.result;
    // No matching committed operation: the conflict is a genuine lost-update
    // / invalid transition, not a masked retry. Preserve the original error.
    throw primaryError;
  }

  // Any other error propagates unchanged.
  throw primaryError;
}
