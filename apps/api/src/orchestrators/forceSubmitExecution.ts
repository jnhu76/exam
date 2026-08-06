/**
 * Force-submit durable operation execution — the single production
 * implementation shared by the HTTP route (`routes/attempts.admin.ts`) and
 * the deterministic concurrency tests
 * (`routes/attempts/admin-force-submit.concurrency.test.ts`).
 *
 * This module is the authority for:
 *   - the `attempt_command_receipts` `(organization_id, operation_id)`
 *     unique-constraint race recovery (J5-I1C0 audit §5.1, §14),
 *   - planning the force-submit outcome UNDER the EA lock and freezing it
 *     into the receipt's immutable `result_payload` BEFORE the mutation
 *     (receipt-first, audit §5.1 step 7),
 *   - running one atomic transaction (receipt insert + submit/grade +
 *     verification + audit), and
 *   - returning the STORED immutable fact on replay — never a rebuilt
 *     projection of the live attempt.
 *
 * Transaction order (frozen, audit §5.1 / J5-I1C0 §9):
 *   pre-read replay/conflict (non-locking, outside any transaction)
 *   → BEGIN (REPEATABLE READ — `executeInTransaction` default)
 *   → EA lock (Enrollment → Attempt, unchanged, ADR-013 §9)
 *   → re-read locked attempt; reject `voided`/`not_started`/`queued`
 *     (409 INVALID_STATE_TRANSITION, 0 receipt / 0 audit / 0 mutation)
 *   → plan the outcome + expected `result_payload`
 *   → INSERT the receipt row (FIRST business write)
 *   → execute the existing `submitAttempt` + `gradeAttemptIdempotent`
 *     engine calls unchanged (interruption terminalization for `disrupted`,
 *     reasonCode `admin_force_submit_terminalization`)
 *   → re-read the final attempt; verify the committed fact equals the stored
 *     `result_payload` (fail closed on mismatch — rollback, never UPDATE)
 *   → write the `attempt.forceSubmit` audit ONLY on a real transition
 *   → COMMIT
 *   on the exact 23505 of `attempt_command_receipts_org_operation_unique`:
 *   → rollback → fresh transaction → re-read + validate + classify the
 *     winner receipt → idempotent_replay or 409 IDEMPOTENCY_CONFLICT.
 *     At-most-once recovery, never recursive.
 *
 * The route passes `{ audit: { request } }`; the deterministic tests pass
 * `{ observer, label }` so barriers gate the transactions and observe the
 * real in-transaction evidence (PID, txid, and the SQLSTATE/constraint
 * extracted from the *caught* error). No caller reimplements any of this.
 */

import { sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { ExamAttempt, AttemptStatus, RequestContext } from "@exam/domain";
import {
  AppError,
  IdempotencyConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  canonicalizeForceSubmitPayload,
  requiresManualGrading,
} from "@exam/domain";
import type {
  ForceSubmitRequestPayload,
  ForceSubmitResultPayload,
} from "@exam/domain";
import type { Database, TransactionDatabase } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { createAttemptCommandReceiptRepo } from "@exam/db/src/repository/attemptCommandReceiptRepo.js";
import type { AttemptCommandReceiptRow } from "@exam/db/src/repository/attemptCommandReceiptRepo.js";
import {
  gradeAttemptIdempotent,
  lockEnrollmentAndAttempt,
  submitAttempt,
} from "@exam/exam-engine";
import type { SubmitInterruptionResolution } from "@exam/exam-engine";
import type { AttemptCommandReceiptResponse } from "@exam/contracts";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../adapters/repoAdapters.js";
import { recordAtomicHttpAudit } from "../audit/auditWriter.js";
import {
  matchAttemptCommandReceiptOperationUniqueViolation,
  parseAndClassifyStoredReceipt,
  receiptRowToRecord,
  receiptRowToWireResponse,
} from "./attemptCommandReceiptExecution.js";

/**
 * Input of {@link forceSubmitWithOperationRaceRecovery}. `reason` has already
 * passed the wire schema (required, trimmed, 1..500 — J5-R0 §8.1) when the
 * orchestrator is called; the orchestrator still re-canonicalizes it so the
 * durable request identity comes from the single domain canonicalizer, not a
 * third hand-written trim in the route/orchestrator/repo layers.
 *
 * The receipt actor is NOT part of the command input — it always comes from
 * `ctx.actorId`, the single server-context authority. Letting callers pass an
 * independent `actorId` would allow receipt.actorId and audit.actorId to
 * diverge while still satisfying the composite `(organization_id, actor_id)`
 * FK, which is a contract hole the type system must close (review P2-2).
 */
export interface ForceSubmitOperationInput {
  attemptId: string;
  operationId: string;
  reason: string;
  /** One authoritative server timestamp threaded through receipt + submit + grade + audit. */
  now: Date;
}

/** Test-only label identifying which concurrent transaction is running. */
export type ForceSubmitExecutionLabel = "T1" | "T2";

/**
 * Test-only observation + fault-injection hooks. Every method is optional and
 * defaults to no behavior; the production route sets no observer. Hooks that
 * carry `pid`/`txid` fire with values captured INSIDE the relevant
 * `executeInTransaction` callback, so the identity proves transaction
 * identity (not just connection identity).
 *
 * - {@link ForceSubmitExecutionObserver.afterOperationLookupAbsent} fires
 *   when the pre-read `findByOperationId` returns null. It is the barrier
 *   gate that fixes T1-before-T2 ordering. It fires OUTSIDE any transaction
 *   (the audit's pre-read precedes BEGIN), so it carries no pid/txid.
 * - {@link ForceSubmitExecutionObserver.beforeReceiptInsert} fires under the
 *   EA lock, AFTER the outcome plan is fixed and BEFORE the receipt insert —
 *   the primary in-transaction ordering gate.
 * - {@link ForceSubmitExecutionObserver.afterReceiptInsert} /
 *   {@link ForceSubmitExecutionObserver.beforeAuditWrite} /
 *   {@link ForceSubmitExecutionObserver.afterAuditWrite} are fault-injection
 *   points for the failure-atomicity tests: a test observer throws to prove
 *   the whole transaction (receipt + mutation + audit) rolls back. Default
 *   no behavior.
 * - {@link ForceSubmitExecutionObserver.onUniqueViolation} fires after the
 *   primary transaction rolled back on the exact 23505. The SQLSTATE/
 *   constraint/table are extracted from the real caught error; pid/txid are
 *   the PRIMARY transaction's identity (captured inside its callback).
 * - {@link ForceSubmitExecutionObserver.onRecoveryTransaction} fires inside
 *   the fresh recovery transaction BEFORE the winner lookup, proving its
 *   txid differs from primary.
 * - {@link ForceSubmitExecutionObserver.onPrimaryCommitted} fires AFTER the
 *   primary transaction has committed (after `executeInTransaction`
 *   resolves), for causal-ordering assertions.
 */
export interface ForceSubmitExecutionObserver {
  afterOperationLookupAbsent?(observation: {
    label: ForceSubmitExecutionLabel;
    operationId: string;
    attemptId: string;
  }): Promise<void>;
  beforeReceiptInsert?(observation: {
    label: ForceSubmitExecutionLabel;
    pid: number;
    txid: string;
    operationId: string;
    attemptId: string;
    beforeStatus: AttemptStatus;
    plannedOutcome: "applied" | "no_change";
  }): Promise<void>;
  afterReceiptInsert?(observation: {
    label: ForceSubmitExecutionLabel;
    pid: number;
    txid: string;
    operationId: string;
    attemptId: string;
    /**
     * Test-only fault-injection handle: the live transaction, exposed so a
     * fault test can mutate the locked row and prove the postcondition
     * verification (and the whole transaction) fails closed. Production
     * callers never set an observer.
     */
    tx: TransactionDatabase;
  }): Promise<void>;
  beforeAuditWrite?(observation: {
    label: ForceSubmitExecutionLabel;
    pid: number;
    txid: string;
    operationId: string;
    attemptId: string;
  }): Promise<void>;
  afterAuditWrite?(observation: {
    label: ForceSubmitExecutionLabel;
    pid: number;
    txid: string;
    operationId: string;
    attemptId: string;
  }): Promise<void>;
  onUniqueViolation?(observation: {
    label: ForceSubmitExecutionLabel;
    code: "23505";
    constraint: string;
    table?: string;
    schema?: string;
    pid: number;
    txid: string;
  }): Promise<void>;
  onRecoveryTransaction?(observation: {
    label: ForceSubmitExecutionLabel;
    pid: number;
    txid: string;
  }): Promise<void>;
  onPrimaryCommitted?(observation: {
    label: ForceSubmitExecutionLabel;
    pid: number;
    txid: string;
    disposition: "applied" | "no_change" | "idempotent_replay";
  }): Promise<void>;
}

/**
 * Internal options shared by the production entry and the test-only adapter.
 * `audit` is optional HERE ONLY so the test-only adapter can omit it; the
 * production entry ({@link forceSubmitWithOperationRaceRecovery}) takes a
 * separate options type that makes `audit` REQUIRED, so an "applied
 * force-submit with no compliance audit" is unrepresentable in production
 * code (review P2-3). Replay / `no_change` / conflict paths never write an
 * audit regardless.
 */
export interface ForceSubmitExecutionInternalOptions {
  /** When set, records the atomic `attempt.forceSubmit` audit inside the txn. */
  audit?: { request: FastifyRequest };
  /** Test-only observation + barrier gate hooks. */
  observer?: ForceSubmitExecutionObserver;
  /** Test-only label ("T1"/"T2"). Ignored when no observer is set. */
  label?: ForceSubmitExecutionLabel;
}

/**
 * Production options for {@link forceSubmitWithOperationRaceRecovery}. `audit`
 * is REQUIRED — every applied force-submit transition must record the
 * `attempt.forceSubmit` compliance audit atomically with the receipt + mutation.
 * Test hooks (`observer`/`label`) are deliberately NOT accepted here so they
 * cannot leak into the production call boundary.
 */
export interface ForceSubmitExecutionOptions {
  /** Records the atomic `attempt.forceSubmit` audit inside the txn (required). */
  audit: { request: FastifyRequest };
}

/**
 * Test-only options for {@link forceSubmitWithOperationRaceRecoveryTestOnly}.
 * Accepts `observer`/`label` (deterministic race barrier gates) and an optional
 * `audit` so a test that needs to assert audit ABSENCE on the no-audit path can
 * omit it by name. Never import this from production code — the name is the
 * contract that the audit-mandatory invariant only relaxes inside tests.
 */
export interface ForceSubmitExecutionTestOptions {
  /** Test-only observation + barrier gate hooks. */
  observer?: ForceSubmitExecutionObserver;
  /** Test-only label ("T1"/"T2"). Ignored when no observer is set. */
  label?: ForceSubmitExecutionLabel;
  /** When set, records the atomic audit; omit to assert audit absence. */
  audit?: { request: FastifyRequest };
}

/** Backend identity captured inside a transaction callback. */
interface BackendIdentity {
  pid: number;
  txid: string;
}

/**
 * Captures the PostgreSQL backend PID and the current transaction id from
 * **inside** an open transaction callback (mirrors
 * `operatorGrantExecution.captureBackendIdentity`). `txid_current()` assigns
 * (and returns) a real transaction id only once the transaction has done a
 * write or been asked for one; calling it here guarantees a non-null id that
 * is distinct per transaction even when two transactions reuse the same
 * backend PID.
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
 * The planned force-submit outcome, frozen into the receipt's
 * `result_payload` BEFORE the mutation runs (audit §5.1 step 7, §11).
 */
export interface ForceSubmitExecutionPlan {
  beforeStatus: AttemptStatus;
  afterStatus: AttemptStatus;
  /** Persistent outcome — `applied` on a real transition, else `no_change`. */
  outcome: "applied" | "no_change";
  needsSubmit: boolean;
  needsGrade: boolean;
  needsAudit: boolean;
  submittedAt: string | null;
  gradedAt: string | null;
  resultPayload: ForceSubmitResultPayload;
}

/**
 * Plans the force-submit outcome from the locked attempt + the canonical
 * server `now`, using the REAL engine transition rules
 * (`submitAttempt` + `gradeAttemptIdempotent`). Pure and exhaustive — a new
 * `AttemptStatus` value fails TypeScript compilation here instead of falling
 * into an accidental default.
 *
 * Engine authority per status:
 * - `in_progress`/`disrupted`: submit → `submitted` (submittedAt=now,
 *   gradingStatus from `requiresManualGrading`), then grade → `graded`
 *   (gradedAt=now) when auto-gradable; a pending-manual workset stays
 *   `submitted` (gradeAttemptIdempotent returns a partial result without a
 *   transition). outcome=applied, audit written.
 * - `submitted`: NO new submit transition (crash-recovery row) — only
 *   grading completes. outcome=no_change, no audit. `submittedAt` is the
 *   row's existing value; `gradedAt` is `now` (auto) or stays null
 *   (pending_manual).
 * - `grading`: transient mid-flight state not resumable from a row read —
 *   untouched (existing route contract). outcome=no_change, no audit.
 * - `graded`: terminal no-op. outcome=no_change, no audit.
 * - `voided` / `not_started` / `queued`: invalid transition → 409, before
 *   any receipt (mirrors the engine's own `InvalidStateTransitionError`).
 */
export function planForceSubmitExecution(
  locked: ExamAttempt,
  now: Date,
): ForceSubmitExecutionPlan {
  const beforeStatus = locked.status;
  const appliedAt = now.toISOString();
  switch (beforeStatus) {
    case "in_progress":
    case "disrupted":
      return appliedPlan(beforeStatus, locked, appliedAt);
    case "submitted": {
      // gradeAttemptIdempotent transitions submitted → graded only when the
      // workset is auto-gradable; a pending_manual workset returns a partial
      // result and the status stays submitted (engine authority).
      const pendingManual = locked.gradingStatus === "pending_manual";
      const afterStatus = pendingManual ? "submitted" : "graded";
      const submittedAt = locked.submittedAt?.toISOString() ?? null;
      const gradedAt = pendingManual ? null : appliedAt;
      return {
        beforeStatus,
        afterStatus,
        outcome: "no_change",
        needsSubmit: false,
        needsGrade: true,
        needsAudit: false,
        submittedAt,
        gradedAt,
        resultPayload: {
          commandType: "force_submit",
          beforeStatus,
          afterStatus,
          submittedAt,
          gradedAt,
          appliedAt,
        },
      };
    }
    case "grading":
      return noOpPlan("grading", locked, appliedAt);
    case "graded":
      return noOpPlan("graded", locked, appliedAt);
    case "voided":
    case "not_started":
    case "queued":
      throw new InvalidStateTransitionError(
        `Cannot force-submit attempt in ${beforeStatus} state`,
      );
  }
}

/** Plan for a real force-submit transition (`in_progress`/`disrupted`). */
function appliedPlan(
  beforeStatus: "in_progress" | "disrupted",
  locked: ExamAttempt,
  appliedAt: string,
): ForceSubmitExecutionPlan {
  // The submit freeze barrier classifies manual-grading from the frozen
  // question snapshot; mirror it so the stored fact is exact.
  const pendingManual = requiresManualGrading(locked.questionSnapshot);
  const afterStatus = pendingManual ? "submitted" : "graded";
  const submittedAt = appliedAt;
  const gradedAt = pendingManual ? null : appliedAt;
  return {
    beforeStatus,
    afterStatus,
    outcome: "applied",
    needsSubmit: true,
    needsGrade: true,
    needsAudit: true,
    submittedAt,
    gradedAt,
    resultPayload: {
      commandType: "force_submit",
      beforeStatus,
      afterStatus,
      submittedAt,
      gradedAt,
      appliedAt,
    },
  };
}

/** Plan for a terminal no-op (`graded`) or untouchable (`grading`) row. */
function noOpPlan(
  afterStatus: "grading" | "graded",
  locked: ExamAttempt,
  appliedAt: string,
): ForceSubmitExecutionPlan {
  const beforeStatus = locked.status;
  const submittedAt = locked.submittedAt?.toISOString() ?? null;
  const gradedAt = locked.gradedAt?.toISOString() ?? null;
  return {
    beforeStatus,
    afterStatus,
    outcome: "no_change",
    needsSubmit: false,
    needsGrade: false,
    needsAudit: false,
    submittedAt,
    gradedAt,
    resultPayload: {
      commandType: "force_submit",
      beforeStatus,
      afterStatus,
      submittedAt,
      gradedAt,
      appliedAt,
    },
  };
}

/**
 * Postcondition (audit §5.1 step 10): the attempt fact committed by the
 * mutation must EXACTLY equal the `result_payload` frozen into the receipt
 * before it. On mismatch, fail closed — the whole transaction rolls back
 * (receipt + mutation + audit), and the receipt is NEVER updated to hide the
 * divergence.
 */
function assertCommittedFactMatchesStored(
  final: ExamAttempt,
  stored: ForceSubmitResultPayload,
): void {
  const actualAfterStatus = final.status;
  const actualSubmittedAt = final.submittedAt?.toISOString() ?? null;
  const actualGradedAt = final.gradedAt?.toISOString() ?? null;
  if (
    actualAfterStatus !== stored.afterStatus ||
    actualSubmittedAt !== stored.submittedAt ||
    actualGradedAt !== stored.gradedAt
  ) {
    throw new AppError(
      `Invariant failure: force-submit committed fact ` +
        `(status=${actualAfterStatus}, submittedAt=${actualSubmittedAt}, ` +
        `gradedAt=${actualGradedAt}) does not match the stored receipt ` +
        `result_payload (status=${stored.afterStatus}, ` +
        `submittedAt=${stored.submittedAt}, gradedAt=${stored.gradedAt}); ` +
        `transaction rolled back`,
      "INTERNAL_INVARIANT_VIOLATION",
      500,
    );
  }
}

/**
 * Classifies a stored receipt (found by the pre-read or by the 23505
 * recovery) against the incoming command and returns the wire response for a
 * replay, or throws `IdempotencyConflictError` for a conflict (audit §4.5).
 * A replay NEVER re-reads the live attempt, never re-grades, never writes an
 * audit, and never touches the stored row — the response is built from the
 * stored immutable fact.
 */
function classifyStoredReceipt(
  stored: AttemptCommandReceiptRow,
  input: ForceSubmitOperationInput,
  canonicalPayload: ForceSubmitRequestPayload,
): AttemptCommandReceiptResponse {
  const { receipt, decision } = parseAndClassifyStoredReceipt({
    row: stored,
    requestedCommandType: "force_submit",
    requestedAttemptId: input.attemptId,
    requestedCanonicalPayload: canonicalPayload,
  });
  if (decision.kind === "replay") {
    return receiptRowToWireResponse(receipt, "idempotent_replay");
  }
  throw new IdempotencyConflictError(
    `Operation ${input.operationId} is already committed: ` +
      conflictReasonMessage(decision.reason, stored.attemptId),
  );
}

function conflictReasonMessage(
  reason: "command_type" | "attempt_id" | "payload",
  storedAttemptId: string,
): string {
  switch (reason) {
    case "command_type":
      return "reused with a different command type";
    case "attempt_id":
      return `already used for attempt ${storedAttemptId}`;
    case "payload":
      return "reused with a different payload";
  }
}

/**
 * Pre-read replay/conflict (audit §5.1 step 1) — non-locking, ctx-scoped,
 * OUTSIDE any transaction. This is the advisory fast path: when it finds a
 * stored receipt it decides replay/conflict without entering a transaction.
 * When it finds nothing it fires the `afterOperationLookupAbsent` barrier
 * gate and returns null so the caller proceeds to the primary transaction —
 * whose receipt INSERT remains the authoritative arbiter (a concurrent
 * winner between the pre-read and the insert surfaces as 23505 and is
 * recovered).
 */
async function preReadStoredReceipt(
  db: Database,
  ctx: RequestContext,
  input: ForceSubmitOperationInput,
  canonicalPayload: ForceSubmitRequestPayload,
  options: ForceSubmitExecutionInternalOptions,
  label: ForceSubmitExecutionLabel,
): Promise<AttemptCommandReceiptResponse | null> {
  const receiptRepo = createAttemptCommandReceiptRepo(db);
  const stored = await receiptRepo.findByOperationId(ctx, input.operationId);
  if (stored === null) {
    await options.observer?.afterOperationLookupAbsent?.({
      label,
      operationId: input.operationId,
      attemptId: input.attemptId,
    });
    return null;
  }
  return classifyStoredReceipt(stored, input, canonicalPayload);
}

/** Outcome of a primary force-submit transaction. */
interface ForceSubmitTransactionOutcome {
  result?: AttemptCommandReceiptResponse;
  error?: unknown;
  identity: BackendIdentity;
}

/**
 * Runs one force-submit transaction (primary only): EA lock → plan →
 * receipt insert (FIRST write) → submit/grade → verify → audit. Observer
 * hooks fire inside the callback; `onPrimaryCommitted` fires AFTER
 * `executeInTransaction` resolves (post-COMMIT — a callback-local
 * observation would be "ready to commit", not "committed").
 *
 * Returns the response AND the captured identity even when the callback
 * threw, so the recovery wrapper can correlate the failure to the primary
 * transaction.
 */
async function runForceSubmitTransaction(
  db: Database,
  ctx: RequestContext,
  input: ForceSubmitOperationInput,
  canonicalPayload: ForceSubmitRequestPayload,
  options: ForceSubmitExecutionInternalOptions,
  label: ForceSubmitExecutionLabel,
): Promise<ForceSubmitTransactionOutcome> {
  const observer = options.observer;
  let identity: BackendIdentity = { pid: 0, txid: "" };
  let committedDisposition: "applied" | "no_change" | undefined;
  try {
    const response = await executeInTransaction(db, async (tx) => {
      identity = await captureBackendIdentity(tx);

      const receiptRepo = createAttemptCommandReceiptRepo(tx);
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

      // EA lock order unchanged: Enrollment → Attempt (ADR-013 §9).
      const cap = await lockEnrollmentAndAttempt(
        enrollments,
        attempts,
        input.attemptId,
      );
      const locked = await attempts.findById(input.attemptId);
      if (!locked) {
        throw new NotFoundError("Attempt not found");
      }

      // Plan under the lock. Invalid states (voided / not_started / queued)
      // throw BEFORE any receipt write — 0 receipt, 0 audit, 0 mutation.
      const plan = planForceSubmitExecution(locked, input.now);

      await observer?.beforeReceiptInsert?.({
        label,
        pid: identity.pid,
        txid: identity.txid,
        operationId: input.operationId,
        attemptId: input.attemptId,
        beforeStatus: plan.beforeStatus,
        plannedOutcome: plan.outcome,
      });

      // Receipt insert — the FIRST business write in this transaction (audit
      // §5.1 step 7). Append-only: no provisional row, no later UPDATE. Its
      // UNIQUE(organization_id, operation_id) is the race arbiter — a
      // concurrent command that committed the same operationId first makes
      // this insert fail with 23505 and the wrapper recovers exactly that.
      const receiptRow = await receiptRepo.insertReceipt(ctx, {
        attemptId: input.attemptId,
        operationId: input.operationId,
        commandType: "force_submit",
        requestPayload: canonicalPayload,
        resultPayload: plan.resultPayload,
        outcome: plan.outcome,
        actorId: ctx.actorId,
        createdAt: input.now,
      });

      await observer?.afterReceiptInsert?.({
        label,
        pid: identity.pid,
        txid: identity.txid,
        operationId: input.operationId,
        attemptId: input.attemptId,
        tx,
      });

      // Execute the existing engine mutation, unchanged: submitAttempt (with
      // active-interruption terminalization for disrupted, reasonCode
      // admin_force_submit_terminalization) then gradeAttemptIdempotent,
      // inside the SAME locked transaction (no submitted-but-not-graded crash
      // window; a `submitted` row left by a crashed earlier operation is
      // recovered to graded here).
      const gradingWorksetRepo = createGradingWorksetRepoAdapter(
        createAttemptGradingEntryRepo(tx),
        ctx,
      );
      if (plan.needsSubmit) {
        const episodeRepo = createInterruptionEpisodeRepoAdapter(
          createAttemptInterruptionRepo(tx),
          ctx,
        );
        const eventRepo = createInterruptionEventRepoAdapter(
          createAttemptInterruptionEventRepo(tx),
          ctx,
        );
        const resolution: SubmitInterruptionResolution =
          locked.status === "disrupted"
            ? {
                mode: "active_interruption",
                episodeRepo,
                eventRepo,
                hint: {
                  policy:
                    locked.interruptionTimingPolicySnapshot?.policy ?? "strict",
                  eligibleSeconds: null,
                  adjustmentId: null,
                  reasonCode: "admin_force_submit_terminalization",
                },
              }
            : { mode: "none", episodeRepo, eventRepo };
        await submitAttempt(
          attempts,
          gradingWorksetRepo,
          input.attemptId,
          input.now,
          { source: "proctor", resolution },
        );
      }
      if (plan.needsGrade) {
        await gradeAttemptIdempotent(
          exams,
          enrollments,
          attempts,
          gradingWorksetRepo,
          cap,
          input.now,
        );
      }

      // Postcondition: re-read the final attempt and verify the committed
      // fact equals the stored result_payload. Fail closed on mismatch —
      // rollback everything, never UPDATE the receipt.
      const final = await attempts.findById(input.attemptId);
      if (!final) {
        throw new NotFoundError("Attempt not found after force-submit");
      }
      assertCommittedFactMatchesStored(final, plan.resultPayload);

      // Compliance audit — atomic with receipt + mutation. Written ONLY on a
      // real force-submit transition (no_change / replay / conflict / invalid
      // state write nothing). Metadata carries the operationId + canonical
      // reason so the audit fact links to the receipt (audit §13).
      if (plan.needsAudit && options.audit) {
        await observer?.beforeAuditWrite?.({
          label,
          pid: identity.pid,
          txid: identity.txid,
          operationId: input.operationId,
          attemptId: input.attemptId,
        });
        await recordAtomicHttpAudit(tx, options.audit.request, ctx, {
          action: "attempt.forceSubmit",
          targetType: "attempt",
          targetId: input.attemptId,
          metadata: {
            operationId: input.operationId,
            reason: canonicalPayload.reason,
          },
        });
        await observer?.afterAuditWrite?.({
          label,
          pid: identity.pid,
          txid: identity.txid,
          operationId: input.operationId,
          attemptId: input.attemptId,
        });
      }

      committedDisposition = plan.outcome;
      return receiptRowToWireResponse(
        receiptRowToRecord(receiptRow),
        plan.outcome,
      );
    });
    // executeInTransaction resolved ⇒ the COMMIT was issued and settled.
    // Only at this point is "committed" a truthful label.
    if (committedDisposition !== undefined) {
      await observer?.onPrimaryCommitted?.({
        label,
        pid: identity.pid,
        txid: identity.txid,
        disposition: committedDisposition,
      });
    }
    return { result: response, identity };
  } catch (error) {
    return { error, identity };
  }
}

/**
 * The 23505 recovery: after the primary transaction rolled back on the exact
 * `attempt_command_receipts_org_operation_unique` constraint, a FRESH
 * transaction re-reads the winner's receipt and classifies it
 * (audit §14). This path performs NO mutation — it is a read-only
 * arbitration. When the fresh transaction cannot see a winner receipt
 * (impossible for a committed unique violation), it throws an invariant
 * failure instead of retrying the command.
 */
async function runReceiptRecovery(
  db: Database,
  ctx: RequestContext,
  input: ForceSubmitOperationInput,
  canonicalPayload: ForceSubmitRequestPayload,
  options: ForceSubmitExecutionInternalOptions,
  label: ForceSubmitExecutionLabel,
): Promise<ForceSubmitTransactionOutcome> {
  const observer = options.observer;
  let identity: BackendIdentity = { pid: 0, txid: "" };
  try {
    const response = await executeInTransaction(db, async (tx) => {
      identity = await captureBackendIdentity(tx);
      await observer?.onRecoveryTransaction?.({
        label,
        pid: identity.pid,
        txid: identity.txid,
      });

      const receiptRepo = createAttemptCommandReceiptRepo(tx);
      const stored = await receiptRepo.findByOperationId(
        ctx,
        input.operationId,
      );
      if (!stored) {
        // The unique violation proved a winner row exists and is committed;
        // a fresh transaction MUST see it. Not finding it is an invariant
        // failure — do NOT treat this as a retryable fresh command.
        throw new AppError(
          `Invariant failure: operation ${input.operationId} hit the receipt ` +
            "unique constraint but no winner receipt is visible in a fresh " +
            "transaction",
          "INTERNAL_INVARIANT_VIOLATION",
          500,
        );
      }
      return classifyStoredReceipt(stored, input, canonicalPayload);
    });
    return { result: response, identity };
  } catch (error) {
    return { error, identity };
  }
}

/**
 * Force-submit with operationId race recovery (J5-I1C0 audit §5.1, §14).
 * Single entry point shared by the HTTP route and the deterministic
 * concurrency test.
 *
 * Background: `operationId` is command identity scoped to the organization.
 * Two concurrent force-submits carrying the same `operationId` but targeting
 * *different* Attempts do NOT share the EA lock, so nothing in their
 * transactions serializes them — the only mutex is the
 * `(organization_id, operation_id)` unique index. The loser's receipt insert
 * fails with 23505, rolling its whole transaction (receipt + mutation +
 * audit) back.
 *
 * Recovery: when the failure is exactly that constraint's 23505, a FRESH
 * read-only transaction re-reads and classifies the winner receipt:
 *   - same command + same attempt + same canonical payload
 *     → `idempotent_replay` (returns the winner's stored immutable fact);
 *   - otherwise → `IdempotencyConflictError` (wire 409 IDEMPOTENCY_CONFLICT).
 *
 * This wrapper recovers AT MOST ONCE (never recursion) and rethrows every
 * other error unchanged. The original `now` is threaded through so the
 * command identity stays byte-identical across the primary and any recovery.
 */
/**
 * PRODUCTION entry point for force-submit with operationId race recovery.
 * `audit` is REQUIRED — every applied force-submit transition records the
 * `attempt.forceSubmit` compliance audit atomically with the receipt + mutation.
 * Replay / `no_change` / conflict paths write no audit (they are not real
 * transitions). Delegates to the shared core; the type-level `audit` invariant
 * is enforced HERE, at the only production call boundary.
 */
export async function forceSubmitWithOperationRaceRecovery(
  db: Database,
  ctx: RequestContext,
  input: ForceSubmitOperationInput,
  options: ForceSubmitExecutionOptions,
): Promise<AttemptCommandReceiptResponse> {
  return runForceSubmitWithRaceRecovery(db, ctx, input, options);
}

/**
 * TEST-ONLY entry point. Mirrors the production entry but allows omitting the
 * audit (so deterministic tests can assert audit ABSENCE on the no-audit path
 * by name) and accepts observer/label hooks. Production code MUST NOT import
 * this — the name is the contract that the audit-mandatory invariant only
 * relaxes inside tests.
 */
export async function forceSubmitWithOperationRaceRecoveryTestOnly(
  db: Database,
  ctx: RequestContext,
  input: ForceSubmitOperationInput,
  options: ForceSubmitExecutionTestOptions = {},
): Promise<AttemptCommandReceiptResponse> {
  return runForceSubmitWithRaceRecovery(db, ctx, input, options);
}

/**
 * Shared core of the two entry points above. Receives the internal options
 * (audit optional) already normalized by the entry-specific option types.
 */
async function runForceSubmitWithRaceRecovery(
  db: Database,
  ctx: RequestContext,
  input: ForceSubmitOperationInput,
  options: ForceSubmitExecutionInternalOptions,
): Promise<AttemptCommandReceiptResponse> {
  // The wire schema already validated/trimmed reason; canonicalizing here
  // guarantees the durable request_payload comes from the ONE domain
  // canonicalizer (J5-I1C0 §8 "canonicalizeForceSubmitPayload").
  const canonicalPayload = canonicalizeForceSubmitPayload({
    reason: input.reason,
  });
  const label = options.label ?? "T1";

  // Pre-read replay/conflict — non-locking, outside any transaction.
  const preRead = await preReadStoredReceipt(
    db,
    ctx,
    input,
    canonicalPayload,
    options,
    label,
  );
  if (preRead) return preRead;

  const primary = await runForceSubmitTransaction(
    db,
    ctx,
    input,
    canonicalPayload,
    options,
    label,
  );
  if (primary.result) return primary.result;

  const matched = matchAttemptCommandReceiptOperationUniqueViolation(
    primary.error,
  );
  if (!matched) {
    throw primary.error;
  }

  // The primary transaction was rolled back by the exact 23505. Observe the
  // real violation fields (extracted from the caught error) together with the
  // PRIMARY transaction's identity, then arbitrate the winner in a fresh
  // transaction — at most once.
  const observer = options.observer;
  await observer?.onUniqueViolation?.({
    label,
    code: matched.code,
    constraint: matched.constraint,
    ...(matched.table ? { table: matched.table } : {}),
    ...(matched.schema ? { schema: matched.schema } : {}),
    pid: primary.identity.pid,
    txid: primary.identity.txid,
  });

  const recovery = await runReceiptRecovery(
    db,
    ctx,
    input,
    canonicalPayload,
    options,
    label,
  );
  if (recovery.result) return recovery.result;
  throw recovery.error;
}
