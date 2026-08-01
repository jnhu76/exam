/**
 * Operator time-grant execution — the single production implementation shared
 * by the HTTP route (`routes/attempts.admin.ts`) and the deterministic
 * concurrency test (`routes/attempts/admin-time-grants.concurrency.test.ts`).
 *
 * This module is the authority for:
 *   - the `(organization_id, operation_id)` unique constraint name,
 *   - matching a thrown PostgreSQL 23505 against that exact constraint,
 *   - running one grant transaction (ledger insert + deadline update + audit,
 *     all atomic), and
 *   - the cross-Attempt operationId-race recovery wrapper.
 *
 * Both callers go through {@link grantWithOperationRaceRecovery}. The route
 * passes `{ audit: { request } }` so the compliance audit is recorded; the
 * deterministic test passes `{ observer, label }` so its barrier can gate the
 * two transactions and observe the real in-transaction evidence (PID, txid,
 * and the SQLSTATE/constraint extracted from the *caught* error). No caller
 * reimplements any of this.
 *
 * Architecture direction mirrors `submitAndGradeAttempt.ts`: routes import
 * from `orchestrators/`, never the reverse.
 */

import { sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { RequestContext } from "@exam/domain";
import type { IncidentActionType } from "@exam/domain";
import type { Database, TransactionDatabase } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { createAttemptTimeAdjustmentRepo } from "@exam/db/src/repository/attemptTimeAdjustmentRepo.js";
import { createIncidentRepo } from "@exam/db/src/repository/incidentRepo.js";
import { linkIncidentAction } from "@exam/exam-engine";
import { grantAttemptTime, lockEnrollmentAndAttempt } from "@exam/exam-engine";
import type {
  GrantAttemptTimeInput,
  GrantAttemptTimeResult,
} from "@exam/exam-engine";
import type { TimeAdjustmentRepository } from "@exam/exam-engine";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createIncidentGrantValidatorAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
  createTimeAdjustmentRepoAdapter,
} from "../adapters/repoAdapters.js";
import { recordAtomicHttpAudit } from "../audit/auditWriter.js";

/**
 * The `(organization_id, operation_id)` unique index on the operator time
 * adjustment ledger. Two concurrent grants that carry the same `operationId`
 * but target *different* Attempts (and therefore do not share the EA / Exam
 * row locks) race only on this index. The loser's insert hits 23505; this
 * constant names the exact constraint so recovery can be scoped to it and not
 * swallow unrelated unique violations (duplicate username, etc.).
 */
export const OPERATION_UNIQUE_CONSTRAINT =
  "attempt_time_adjustments_org_operation_unique";

/**
 * A 23505 unique-violation matched against {@link OPERATION_UNIQUE_CONSTRAINT}.
 * The fields are extracted from the real thrown PostgreSQL error (NOT
 * re-hard-coded by the caller), so the deterministic test asserts the actual
 * runtime values rather than its own constants.
 */
export interface MatchedConstraintViolation {
  /** SQLSTATE — always "23505" for a PostgreSQL unique violation. */
  code: "23505";
  /** Exact constraint name from the PostgreSQL error fields. */
  constraint: string;
  /** Optional table name surfaced by the driver (postgres-js). */
  table?: string;
  /** Optional schema name surfaced by the driver. */
  schema?: string;
}

/**
 * Walks the error cause chain looking for a PostgreSQL `unique_violation`
 * (23505) whose `constraint` is exactly the operator-grant operation unique
 * index, and returns its real fields. Postgres-js surfaces the underlying
 * error fields at the top of the thrown object (`.code`, `.constraint`,
 * `.table`); drizzle/retry wrappers may wrap it one or more levels, so the
 * walk mirrors `plugins/errors.ts`'s `isConstraintError`. Returns `null` for
 * any other 23505 (stays generic RESOURCE_CONFLICT) or any non-23505 error.
 */
export function matchOrgOperationUniqueViolation(
  err: unknown,
): MatchedConstraintViolation | null {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current === "object" && current !== null) {
      const e = current as Record<string, unknown>;
      if (e.code === "23505") {
        const constraint = String(e.constraint ?? e.constraint_name ?? "");
        if (constraint === OPERATION_UNIQUE_CONSTRAINT) {
          const table = e.table;
          const schema = e.schema;
          return {
            code: "23505",
            constraint,
            ...(typeof table === "string" ? { table } : {}),
            ...(typeof schema === "string" ? { schema } : {}),
          };
        }
      }
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : null;
  }
  return null;
}

/**
 * Test-only label identifying which concurrent transaction is running. The
 * route never sets it; the deterministic test sets "T1"/"T2" so its barrier
 * observer can route observations to the right deferred.
 */
export type OperatorGrantLabel = "T1" | "T2";

/** Which attempt this call is: the primary, or the at-most-once recovery. */
type GrantPhase = "primary" | "recovery";

/**
 * Per-phase observation hook. Every method is optional and receives values
 * captured **inside** the relevant `executeInTransaction` callback, so the
 * PID/txid prove transaction identity (not just connection identity).
 *
 * - {@link OperatorGrantExecutionObserver.afterOperationLookupAbsent} fires
 *   when `findByOperationId` returns null, during the PRIMARY transaction
 *   only. It is ALSO the barrier gate: a barrier-backed observer awaits its
 *   `release` deferred here, which is how the test controller fixes
 *   T1-before-T2 ordering. (It does NOT fire during recovery — recovery finds
 *   the winner's row and proceeds.)
 * - {@link OperatorGrantExecutionObserver.onUniqueViolation} fires after the
 *   primary transaction rolls back. The SQLSTATE/constraint/table are
 *   extracted from the real caught error; the pid/txid are the PRIMARY
 *   transaction's identity (captured inside its callback before the grant
 *   threw), proving which transaction hit the 23505.
 * - {@link OperatorGrantExecutionObserver.onRecoveryTransaction} fires inside
 *   the fresh recovery transaction BEFORE the engine grant runs, proving its
 *   txid differs from primary (it fires before the grant so it is not skipped
 *   when recovery throws `IdempotencyConflictError`).
 * - {@link OperatorGrantExecutionObserver.onPrimaryCommitted} fires AFTER the
 *   primary transaction has committed (after `executeInTransaction` resolves,
 *   NOT inside its callback), for causal-ordering assertions. Firing it
 *   post-commit — outside the callback — is what makes it a true commit
 *   observation rather than a "ready to commit" signal.
 */
export interface OperatorGrantExecutionObserver {
  afterOperationLookupAbsent?(observation: {
    label: OperatorGrantLabel;
    pid: number;
    txid: string;
    operationId: string;
    attemptId: string;
  }): Promise<void>;
  onUniqueViolation?(observation: {
    label: OperatorGrantLabel;
    code: "23505";
    constraint: string;
    table?: string;
    schema?: string;
    pid: number;
    txid: string;
  }): Promise<void>;
  onRecoveryTransaction?(observation: {
    label: OperatorGrantLabel;
    pid: number;
    txid: string;
  }): Promise<void>;
  /**
   * Fires AFTER the primary transaction has committed (post-COMMIT), never
   * inside the `executeInTransaction` callback. The COMMIT happens only once
   * the callback's returned promise settles; firing the hook OUTSIDE the
   * callback — after `executeInTransaction` resolves — is the only way to
   * truthfully label it "committed" rather than "ready to commit".
   */
  onPrimaryCommitted?(observation: {
    label: OperatorGrantLabel;
    pid: number;
    txid: string;
    outcome: string;
  }): Promise<void>;
}

/**
 * Options shared by both callers. The route supplies `audit`; the
 * deterministic test supplies `observer` + `label`. Neither is required for
 * correctness — omitting `audit` skips the compliance audit (the engine grant
 * still runs), and omitting `observer` runs the grant with no test hooks.
 */
export interface OperatorGrantExecutionOptions {
  /** When set, records the atomic `attempt.timeGrant` audit inside the txn. */
  audit?: { request: FastifyRequest };
  /** Test-only observation + barrier gate hooks. */
  observer?: OperatorGrantExecutionObserver;
  /** Test-only label ("T1"/"T2"). Ignored when no observer is set. */
  label?: OperatorGrantLabel;
}

/** Backend identity captured inside a transaction callback. */
interface BackendIdentity {
  pid: number;
  txid: string;
}

/**
 * Captures the PostgreSQL backend PID and the current transaction id from
 * **inside** an open transaction callback. `txid_current()` assigns (and
 * returns) a real transaction id only once the transaction has done a write
 * or been asked for one; calling it here guarantees a non-null id that is
 * distinct per transaction even when two transactions reuse the same backend
 * PID (the PID-distinctness check is necessary but NOT sufficient — a pooled
 * connection can serve many sequential transactions under one PID).
 */
async function captureBackendIdentity(
  tx: TransactionDatabase,
): Promise<BackendIdentity> {
  const rows = (await tx.execute(
    sql`SELECT pg_backend_pid() AS pid, txid_current()::text AS txid`,
  )) as unknown as Array<{ pid: number; txid: string }>;
  const pid = Number(rows[0]?.pid ?? 0);
  const txid = String(rows[0]?.txid ?? "");
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid backend PID: ${pid}`);
  }
  if (!txid) {
    throw new Error("txid_current() returned an empty transaction id");
  }
  return { pid, txid };
}

/**
 * Outcome of {@link runGrantTransaction}. When the grant threw, `error` holds
 * the original throw and `identity` holds the PRIMARY transaction's identity
 * (captured before the grant ran), so the recovery wrapper can report which
 * transaction failed.
 */
interface GrantTransactionOutcome {
  result?: GrantAttemptTimeResult;
  error?: unknown;
  identity: BackendIdentity;
}

/**
 * Runs one grant transaction (primary or recovery) with the engine, ledger,
 * deadline update, and audit all atomic. Observer hooks fire inside the
 * callback:
 *   - primary: `afterOperationLookupAbsent` gate on the adjustment repo;
 *   - recovery: `onRecoveryTransaction` immediately after identity capture
 *     (before the grant, so it is not skipped when recovery throws).
 *
 * `onPrimaryCommitted` is intentionally NOT fired inside the callback: the
 * COMMIT happens only after the callback's returned promise settles, so a
 * callback-local observation would be "ready to commit", not "committed". The
 * hook is fired below, AFTER `executeInTransaction` resolves (post-COMMIT).
 *
 * Returns the grant result AND the captured identity, even when the callback
 * threw (so the recovery wrapper can correlate the failure to the primary
 * transaction). The thrown error is returned in `outcome.error`, not
 * re-thrown, so the identity is never lost across the catch boundary.
 */
async function runGrantTransaction(
  db: Database,
  ctx: RequestContext,
  input: GrantAttemptTimeInput,
  options: OperatorGrantExecutionOptions,
  phase: GrantPhase,
): Promise<GrantTransactionOutcome> {
  const observer = options.observer;
  const label = options.label ?? "T1";
  let identity: BackendIdentity = { pid: 0, txid: "" };
  // Outcome captured in-callback so onPrimaryCommitted can be fired POST-COMMIT
  // (after executeInTransaction resolves). Kept in the outer scope so the
  // post-commit hook has the value without re-reading it from `result`.
  let primaryOutcome: string | undefined;
  try {
    const result = await executeInTransaction(db, async (tx) => {
      identity = await captureBackendIdentity(tx);
      if (phase === "recovery") {
        // Report recovery identity before the grant runs — recovery may throw
        // IdempotencyConflictError, which would skip any post-grant hook.
        await observer?.onRecoveryTransaction?.({
          label,
          pid: identity.pid,
          txid: identity.txid,
        });
      }

      const txAttemptRepo = createAttemptRepo(tx);
      const txEnrollmentRepo = createEnrollmentRepo(tx);
      const { exams, enrollments, attempts } = createExamEngineRepos(
        {
          examRepo: createExamRepo(tx),
          attemptRepo: txAttemptRepo,
          enrollmentRepo: txEnrollmentRepo,
        },
        ctx,
      );
      const cap = await lockEnrollmentAndAttempt(
        enrollments,
        attempts,
        input.attemptId,
      );
      const episodeRepo = createInterruptionEpisodeRepoAdapter(
        createAttemptInterruptionRepo(tx),
        ctx,
      );
      const eventRepo = createInterruptionEventRepoAdapter(
        createAttemptInterruptionEventRepo(tx),
        ctx,
      );
      const rawAdjustmentRepo = createTimeAdjustmentRepoAdapter(
        createAttemptTimeAdjustmentRepo(tx),
        ctx,
      );
      // Primary-only read-absent gate. Recovery does NOT gate: it finds the
      // winner's committed row and proceeds normally.
      const adjustmentRepo =
        phase === "primary" && observer?.afterOperationLookupAbsent
          ? wrapAdjustmentRepoForObserver(
              rawAdjustmentRepo,
              observer,
              label,
              input.operationId,
              input.attemptId,
              identity,
            )
          : rawAdjustmentRepo;
      const gradingWorksetRepo = createGradingWorksetRepoAdapter(
        createAttemptGradingEntryRepo(tx),
        ctx,
      );
      // Build the Incident grant validator when an incidentId is present.
      // The grant command validates the Incident scope quadruple (ADR-014 §10)
      // BEFORE deadline reconciliation, so an expired attempt + invalid
      // incidentId cannot terminalize and skip validation.
      const incidentRepo = input.incidentId ? createIncidentRepo(tx) : null;
      const incidentGrantValidator = incidentRepo
        ? createIncidentGrantValidatorAdapter(incidentRepo, ctx)
        : null;

      const grantResult = await grantAttemptTime(
        exams,
        attempts,
        enrollments,
        episodeRepo,
        eventRepo,
        adjustmentRepo,
        gradingWorksetRepo,
        incidentGrantValidator,
        cap,
        input,
      );

      // If incidentId is present, link the action to the incident inside the
      // same transaction (combined grant+link path). The Incident's existence
      // and scope quadruple were already validated inside grantAttemptTime
      // (step 5b) BEFORE reconciliation; here we only insert the action link
      // (which appends its own event + audit) on a real grant or replay.
      if (
        input.incidentId &&
        incidentRepo &&
        grantResult.adjustment &&
        (grantResult.outcome === "granted" ||
          grantResult.outcome === "idempotent_replay")
      ) {
        // For time_grant, actionId = adjustment.id
        const actionId = grantResult.adjustment.id;

        // Link the action (this will also append the event and audit)
        await linkIncidentAction(
          incidentRepo as never,
          ctx,
          input.incidentId,
          {
            operationId: input.operationId,
            actionType: "time_grant",
            actionId,
          },
          {
            now: input.now,
            audit: async (action, metadata) => {
              if (options.audit) {
                await recordAtomicHttpAudit(tx, options.audit.request, ctx, {
                  action: action as never,
                  targetType: "incident",
                  targetId: input.incidentId!,
                  metadata,
                });
              }
            },
            lookupAdjustmentAttempt: async () => input.attemptId,
            lookupForceSubmitAudit: async () => false,
            lookupAttempt: async (aid) => {
              const attempt = await createAttemptRepo(tx).findById(ctx, aid);
              return attempt
                ? {
                    examId: attempt.examId,
                    candidateId: attempt.candidateId,
                    organizationId: attempt.organizationId,
                  }
                : null;
            },
            lookupActionLink: async (actionType, actionId) => {
              const existing = await incidentRepo.findActionLinkByAction(
                ctx,
                actionType as IncidentActionType,
                actionId,
              );
              return existing != null;
            },
          },
        );
      }
      // Compliance audit (atomic with the ledger insert + deadline update).
      // Recorded only on a real grant; idempotent replay returns the
      // already-committed result without a duplicate audit row. Project the
      // committed adjustment fields (not the request payload) so the audit
      // and ledger never diverge.
      if (
        grantResult.outcome === "granted" &&
        grantResult.adjustment &&
        options.audit
      ) {
        await recordAtomicHttpAudit(tx, options.audit.request, ctx, {
          action: "attempt.timeGrant",
          targetType: "attempt",
          targetId: input.attemptId,
          metadata: {
            adjustmentId: grantResult.adjustment.id,
            operationId: grantResult.adjustment.operationId,
            addedSeconds: grantResult.adjustment.addedSeconds,
            reasonCode: grantResult.adjustment.reasonCode,
            interruptionId: grantResult.adjustment.interruptionId,
          },
        });
      }
      if (phase === "primary") {
        // Stash the outcome so onPrimaryCommitted can fire POST-COMMIT below.
        // Do NOT fire the hook here: the COMMIT has not happened yet — it only
        // happens once this callback's promise settles.
        primaryOutcome = grantResult.outcome;
      }
      return grantResult;
    });
    // `executeInTransaction` has now resolved, which means the COMMIT has been
    // issued and settled (see executeInTransaction: it `await`s db.transaction,
    // and Drizzle COMMITs only after the callback promise settles). Only at
    // this point is "committed" a truthful label for a primary-phase grant.
    if (phase === "primary" && primaryOutcome !== undefined) {
      await observer?.onPrimaryCommitted?.({
        label,
        pid: identity.pid,
        txid: identity.txid,
        outcome: primaryOutcome,
      });
    }
    return { result, identity };
  } catch (error) {
    return { error, identity };
  }
}

/**
 * Wraps a `TimeAdjustmentRepository` so the observer's read-absent gate fires
 * when `findByOperationId` returns null for the target operation. Test-only
 * composition: it does not change the lookup result, only emits an observation
 * and awaits the observer's gate (which the test controller resolves to fix
 * ordering). The PID/txid are captured inside the transaction callback and
 * passed in, so the observation proves transaction identity.
 */
function wrapAdjustmentRepoForObserver(
  inner: TimeAdjustmentRepository,
  observer: OperatorGrantExecutionObserver,
  label: OperatorGrantLabel,
  operationId: string,
  attemptId: string,
  identity: BackendIdentity,
): TimeAdjustmentRepository {
  const hook = observer.afterOperationLookupAbsent;
  if (!hook) return inner;
  return {
    ...inner,
    findByOperationId: async (opId: string) => {
      const result = await inner.findByOperationId(opId);
      if (opId === operationId && result === null) {
        await hook({
          label,
          pid: identity.pid,
          txid: identity.txid,
          operationId: opId,
          attemptId,
        });
      }
      return result;
    },
  };
}

/**
 * Operator time grant with cross-Attempt operationId-race recovery
 * (ADR-013 §9). This is the single entry point used by both the HTTP route
 * and the deterministic concurrency test.
 *
 * Background: `operationId` is command identity scoped to the organization.
 * Two concurrent grants carrying the same `operationId` but targeting
 * *different* Attempts do NOT share the EA (Enrollment→Attempt) lock or the
 * Exam `FOR UPDATE` lock, so nothing in the grant transaction serializes them.
 * The only mutex is the `(organization_id, operation_id)` unique index. The
 * loser's ledger insert fails with 23505, rolling its transaction back.
 *
 * Recovery: when the failure is exactly that constraint's 23505, re-run the
 * SAME command (identical input, identical `now`) in a FRESH transaction. The
 * new transaction's idempotency check now sees the winner's committed row, so
 * it deterministically returns one of:
 *   - `idempotent_replay` (same Attempt + same payload) — the loser targeted
 *     the same Attempt as the winner and is a legitimate retry; or
 *   - `IdempotencyConflictError` (different Attempt / payload) — the loser
 *     raced a genuinely different command on the same identity, which maps to
 *     `409 IDEMPOTENCY_CONFLICT` (NOT a generic RESOURCE_CONFLICT).
 *
 * This wrapper recovers AT MOST ONCE (never recursion) and rethrows every
 * other error unchanged. The original `now` is threaded through both attempts
 * so the recovered command is byte-identical.
 *
 * Observer semantics: `onUniqueViolation` fires with the SQLSTATE/constraint
 * extracted from the real caught error AND the primary transaction's identity
 * (captured before the grant threw), after the primary rollback; then
 * `onRecoveryTransaction` fires inside the fresh recovery transaction before
 * the grant runs.
 */
export async function grantWithOperationRaceRecovery(
  db: Database,
  ctx: RequestContext,
  input: GrantAttemptTimeInput,
  options: OperatorGrantExecutionOptions = {},
): Promise<GrantAttemptTimeResult> {
  const primary = await runGrantTransaction(db, ctx, input, options, "primary");
  if (primary.result) return primary.result;

  const matched = matchOrgOperationUniqueViolation(primary.error);
  if (!matched) {
    throw primary.error;
  }

  // The original transaction was rolled back by the 23505. Observe the real
  // violation fields (extracted from the caught error) together with the
  // PRIMARY transaction's identity (captured inside its callback before the
  // grant threw), then re-run the SAME command in a fresh transaction exactly
  // once; the engine's idempotency check now resolves the winner's committed
  // row (replay or conflict).
  const observer = options.observer;
  const label = options.label ?? "T2";
  if (observer?.onUniqueViolation) {
    await observer.onUniqueViolation({
      label,
      code: matched.code,
      constraint: matched.constraint,
      ...(matched.table ? { table: matched.table } : {}),
      ...(matched.schema ? { schema: matched.schema } : {}),
      pid: primary.identity.pid,
      txid: primary.identity.txid,
    });
  }

  const recovery = await runGrantTransaction(
    db,
    ctx,
    input,
    options,
    "recovery",
  );
  if (recovery.result) return recovery.result;
  throw recovery.error;
}
