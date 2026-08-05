import { randomUUID } from "node:crypto";
import type {
  AttemptCommandType,
  ForceSubmitRequestPayload,
  ForceSubmitResultPayload,
  MisconductMarkRequestPayload,
  MisconductMarkResultPayload,
  RequestContext,
} from "@exam/domain";
import { and, asc, eq } from "drizzle-orm";
import { attemptCommandReceipts } from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import { resolveOrganizationId } from "./baseRepo.js";

export type AttemptCommandReceiptRow =
  typeof attemptCommandReceipts.$inferSelect;

/** Persistent receipt outcome (audit §3.3 — `idempotent_replay` is never stored). */
export type AttemptCommandReceiptOutcome = "applied" | "no_change";

/**
 * Discriminated-union input for
 * {@link createAttemptCommandReceiptRepo.insertReceipt}. The `commandType`
 * discriminates the branch, and each branch binds BOTH the `requestPayload`
 * and the `resultPayload` to that command at compile time (review J5-I1C0 PR
 * #261 P2-1) — a `force_submit` row carrying a `misconduct_mark` payload is a
 * TypeScript error, not a runtime `as` cast. The domain canonicalizer already
 * binds the request side; this input extends the same binding to the stored
 * result.
 *
 * Shared fields (`attemptId`, `operationId`, ...) are factored into a base so
 * the union stays readable; the discriminator narrows the payload pair.
 */
interface InsertAttemptCommandReceiptBase {
  attemptId: string;
  operationId: string;
  outcome: AttemptCommandReceiptOutcome;
  actorId: string;
  /**
   * Server time authority for the receipt row (the orchestrator passes the
   * transaction's `now`; the DB column default — a database-side timestamp —
   * is the fallback). Mirrors the `attemptTimeAdjustmentRepo` /
   * `incidentRepo` convention — the caller is the server, never the client.
   */
  createdAt: Date;
}

/** force_submit receipt insert: both payloads bound to force_submit. */
export interface InsertForceSubmitReceiptInput extends InsertAttemptCommandReceiptBase {
  commandType: "force_submit";
  requestPayload: ForceSubmitRequestPayload;
  resultPayload: ForceSubmitResultPayload;
}

/** misconduct_mark receipt insert: both payloads bound to misconduct_mark. */
export interface InsertMisconductMarkReceiptInput extends InsertAttemptCommandReceiptBase {
  commandType: "misconduct_mark";
  requestPayload: MisconductMarkRequestPayload;
  resultPayload: MisconductMarkResultPayload;
}

/**
 * Input for {@link createAttemptCommandReceiptRepo.insertReceipt}. A
 * discriminated union on `commandType` so a mismatched payload pair cannot be
 * expressed at the call site.
 */
export type InsertAttemptCommandReceiptInput =
  | InsertForceSubmitReceiptInput
  | InsertMisconductMarkReceiptInput;

/**
 * Guard against a caller inserting a payload that does not belong to the
 * declared commandType. The {@link InsertAttemptCommandReceiptInput} union
 * binds the payloads to the command at compile time; this runtime check
 * keeps the durable row self-consistent even if a caller bypasses the types
 * (`as unknown as`, a JS caller, or a row read back from the database).
 */
function assertPayloadMatchesCommandType(
  input: InsertAttemptCommandReceiptInput,
): void {
  const requestType =
    "reason" in input.requestPayload ? "force_submit" : "misconduct_mark";
  if (requestType !== input.commandType) {
    throw new Error(
      `requestPayload shape belongs to ${requestType}, not ${input.commandType}`,
    );
  }
  if (input.resultPayload.commandType !== input.commandType) {
    throw new Error(
      `resultPayload.commandType ${input.resultPayload.commandType} does not match ${input.commandType}`,
    );
  }
}

/**
 * Tenant-scoped repository for the durable Attempt command receipt table
 * (J5-I1C Slice 1 / J5-I1C0 audit §6.2, §9).
 *
 * Every method filters by `ctx.organizationId` (fail closed on cross-org rows).
 * operationId scope is PER ORGANIZATION: the {@link findByOperationId} lookup
 * is the cross-command conflict arbiter and MUST NOT pre-filter by
 * `commandType` or `attemptId` — the single `UNIQUE(organization_id,
 * operation_id)` constraint is what makes a `force_submit` reusing a
 * `misconduct_mark` operationId conflict enforceable (audit §3.2/§4.5).
 *
 * This repository only owns the atomic insert + lookups. Unique-violation race
 * recovery (translating a 23505 into replay/conflict) belongs to the Slice 2/3
 * orchestrators, NOT here: `insertReceipt` deliberately surfaces the PG error
 * so the orchestrator can match the real constraint name.
 */
export function createAttemptCommandReceiptRepo(db: Database) {
  /**
   * Insert exactly one receipt row. Does NOT swallow the unique violation: a
   * 23505 from `attempt_command_receipts_org_operation_unique` is the race
   * signal the orchestrator recovers from. Also does NOT rebuild the result
   * payload from the live attempt — the caller passes the already-frozen
   * canonical payloads (audit §9.2).
   */
  async function insertReceipt(
    ctx: TenantContext | RequestContext,
    input: InsertAttemptCommandReceiptInput,
  ): Promise<AttemptCommandReceiptRow> {
    assertPayloadMatchesCommandType(input);
    const rows = await db
      .insert(attemptCommandReceipts)
      .values({
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        attemptId: input.attemptId,
        operationId: input.operationId,
        commandType: input.commandType,
        requestPayload: input.requestPayload,
        resultPayload: input.resultPayload,
        outcome: input.outcome,
        actorId: input.actorId,
        createdAt: input.createdAt,
      })
      .returning();
    return rows[0]!;
  }

  /**
   * The cross-command idempotency arbiter lookup (audit §9.1). Returns the
   * stored row for `(organizationId, operationId)` REGARDLESS of commandType
   * or attemptId. This is deliberately unfiltered: the orchestrator must see a
   * conflicting receipt of ANY command type / ANY attempt so it can classify
   * replay vs conflict (same command+attempt+payload → replay; otherwise →
   * 409). Pre-filtering here would let a cross-command operationId reuse
   * silently succeed.
   */
  async function findByOperationId(
    ctx: TenantContext | RequestContext,
    operationId: string,
  ): Promise<AttemptCommandReceiptRow | null> {
    const rows = await db
      .select()
      .from(attemptCommandReceipts)
      .where(
        and(
          eq(attemptCommandReceipts.organizationId, resolveOrganizationId(ctx)),
          eq(attemptCommandReceipts.operationId, operationId),
        ),
      );
    return rows[0] ?? null;
  }

  /**
   * Per-attempt receipt history, org- and attempt-scoped, with an optional
   * command-type filter (audit §9.3). Deterministic ordering by
   * `(created_at ASC, id ASC)`.
   *
   * Index support: without a command filter the query is served by
   * `attempt_command_receipts_org_attempt_created_idx`
   * (organization_id, attempt_id, created_at, id) — equality prefix +
   * ordering columns, no sort node. With a command filter it is served by
   * `attempt_command_receipts_org_attempt_command_created_idx`
   * (organization_id, attempt_id, command_type, created_at, id). A single
   * index cannot cover both orderings (command_type sits between attempt_id
   * and created_at in the B-tree key), hence two.
   */
  async function listByAttempt(
    ctx: TenantContext | RequestContext,
    attemptId: string,
    commandType?: AttemptCommandType,
  ): Promise<AttemptCommandReceiptRow[]> {
    const conditions = [
      eq(attemptCommandReceipts.organizationId, resolveOrganizationId(ctx)),
      eq(attemptCommandReceipts.attemptId, attemptId),
    ];
    if (commandType !== undefined) {
      conditions.push(eq(attemptCommandReceipts.commandType, commandType));
    }
    return db
      .select()
      .from(attemptCommandReceipts)
      .where(and(...conditions))
      .orderBy(
        asc(attemptCommandReceipts.createdAt),
        asc(attemptCommandReceipts.id),
      );
  }

  return { insertReceipt, findByOperationId, listByAttempt };
}
