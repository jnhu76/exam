import { randomUUID } from "node:crypto";
import type { AttemptTimeAdjustment, RequestContext } from "@exam/domain";
import { and, asc, eq, sql } from "drizzle-orm";
import { attemptTimeAdjustments } from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import { now, resolveOrganizationId } from "./baseRepo.js";

export type AttemptTimeAdjustmentRow =
  typeof attemptTimeAdjustments.$inferSelect;

export type InsertAttemptTimeAdjustmentInput = Omit<
  AttemptTimeAdjustment,
  "id" | "organizationId" | "createdAt"
>;

export function createAttemptTimeAdjustmentRepo(db: Database) {
  async function insert(
    ctx: TenantContext | RequestContext,
    adjustment: InsertAttemptTimeAdjustmentInput,
  ): Promise<AttemptTimeAdjustmentRow> {
    const rows = await db
      .insert(attemptTimeAdjustments)
      .values({
        ...adjustment,
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        createdAt: now(),
      })
      .returning();
    return rows[0]!;
  }

  async function findById(
    ctx: TenantContext | RequestContext,
    adjustmentId: string,
  ): Promise<AttemptTimeAdjustmentRow | null> {
    const rows = await db
      .select()
      .from(attemptTimeAdjustments)
      .where(
        and(
          eq(attemptTimeAdjustments.organizationId, resolveOrganizationId(ctx)),
          eq(attemptTimeAdjustments.id, adjustmentId),
        ),
      );
    return rows[0] ?? null;
  }

  async function findByOperationId(
    ctx: TenantContext | RequestContext,
    operationId: string,
  ): Promise<AttemptTimeAdjustmentRow | null> {
    const rows = await db
      .select()
      .from(attemptTimeAdjustments)
      .where(
        and(
          eq(attemptTimeAdjustments.organizationId, resolveOrganizationId(ctx)),
          eq(attemptTimeAdjustments.operationId, operationId),
        ),
      );
    return rows[0] ?? null;
  }

  async function findBoundedByInterruption(
    ctx: TenantContext | RequestContext,
    interruptionId: string,
  ): Promise<AttemptTimeAdjustmentRow | null> {
    const rows = await db
      .select()
      .from(attemptTimeAdjustments)
      .where(
        and(
          eq(attemptTimeAdjustments.organizationId, resolveOrganizationId(ctx)),
          eq(attemptTimeAdjustments.interruptionId, interruptionId),
          eq(attemptTimeAdjustments.source, "bounded_grace"),
        ),
      );
    return rows[0] ?? null;
  }

  async function listByAttempt(
    ctx: TenantContext | RequestContext,
    attemptId: string,
  ): Promise<AttemptTimeAdjustmentRow[]> {
    return db
      .select()
      .from(attemptTimeAdjustments)
      .where(
        and(
          eq(attemptTimeAdjustments.organizationId, resolveOrganizationId(ctx)),
          eq(attemptTimeAdjustments.attemptId, attemptId),
        ),
      )
      .orderBy(
        asc(attemptTimeAdjustments.createdAt),
        asc(attemptTimeAdjustments.id),
      );
  }

  async function sumBoundedGraceSeconds(
    ctx: TenantContext | RequestContext,
    attemptId: string,
  ): Promise<number> {
    const rows = await db
      .select({
        total: sql<number>`coalesce(sum(${attemptTimeAdjustments.addedSeconds}), 0)`,
      })
      .from(attemptTimeAdjustments)
      .where(
        and(
          eq(attemptTimeAdjustments.organizationId, resolveOrganizationId(ctx)),
          eq(attemptTimeAdjustments.attemptId, attemptId),
          eq(attemptTimeAdjustments.source, "bounded_grace"),
        ),
      );
    return Number(rows[0]?.total ?? 0);
  }

  return {
    insert,
    findById,
    findByOperationId,
    findBoundedByInterruption,
    listByAttempt,
    sumBoundedGraceSeconds,
  };
}
