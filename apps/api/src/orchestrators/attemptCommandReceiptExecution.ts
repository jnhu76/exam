/**
 * Shared foundation for the durable Attempt command receipt orchestrators
 * (J5-I1C Slice 2 force-submit, Slice 3 misconduct-mark). The two dangerous
 * Attempt commands arbitrate on the SAME
 * `UNIQUE (organization_id, operation_id)` constraint of
 * `attempt_command_receipts` — the one cross-command idempotency arbiter
 * (J5-I1C0 audit §4.5 / §6.2). This module owns exactly the pieces both
 * orchestrators share and nothing else:
 *
 *   - the exact constraint name,
 *   - matching a thrown PostgreSQL 23505 against that exact constraint,
 *   - validating a stored receipt row (fail closed on malformed jsonb),
 *   - classifying a stored receipt as replay vs conflict, and
 *   - mapping a validated stored receipt to the wire response.
 *
 * The force-submit / misconduct-mark engine flows deliberately stay in their
 * own orchestrator files; a future misconduct orchestrator must NOT depend on
 * a force-submit-named matcher.
 *
 * See docs/audits/J5-I1C0-DANGEROUS-COMMAND-IDENTITY-REALITY-AUDIT.md §4/§5.
 */

import { ValidationError } from "@exam/domain";
import { classifyAttemptCommandReplay } from "@exam/domain";
import type {
  AttemptCommandReplayDecision,
  AttemptCommandType,
} from "@exam/domain";
import type { AttemptCommandReceiptRow } from "@exam/db/src/repository/attemptCommandReceiptRepo.js";
import {
  AttemptCommandReceiptRecordSchema,
  AttemptCommandReceiptResponseSchema,
  type AttemptCommandDisposition,
  type AttemptCommandReceiptRecord,
  type AttemptCommandReceiptResponse,
} from "@exam/contracts";

/**
 * The `(organization_id, operation_id)` unique index on the shared attempt
 * command receipt table. Two concurrent dangerous commands that carry the
 * same `operationId` but do not share the EA row lock race only on this
 * index. The loser's insert hits 23505; this constant names the exact
 * constraint so recovery can be scoped to it and not swallow unrelated unique
 * violations (duplicate username, etc.).
 */
export const ATTEMPT_COMMAND_RECEIPT_OPERATION_UNIQUE_CONSTRAINT =
  "attempt_command_receipts_org_operation_unique";

/**
 * A 23505 unique-violation matched against
 * {@link ATTEMPT_COMMAND_RECEIPT_OPERATION_UNIQUE_CONSTRAINT}. The fields are
 * extracted from the real thrown PostgreSQL error (NOT re-hard-coded by the
 * caller), so the deterministic tests assert the actual runtime values.
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
 * (23505) whose `constraint` is exactly
 * `attempt_command_receipts_org_operation_unique`, and returns its real
 * fields. Postgres-js surfaces the underlying error fields at the top of the
 * thrown object (`.code`, `.constraint`, `.table`); drizzle/retry wrappers
 * may wrap it one or more levels, so the walk mirrors
 * `orchestrators/operatorGrantExecution.ts` and `plugins/errors.ts`. Returns
 * `null` for any other 23505 (stays a generic failure) or any non-23505 error
 * — the caller must NOT treat those as an idempotency race.
 */
export function matchAttemptCommandReceiptOperationUniqueViolation(
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
        if (
          constraint === ATTEMPT_COMMAND_RECEIPT_OPERATION_UNIQUE_CONSTRAINT
        ) {
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
 * Validates a stored receipt row against
 * {@link AttemptCommandReceiptRecordSchema} (commandType, request/result
 * payload shapes, outer/inner commandType consistency, outcome, timestamps).
 * A malformed stored row fails closed with a domain ValidationError — the
 * orchestrator must never guess a result from the live attempt when the
 * durable receipt is corrupted (audit §8 stored-row validation).
 */
export function receiptRowToRecord(
  row: AttemptCommandReceiptRow,
): AttemptCommandReceiptRecord {
  const parsed = AttemptCommandReceiptRecordSchema.safeParse({
    id: row.id,
    organizationId: row.organizationId,
    attemptId: row.attemptId,
    operationId: row.operationId,
    commandType: row.commandType,
    requestPayload: row.requestPayload,
    resultPayload: row.resultPayload,
    outcome: row.outcome,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  });
  if (!parsed.success) {
    throw new ValidationError(
      `Stored attempt command receipt ${row.id} is malformed; refusing to classify`,
    );
  }
  return parsed.data;
}

/** Result of {@link parseAndClassifyStoredReceipt}. */
export interface ClassifiedStoredReceipt {
  /** The validated stored receipt record. */
  receipt: AttemptCommandReceiptRecord;
  /** Replay vs conflict decision over the stored identifying fields. */
  decision: AttemptCommandReplayDecision;
}

/**
 * Validates a stored receipt row and classifies it against the incoming
 * command (audit §4.5). Used by both the pre-read replay/conflict path and
 * the 23505 fresh-transaction recovery path. The decision comes from the
 * pure domain classifier (`classifyAttemptCommandReplay`); this wrapper adds
 * the fail-closed row validation.
 */
export function parseAndClassifyStoredReceipt(args: {
  row: AttemptCommandReceiptRow;
  requestedCommandType: AttemptCommandType;
  requestedAttemptId: string;
  requestedCanonicalPayload: unknown;
}): ClassifiedStoredReceipt {
  const receipt = receiptRowToRecord(args.row);
  const decision = classifyAttemptCommandReplay({
    storedCommandType: receipt.commandType,
    storedAttemptId: receipt.attemptId,
    storedRequestPayload: receipt.requestPayload,
    requestedCommandType: args.requestedCommandType,
    requestedAttemptId: args.requestedAttemptId,
    requestedCanonicalPayload: args.requestedCanonicalPayload,
  });
  return { receipt, decision };
}

/**
 * Maps a validated stored receipt record to the frozen wire response
 * (audit §4.2/§4.4). The `disposition`/`outcome` pair follows the wire
 * contract: first execution carries disposition == outcome
 * (`applied` | `no_change`); a replay carries disposition
 * `idempotent_replay` with the ORIGINAL stored outcome. The response is
 * always built from the STORED immutable fact — never re-derived from the
 * live attempt.
 */
export function receiptRowToWireResponse(
  receipt: AttemptCommandReceiptRecord,
  disposition: AttemptCommandDisposition,
): AttemptCommandReceiptResponse {
  return AttemptCommandReceiptResponseSchema.parse({
    operationId: receipt.operationId,
    commandType: receipt.commandType,
    disposition,
    outcome:
      disposition === "idempotent_replay" ? receipt.outcome : disposition,
    resultPayload: receipt.resultPayload,
    createdAt: receipt.createdAt,
  });
}
