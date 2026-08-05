import { randomUUID } from "node:crypto";
import type { AttemptCommandType } from "@exam/domain";
import type { RequestContext } from "@exam/domain";
import { and, asc, eq } from "drizzle-orm";
import { attemptCommandReceipts } from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import { resolveOrganizationId } from "./baseRepo.js";

export type AttemptCommandReceiptRow =
  typeof attemptCommandReceipts.$inferSelect;

/** Persistent receipt outcome (audit §3.3 — `idempotent_replay` is never stored). */
export type AttemptCommandReceiptOutcome = "applied" | "no_change";

/** Input for {@link createAttemptCommandReceiptRepo.insertReceipt}. */
export interface InsertAttemptCommandReceiptInput {
  attemptId: string;
  operationId: string;
  commandType: AttemptCommandType;
  requestPayload: Record<string, unknown>;
  resultPayload: Record<string, unknown>;
  outcome: AttemptCommandReceiptOutcome;
  actorId: string;
  createdAt: Date;
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
   * `(created_at ASC, id ASC)` — the composite index
   * `attempt_command_receipts_org_attempt_command_created_idx` covers both the
   * filter and the tie-breaker so stable ordering is index-supported even when
   * many receipts share the same timestamp.
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
