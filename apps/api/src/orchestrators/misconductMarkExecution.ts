/**
 * Misconduct-mark durable operation execution — the single production
 * implementation shared by the HTTP route (`routes/attempts.admin.ts`) and the
 * deterministic concurrency tests
 * (`routes/attempts/admin-misconduct.concurrency.test.ts`).
 *
 * This module is the Slice-3 misconduct counterpart to
 * {@link forceSubmitWithOperationRaceRecovery} (Slice 2). Both dangerous
 * Attempt commands arbitrate on the SAME
 * `attempt_command_receipts (organization_id, operation_id)` unique constraint
 * via the shared helpers in `attemptCommandReceiptExecution.ts`.
 *
 * J5-I1C0 §8 concurrency experiment (run 2026-08-07 against PostgreSQL 18,
 * REPEATABLE READ, two physical connections, true overlap) — RECORDED OUTCOME:
 *
 *   - Two concurrent misconduct receipts targeting the SAME attempt each
 *     insert their own append-only receipt row (the receipt arbiter is
 *     `(organization_id, operation_id)` — NOT per-attempt — so both insert
 *     fine; each operationId is a distinct command identity).
 *   - A concurrent `UPDATE exam_attempts.misconduct` on the SAME row under
 *     REPEATABLE READ produces SQLSTATE 40001
 *     (`could not serialize access due to concurrent update`) for the loser
 *     when the row is first written by the winner. The loser's WHOLE
 *     transaction (receipt + projection + audit) rolls back — no orphan
 *     receipt, no orphan audit, no projection-only mutation.
 *   - Therefore the simplest correct projection mechanism is: take the
 *     `exam_attempts` row `FOR UPDATE` inside the receipt transaction. This
 *     serializes the projection writes deterministically (the second mark
 *     blocks on the row lock; under RR its first attempt 40001-fails and
 *     `executeInTransaction` auto-retries, re-reading the committed
 *     projection and overwriting on its own success). This mirrors how
 *     force-submit already holds the EA lock.
 *
 *   This is the explicit, recorded exception to the P2C-J4 §17 "no row lock"
 *   property — that property was specifically for the OLD overwrite-only
 *   `flagMisconduct` command (a single best-effort jsonb update). Making
 *   misconduct a durable, operationId-keyed command with a receipt + atomic
 *   audit REQUIRES the row lock; the audit's §5.2 step-5 candidate (a)
 *   "plain UPDATE without a lock" was REJECTED by the experiment because it
 *   serialization-fails non-deterministically, and candidate (d) "read-derived
 *   projection" was rejected as a larger read-model change than this slice
 *   needs. The chosen mechanism (candidate (b), `FOR UPDATE`) is the minimal
 *   deterministic one.
 *
 * Transaction order (frozen by experiment, mirrors force-submit §5.1):
 *   pre-read replay/conflict (non-locking, outside any transaction)
 *   → BEGIN (REPEATABLE READ — `executeInTransaction` default)
 *   → `SELECT ... FOR UPDATE` on the attempt row (the §17 exception; serializes
 *     the projection write under concurrent marks)
 *   → reject missing attempt (404, 0 receipt / 0 audit / 0 mutation)
 *   → plan the outcome (always `applied` — misconduct is allowed on ANY status
 *     per ADR-014 §16; there is no `no_change` for misconduct, every new
 *     operationId is a real append)
 *   → INSERT the receipt row (FIRST write, commandType=`misconduct_mark`)
 *   → UPDATE `exam_attempts.misconduct` projection (the MisconductFlag this
 *     receipt establishes, frozen into the result_payload BEFORE the write)
 *   → re-read the attempt; verify the committed projection equals the stored
 *     result_payload (fail closed on mismatch — rollback, never UPDATE the
 *     receipt)
 *   → write the `attempt.misconductFlagged` audit ONLY on applied (metadata
 *     carries operationId + severity + notes)
 *   → COMMIT
 *   on the exact 23505 of `attempt_command_receipts_org_operation_unique`:
 *   → rollback → fresh transaction → re-read + classify the winner receipt →
 *     idempotent_replay or 409 IDEMPOTENCY_CONFLICT. At-most-once recovery,
 *     never recursive.
 *
 * The route passes `{ audit: { request } }`; the deterministic tests pass
 * `{ observer, label }` so barriers gate the transactions and observe the real
 * in-transaction evidence (PID, txid, and the SQLSTATE/constraint extracted
 * from the *caught* error). No caller reimplements any of this.
 */

import { sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type {
  AttemptStatus,
  ExamAttempt,
  MisconductSeverity,
  RequestContext,
} from "@exam/domain";
import {
  AppError,
  IdempotencyConflictError,
  NotFoundError,
  canonicalizeMisconductPayload,
} from "@exam/domain";
import type {
  MisconductMarkRequestPayload,
  MisconductMarkResultPayload,
} from "@exam/domain";
import type { Database, TransactionDatabase } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createAttemptCommandReceiptRepo } from "@exam/db/src/repository/attemptCommandReceiptRepo.js";
import type { AttemptCommandReceiptRow } from "@exam/db/src/repository/attemptCommandReceiptRepo.js";
import type { AttemptCommandReceiptResponse } from "@exam/contracts";
import { recordAtomicHttpAudit } from "../audit/auditWriter.js";
import {
  matchAttemptCommandReceiptOperationUniqueViolation,
  parseAndClassifyStoredReceipt,
  receiptRowToRecord,
  receiptRowToWireResponse,
} from "./attemptCommandReceiptExecution.js";

/**
 * Input of {@link misconductMarkWithOperationRaceRecovery}. `severity` +
 * `notes` have already passed the wire schema (canonical: severity literal,
 * notes trimmed, 1..1000 — J5-I1C0 §4.3) when the orchestrator is called; the
 * orchestrator still re-canonicalizes them so the durable request identity
 * comes from the single domain canonicalizer, not a third hand-written trim in
 * the route/orchestrator/repo layers.
 *
 * The receipt actor is NOT part of the command input — it always comes from
 * `ctx.actorId`, the single server-context authority (mirrors force-submit
 * review P2-2).
 */
export interface MisconductMarkOperationInput {
  attemptId: string;
  operationId: string;
  severity: MisconductSeverity;
  notes: string;
  /** One authoritative server timestamp threaded through receipt + projection + audit. */
  now: Date;
}

/** Test-only label identifying which concurrent transaction is running. */
export type MisconductMarkExecutionLabel = "T1" | "T2";

/**
 * Test-only observation + fault-injection hooks. Every method is optional and
 * defaults to no behavior; the production route sets no observer. Mirrors the
 * force-submit observer surface so the deterministic misconduct race test can
 * reuse the same barrier-backed pattern.
 *
 * - {@link MisconductMarkExecutionObserver.afterOperationLookupAbsent} fires
 *   when the pre-read `findByOperationId` returns null. It is the barrier gate
 *   that fixes T1-before-T2 ordering. It fires OUTSIDE any transaction.
 * - {@link MisconductMarkExecutionObserver.beforeReceiptInsert} fires under the
 *   attempt row lock, AFTER the outcome plan is fixed and BEFORE the receipt
 *   insert — the primary in-transaction ordering gate.
 * - {@link MisconductMarkExecutionObserver.afterReceiptInsert} /
 *   {@link MisconductMarkExecutionObserver.beforeAuditWrite} /
 *   {@link MisconductMarkExecutionObserver.afterAuditWrite} are fault-injection
 *   points for the failure-atomicity tests.
 * - {@link MisconductMarkExecutionObserver.onUniqueViolation} fires after the
 *   primary transaction rolled back on the exact 23505.
 * - {@link MisconductMarkExecutionObserver.onRecoveryTransaction} fires inside
 *   the fresh recovery transaction BEFORE the winner lookup.
 * - {@link MisconductMarkExecutionObserver.onPrimaryCommitted} fires AFTER the
 *   primary transaction has committed.
 */
export interface MisconductMarkExecutionObserver {
  afterOperationLookupAbsent?(observation: {
    label: MisconductMarkExecutionLabel;
    operationId: string;
    attemptId: string;
  }): Promise<void>;
  beforeReceiptInsert?(observation: {
    label: MisconductMarkExecutionLabel;
    pid: number;
    txid: string;
    operationId: string;
    attemptId: string;
    beforeStatus: ExamAttempt["status"];
    severity: MisconductSeverity;
    notes: string;
  }): Promise<void>;
  afterReceiptInsert?(observation: {
    label: MisconductMarkExecutionLabel;
    pid: number;
    txid: string;
    operationId: string;
    attemptId: string;
    /**
     * Test-only fault-injection handle: the live transaction, exposed so a
     * fault test can prove the postcondition verification (and the whole
     * transaction) fails closed. Production callers never set an observer.
     */
    tx: TransactionDatabase;
  }): Promise<void>;
  beforeAuditWrite?(observation: {
    label: MisconductMarkExecutionLabel;
    pid: number;
    txid: string;
    operationId: string;
    attemptId: string;
  }): Promise<void>;
  afterAuditWrite?(observation: {
    label: MisconductMarkExecutionLabel;
    pid: number;
    txid: string;
    operationId: string;
    attemptId: string;
  }): Promise<void>;
  onUniqueViolation?(observation: {
    label: MisconductMarkExecutionLabel;
    code: "23505";
    constraint: string;
    table?: string;
    schema?: string;
    pid: number;
    txid: string;
  }): Promise<void>;
  onRecoveryTransaction?(observation: {
    label: MisconductMarkExecutionLabel;
    pid: number;
    txid: string;
  }): Promise<void>;
  onPrimaryCommitted?(observation: {
    label: MisconductMarkExecutionLabel;
    pid: number;
    txid: string;
  }): Promise<void>;
  /**
   * Fires at the TOP of each `executeInTransaction` callback for both the
   * primary and recovery transactions. `attempt` is the 1-based index within a
   * single racer's lifetime (primary = 1; each 40001/40P01 auto-retry
   * increments it; the fresh recovery transaction starts again at 1 with
   * `phase: "recovery"`). A test uses this to PROVE a serialization retry
   * actually happened (distinct txids across attempts).
   */
  onTransactionAttempt?(observation: {
    label: MisconductMarkExecutionLabel;
    phase: "primary" | "recovery";
    attempt: number;
    pid: number;
    txid: string;
  }): Promise<void>;
}

/**
 * Internal options shared by the production entry and the test-only adapter.
 * `audit` is optional HERE ONLY so the test-only adapter can omit it; the
 * production entry ({@link misconductMarkWithOperationRaceRecovery}) takes a
 * separate options type that makes `audit` REQUIRED, so an "applied misconduct
 * mark with no compliance audit" is unrepresentable in production code.
 */
export interface MisconductMarkExecutionInternalOptions {
  /** When set, records the atomic `attempt.misconductFlagged` audit inside the txn. */
  audit?: { request: FastifyRequest };
  /** Test-only observation + barrier gate hooks. */
  observer?: MisconductMarkExecutionObserver;
  /** Test-only label ("T1"/"T2"). Ignored when no observer is set. */
  label?: MisconductMarkExecutionLabel;
}

/**
 * Production options for {@link misconductMarkWithOperationRaceRecovery}.
 * `audit` is REQUIRED — every applied misconduct mark records the
 * `attempt.misconductFlagged` compliance audit atomically with the receipt +
 * projection. Replay / conflict paths write no audit.
 */
export interface MisconductMarkExecutionOptions {
  /** Records the atomic `attempt.misconductFlagged` audit inside the txn (required). */
  audit: { request: FastifyRequest };
}

/**
 * Test-only options for
 * {@link misconductMarkWithOperationRaceRecoveryTestOnly}. Accepts
 * `observer`/`label` and an optional `audit` so a test that asserts audit
 * ABSENCE can omit it by name. Never import this from production code.
 */
export interface MisconductMarkExecutionTestOptions {
  observer?: MisconductMarkExecutionObserver;
  label?: MisconductMarkExecutionLabel;
  audit?: { request: FastifyRequest };
}

/** Backend identity captured inside a transaction callback. */
interface BackendIdentity {
  pid: number;
  txid: string;
}

/**
 * Captures the PostgreSQL backend PID and the current transaction id from
 * inside an open transaction callback (mirrors force-submit /
 * operatorGrant). `txid_current()` assigns a real transaction id only once the
 * transaction has done a write; calling it here guarantees a non-null id
 * distinct per transaction.
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
 * Builds the MisconductFlag + result_payload for an applied misconduct mark,
 * frozen BEFORE the projection write (J5-I1C0 §5.1 step 7 mirroring). The
 * wire/DB layer validates `flaggedAt` as an ISO string
 * (`MisconductFlagSchema`); the orchestrator builds it from the single
 * server-threaded `now`, NOT from a re-read of the attempt after the write.
 *
 * `flaggedAt` is stored as an ISO string here (the wire/JSONB form) so the
 * durable receipt row and the wire response validate against
 * `MisconductFlagSchema` (`z.string().datetime()`) and the read-back jsonb
 * matches byte-for-byte. The domain `MisconductFlag.flaggedAt: Date` type is
 * the engine-time shape; the orchestrator owns the boundary where the flag is
 * frozen into the immutable jsonb fact, so it canonicalizes to ISO here. The
 * projection write converts back to a `Date` for `attemptRepo.update`
 * (the column type-cast `$type<MisconductFlag>` does not parse jsonb dates on
 * read, so the committed projection row carries `flaggedAt` as an ISO string —
 * this frozen value is what the postcondition compares against).
 */
function buildAppliedResultPayload(
  actorId: string,
  severity: MisconductSeverity,
  canonicalNotes: string,
  now: Date,
): MisconductMarkResultPayload {
  const flaggedAtIso = now.toISOString();
  return {
    commandType: "misconduct_mark",
    misconduct: {
      flaggedAt: flaggedAtIso,
      flaggedBy: actorId,
      notes: canonicalNotes,
      severity,
    },
    appliedAt: flaggedAtIso,
  };
}

/**
 * Postcondition: the attempt projection committed by the UPDATE must EXACTLY
 * equal the `result_payload.misconduct` frozen into the receipt before it. On
 * mismatch, fail closed — the whole transaction rolls back (receipt +
 * projection + audit), and the receipt is NEVER updated to hide the divergence.
 *
 * `flaggedAt` is compared as a canonical timestamp: the stored value is an ISO
 * string (see {@link buildAppliedResultPayload}); the committed projection row
 * reads the jsonb back with `flaggedAt` as an ISO string too (the column
 * type-cast does not parse jsonb dates), so both sides normalize through
 * `Date.parse` to tolerate any representation drift while still locking the
 * exact instant.
 */
function assertCommittedProjectionMatchesStored(
  final: ExamAttempt,
  stored: MisconductMarkResultPayload,
): void {
  const committed = final.misconduct;
  const expected = stored.misconduct;
  const committedAtRaw = committed?.flaggedAt;
  const expectedAtRaw = expected?.flaggedAt;
  const committedAt =
    committedAtRaw === undefined || committedAtRaw === null
      ? null
      : typeof committedAtRaw === "string"
        ? Date.parse(committedAtRaw)
        : committedAtRaw.getTime();
  // `expected` is the wire form — flaggedAt is ALWAYS an ISO string here.
  const expectedAt =
    expected === null || expectedAtRaw === undefined || expectedAtRaw === null
      ? null
      : Date.parse(expectedAtRaw);
  const notesMatch = committed?.notes === expected?.notes;
  const same =
    (committed === null || committed === undefined) ===
      (expected === null || expected === undefined) &&
    committed?.flaggedBy === expected?.flaggedBy &&
    committed?.severity === expected?.severity &&
    notesMatch &&
    committedAt === expectedAt;
  if (!same) {
    throw new AppError(
      `Invariant failure: misconduct-mark committed projection ` +
        `(flaggedBy=${committed?.flaggedBy ?? null}, ` +
        `severity=${committed?.severity ?? null}, ` +
        `flaggedAt=${committedAt ?? null}, ` +
        `notesMatch=${notesMatch}) does not match the stored ` +
        `receipt result_payload (flaggedBy=${expected?.flaggedBy ?? null}, ` +
        `severity=${expected?.severity ?? null}, ` +
        `flaggedAt=${expectedAt ?? null}, ` +
        `notesMatch=${notesMatch}); transaction rolled back`,
      "INTERNAL_INVARIANT_VIOLATION",
      500,
    );
  }
}

/**
 * Classifies a stored receipt (found by the pre-read or by the 23505 recovery)
 * against the incoming command and returns the wire response for a replay, or
 * throws `IdempotencyConflictError` for a conflict (audit §4.5). A replay
 * NEVER re-reads the live attempt, never re-writes the projection, never writes
 * an audit, and never touches the stored row — the response is built from the
 * stored immutable fact.
 */
function classifyStoredReceipt(
  stored: AttemptCommandReceiptRow,
  input: MisconductMarkOperationInput,
  canonicalPayload: MisconductMarkRequestPayload,
): AttemptCommandReceiptResponse {
  const { receipt, decision } = parseAndClassifyStoredReceipt({
    row: stored,
    requestedCommandType: "misconduct_mark",
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
 * OUTSIDE any transaction. Advisory fast path: when it finds a stored receipt
 * it decides replay/conflict without entering a transaction. When it finds
 * nothing it fires the `afterOperationLookupAbsent` barrier gate and returns
 * null so the caller proceeds to the primary transaction.
 */
async function preReadStoredReceipt(
  db: Database,
  ctx: RequestContext,
  input: MisconductMarkOperationInput,
  canonicalPayload: MisconductMarkRequestPayload,
  options: MisconductMarkExecutionInternalOptions,
  label: MisconductMarkExecutionLabel,
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

/** Outcome of a primary misconduct-mark transaction. */
interface MisconductMarkTransactionOutcome {
  result?: AttemptCommandReceiptResponse;
  error?: unknown;
  identity: BackendIdentity;
}

/**
 * Runs one misconduct-mark transaction (primary only): attempt FOR UPDATE →
 * plan → receipt insert (FIRST write) → projection UPDATE → verify → audit.
 * Observer hooks fire inside the callback; `onPrimaryCommitted` fires AFTER
 * `executeInTransaction` resolves.
 *
 * Returns the response AND the captured identity even when the callback threw,
 * so the recovery wrapper can correlate the failure to the primary transaction.
 */
async function runMisconductMarkTransaction(
  db: Database,
  ctx: RequestContext,
  input: MisconductMarkOperationInput,
  canonicalPayload: MisconductMarkRequestPayload,
  options: MisconductMarkExecutionInternalOptions,
  label: MisconductMarkExecutionLabel,
): Promise<MisconductMarkTransactionOutcome> {
  const observer = options.observer;
  let identity: BackendIdentity = { pid: 0, txid: "" };
  // 1-based attempt index: increments on EACH `executeInTransaction` callback
  // invocation (initial + every 40001/40P01 auto-retry). A test observer uses
  // this to PROVE a serialization retry actually happened (distinct txids
  // across attempts) when the primary serializes behind a concurrent winner.
  let primaryAttempt = 0;
  let primaryCommitted = false;
  try {
    const response = await executeInTransaction(db, async (tx) => {
      // Backend PID/txid evidence is OBSERVER-ONLY (the deterministic race
      // test correlates retries to distinct transactions); skip the extra
      // query when no observer is configured.
      if (observer) {
        identity = await captureBackendIdentity(tx);
      }
      primaryAttempt += 1;
      await observer?.onTransactionAttempt?.({
        label,
        phase: "primary",
        attempt: primaryAttempt,
        pid: identity.pid,
        txid: identity.txid,
      });

      const receiptRepo = createAttemptCommandReceiptRepo(tx);
      const attemptRepo = createAttemptRepo(tx);

      // §17 exception (recorded): FOR UPDATE the attempt row so the projection
      // write serializes deterministically under concurrent misconduct marks.
      // Missing attempt → 404 BEFORE any receipt write (0 receipt / 0 audit).
      const locked = await attemptRepo.findByIdForUpdate(ctx, input.attemptId);
      if (!locked) {
        throw new NotFoundError("Attempt not found");
      }

      const resultPayload = buildAppliedResultPayload(
        ctx.actorId,
        input.severity,
        canonicalPayload.notes,
        input.now,
      );

      await observer?.beforeReceiptInsert?.({
        label,
        pid: identity.pid,
        txid: identity.txid,
        operationId: input.operationId,
        attemptId: input.attemptId,
        beforeStatus: locked.status as AttemptStatus,
        severity: input.severity,
        notes: canonicalPayload.notes,
      });

      // Receipt insert — the FIRST business write in this transaction. Its
      // UNIQUE(organization_id, operation_id) is the cross-command race
      // arbiter; a concurrent force_submit / misconduct_mark carrying the same
      // operationId makes this insert fail with 23505 and the wrapper recovers.
      const receiptRow = await receiptRepo.insertReceipt(ctx, {
        attemptId: input.attemptId,
        operationId: input.operationId,
        commandType: "misconduct_mark",
        requestPayload: canonicalPayload,
        resultPayload: resultPayload,
        outcome: "applied",
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

      // Projection write: update exam_attempts.misconduct to the MisconductFlag
      // this receipt establishes (the wire ISO flaggedAt converts back to the
      // engine-time Date for the domain projection). The held FOR UPDATE lock
      // serializes this with any concurrent mark; a concurrent winner surfaces
      // as 40001 on the loser, which executeInTransaction auto-retries.
      const updated = await attemptRepo.update(ctx, input.attemptId, {
        misconduct:
          resultPayload.misconduct === null
            ? null
            : {
                flaggedAt: new Date(resultPayload.misconduct.flaggedAt),
                flaggedBy: resultPayload.misconduct.flaggedBy,
                notes: resultPayload.misconduct.notes,
                severity: resultPayload.misconduct.severity,
              },
      });
      if (!updated) {
        throw new NotFoundError("Attempt not found after misconduct update");
      }

      // Postcondition: re-read the attempt and verify the committed projection
      // equals the stored result_payload. Fail closed on mismatch.
      const final = await attemptRepo.findById(ctx, input.attemptId);
      if (!final) {
        throw new NotFoundError("Attempt not found after misconduct update");
      }
      assertCommittedProjectionMatchesStored(
        final as unknown as ExamAttempt,
        resultPayload,
      );

      // Compliance audit — atomic with receipt + projection. Written ONLY on
      // applied (replay / conflict paths write nothing). Metadata carries the
      // operationId + canonical severity/notes so the audit fact links to the
      // receipt (audit §13).
      if (options.audit) {
        await observer?.beforeAuditWrite?.({
          label,
          pid: identity.pid,
          txid: identity.txid,
          operationId: input.operationId,
          attemptId: input.attemptId,
        });
        await recordAtomicHttpAudit(tx, options.audit.request, ctx, {
          action: "attempt.misconductFlagged",
          targetType: "attempt",
          targetId: input.attemptId,
          metadata: {
            operationId: input.operationId,
            severity: canonicalPayload.severity,
            notes: canonicalPayload.notes,
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

      return receiptRowToWireResponse(
        receiptRowToRecord(receiptRow),
        "applied",
      );
    });
    // executeInTransaction resolved ⇒ the COMMIT was issued and settled. Only
    // at this point is "committed" a truthful label.
    primaryCommitted = true;
    await observer?.onPrimaryCommitted?.({
      label,
      pid: identity.pid,
      txid: identity.txid,
    });
    return { result: response, identity };
  } catch (error) {
    return { error, identity };
  }
}

/**
 * The 23505 recovery: after the primary transaction rolled back on the exact
 * `attempt_command_receipts_org_operation_unique` constraint, a FRESH
 * transaction re-reads the winner's receipt and classifies it (audit §14).
 * This path performs NO mutation — it is a read-only arbitration. When the
 * fresh transaction cannot see a winner receipt (impossible for a committed
 * unique violation), it throws an invariant failure instead of retrying.
 */
async function runReceiptRecovery(
  db: Database,
  ctx: RequestContext,
  input: MisconductMarkOperationInput,
  canonicalPayload: MisconductMarkRequestPayload,
  options: MisconductMarkExecutionInternalOptions,
  label: MisconductMarkExecutionLabel,
): Promise<MisconductMarkTransactionOutcome> {
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
      await observer?.onTransactionAttempt?.({
        label,
        phase: "recovery",
        attempt: 1,
        pid: identity.pid,
        txid: identity.txid,
      });

      const receiptRepo = createAttemptCommandReceiptRepo(tx);
      const stored = await receiptRepo.findByOperationId(
        ctx,
        input.operationId,
      );
      if (!stored) {
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
 * PRODUCTION entry point for misconduct-mark with operationId race recovery.
 * `audit` is REQUIRED — every applied misconduct mark records the
 * `attempt.misconductFlagged` compliance audit atomically with the receipt +
 * projection. Replay / conflict paths write no audit. Delegates to the shared
 * core; the type-level `audit` invariant is enforced HERE, at the only
 * production call boundary.
 */
export async function misconductMarkWithOperationRaceRecovery(
  db: Database,
  ctx: RequestContext,
  input: MisconductMarkOperationInput,
  options: MisconductMarkExecutionOptions,
): Promise<AttemptCommandReceiptResponse> {
  return runMisconductMarkWithRaceRecovery(db, ctx, input, options);
}

/**
 * TEST-ONLY entry point. Mirrors the production entry but allows omitting the
 * audit and accepts observer/label hooks. Production code MUST NOT import this.
 */
export async function misconductMarkWithOperationRaceRecoveryTestOnly(
  db: Database,
  ctx: RequestContext,
  input: MisconductMarkOperationInput,
  options: MisconductMarkExecutionTestOptions = {},
): Promise<AttemptCommandReceiptResponse> {
  return runMisconductMarkWithRaceRecovery(db, ctx, input, options);
}

/**
 * Shared core of the two entry points above. Receives the internal options
 * (audit optional) already normalized by the entry-specific option types.
 */
async function runMisconductMarkWithRaceRecovery(
  db: Database,
  ctx: RequestContext,
  input: MisconductMarkOperationInput,
  options: MisconductMarkExecutionInternalOptions,
): Promise<AttemptCommandReceiptResponse> {
  const canonicalPayload = canonicalizeMisconductPayload({
    severity: input.severity,
    notes: input.notes,
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

  const primary = await runMisconductMarkTransaction(
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
