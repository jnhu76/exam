import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { and, asc, desc, eq } from "drizzle-orm";
import { attemptInterruptions } from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import { resolveOrganizationId } from "./baseRepo.js";

export type AttemptInterruptionRow = typeof attemptInterruptions.$inferSelect;

export interface CreateAttemptInterruptionInput {
  attemptId: string;
}

export function createAttemptInterruptionRepo(db: Database) {
  async function create(
    ctx: TenantContext | RequestContext,
    input: CreateAttemptInterruptionInput,
  ): Promise<AttemptInterruptionRow> {
    const rows = await db
      .insert(attemptInterruptions)
      .values({
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        attemptId: input.attemptId,
      })
      .returning();
    return rows[0]!;
  }

  async function findById(
    ctx: TenantContext | RequestContext,
    interruptionId: string,
  ): Promise<AttemptInterruptionRow | null> {
    const rows = await db
      .select()
      .from(attemptInterruptions)
      .where(
        and(
          eq(attemptInterruptions.organizationId, resolveOrganizationId(ctx)),
          eq(attemptInterruptions.id, interruptionId),
        ),
      );
    return rows[0] ?? null;
  }

  async function findByAttempt(
    ctx: TenantContext | RequestContext,
    attemptId: string,
  ): Promise<AttemptInterruptionRow[]> {
    return db
      .select()
      .from(attemptInterruptions)
      .where(
        and(
          eq(attemptInterruptions.organizationId, resolveOrganizationId(ctx)),
          eq(attemptInterruptions.attemptId, attemptId),
        ),
      )
      .orderBy(
        asc(attemptInterruptions.createdAt),
        asc(attemptInterruptions.id),
      );
  }

  /**
   * The factory must receive the active transaction's Database handle so the
   * row lock remains held through the caller's transaction.
   */
  async function findByAttemptForUpdate(
    ctx: TenantContext | RequestContext,
    attemptId: string,
    interruptionId: string,
  ): Promise<AttemptInterruptionRow | null> {
    const rows = await db
      .select()
      .from(attemptInterruptions)
      .where(
        and(
          eq(attemptInterruptions.organizationId, resolveOrganizationId(ctx)),
          eq(attemptInterruptions.attemptId, attemptId),
          eq(attemptInterruptions.id, interruptionId),
        ),
      )
      .for("update");
    return rows[0] ?? null;
  }

  /**
   * Returns the most recent episode for an attempt by deterministic order
   * (createdAt DESC, id DESC). Used by restore idempotency reconstruction to
   * locate the latest resolved episode and validate its outcome identity.
   */
  async function findLatestByAttempt(
    ctx: TenantContext | RequestContext,
    attemptId: string,
  ): Promise<AttemptInterruptionRow | null> {
    const rows = await db
      .select()
      .from(attemptInterruptions)
      .where(
        and(
          eq(attemptInterruptions.organizationId, resolveOrganizationId(ctx)),
          eq(attemptInterruptions.attemptId, attemptId),
        ),
      )
      .orderBy(
        desc(attemptInterruptions.createdAt),
        desc(attemptInterruptions.id),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    create,
    findById,
    findByAttempt,
    findByAttemptForUpdate,
    findLatestByAttempt,
  };
}
