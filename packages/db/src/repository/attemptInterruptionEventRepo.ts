import { randomUUID } from "node:crypto";
import type { AttemptInterruptionEvent, RequestContext } from "@exam/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import { attemptInterruptionEvents } from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import { resolveOrganizationId } from "./baseRepo.js";

export type AttemptInterruptionEventRow =
  typeof attemptInterruptionEvents.$inferSelect;

export type InsertAttemptInterruptionEventInput = Omit<
  AttemptInterruptionEvent,
  "id" | "organizationId" | "createdAt"
>;

export function createAttemptInterruptionEventRepo(db: Database) {
  async function insert(
    ctx: TenantContext | RequestContext,
    event: InsertAttemptInterruptionEventInput,
  ): Promise<AttemptInterruptionEventRow> {
    const rows = await db
      .insert(attemptInterruptionEvents)
      .values({
        ...event,
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
      })
      .returning();
    return rows[0]!;
  }

  async function findDetected(
    ctx: TenantContext | RequestContext,
    interruptionId: string,
  ): Promise<AttemptInterruptionEventRow | null> {
    const rows = await db
      .select()
      .from(attemptInterruptionEvents)
      .where(
        and(
          eq(
            attemptInterruptionEvents.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(attemptInterruptionEvents.interruptionId, interruptionId),
          eq(attemptInterruptionEvents.eventType, "detected"),
        ),
      );
    return rows[0] ?? null;
  }

  async function findOutcome(
    ctx: TenantContext | RequestContext,
    interruptionId: string,
  ): Promise<AttemptInterruptionEventRow | null> {
    const rows = await db
      .select()
      .from(attemptInterruptionEvents)
      .where(
        and(
          eq(
            attemptInterruptionEvents.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(attemptInterruptionEvents.interruptionId, interruptionId),
          inArray(attemptInterruptionEvents.eventType, [
            "restored",
            "terminalized",
          ]),
        ),
      );
    return rows[0] ?? null;
  }

  async function listByInterruption(
    ctx: TenantContext | RequestContext,
    interruptionId: string,
  ): Promise<AttemptInterruptionEventRow[]> {
    return db
      .select()
      .from(attemptInterruptionEvents)
      .where(
        and(
          eq(
            attemptInterruptionEvents.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(attemptInterruptionEvents.interruptionId, interruptionId),
        ),
      )
      .orderBy(
        asc(attemptInterruptionEvents.occurredAt),
        asc(attemptInterruptionEvents.id),
      );
  }

  async function listByAttempt(
    ctx: TenantContext | RequestContext,
    attemptId: string,
  ): Promise<AttemptInterruptionEventRow[]> {
    return db
      .select()
      .from(attemptInterruptionEvents)
      .where(
        and(
          eq(
            attemptInterruptionEvents.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(attemptInterruptionEvents.attemptId, attemptId),
        ),
      )
      .orderBy(
        asc(attemptInterruptionEvents.occurredAt),
        asc(attemptInterruptionEvents.id),
      );
  }

  return {
    insert,
    findDetected,
    findOutcome,
    listByInterruption,
    listByAttempt,
  };
}
