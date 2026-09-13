import { randomUUID } from "node:crypto";
import type { AttemptInterruptionEvent, RequestContext } from "@exam/domain";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  attemptInterruptionEvents,
  attemptInterruptions,
  examAttempts,
} from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import { resolveOrganizationId } from "./baseRepo.js";

export type AttemptInterruptionEventRow =
  typeof attemptInterruptionEvents.$inferSelect;

export type InsertAttemptInterruptionEventInput = Omit<
  AttemptInterruptionEvent,
  "id" | "organizationId" | "createdAt"
>;

/**
 * Durable fact set of one committed heartbeat-detected episode, joined with
 * the attempt identity the System incident is derived from (#304 F3/F4A).
 */
export interface HeartbeatDetectedEpisodeRow {
  interruptionId: string;
  attemptId: string;
  examId: string;
  candidateId: string | null;
  occurredAt: Date;
  observedLastActivityAt: Date | null;
  timeoutSeconds: number | null;
}

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

  /**
   * Returns the latest outcome event (restored|terminalized) across all of an
   * attempt's episodes, ordered deterministically by
   * (occurredAt DESC, createdAt DESC, id DESC) so the result is stable even
   * when multiple outcomes share the same occurredAt timestamp.
   *
   * Used by restore idempotency reconstruction to locate the most recent
   * committed outcome and validate its identity against the latest episode.
   */
  async function findLatestOutcomeByAttempt(
    ctx: TenantContext | RequestContext,
    attemptId: string,
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
          eq(attemptInterruptionEvents.attemptId, attemptId),
          inArray(attemptInterruptionEvents.eventType, [
            "restored",
            "terminalized",
          ]),
        ),
      )
      .orderBy(
        desc(attemptInterruptionEvents.occurredAt),
        desc(attemptInterruptionEvents.createdAt),
        desc(attemptInterruptionEvents.id),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Durable-ledger discovery for the System incident reconciliation leg
   * (#304 F4A): every committed heartbeat-detected episode of the
   * organization, oldest first. Deliberately NOT filtered by completion —
   * the completion probe is the caller's batch check against the
   * `exam_incident_events` operation-unique arbiter (the episode id cannot
   * be turned into its UUID-v5 operationId inside SQL). The read grows with
   * the organization's total episode count, which is the accepted LAN-scale
   * cost of keeping the reconciliation stateless per cycle and the arbiter
   * the single completion authority; if that ever outgrows the deployment
   * profile, bounded discovery needs its own explicit authority decision.
   */
  async function listHeartbeatDetectedEpisodes(
    ctx: TenantContext | RequestContext,
  ): Promise<HeartbeatDetectedEpisodeRow[]> {
    return db
      .select({
        interruptionId: attemptInterruptionEvents.interruptionId,
        attemptId: attemptInterruptions.attemptId,
        examId: examAttempts.examId,
        candidateId: examAttempts.candidateId,
        occurredAt: attemptInterruptionEvents.occurredAt,
        observedLastActivityAt:
          attemptInterruptionEvents.observedLastActivityAt,
        timeoutSeconds: attemptInterruptionEvents.timeoutSeconds,
      })
      .from(attemptInterruptionEvents)
      .innerJoin(
        attemptInterruptions,
        and(
          eq(attemptInterruptions.id, attemptInterruptionEvents.interruptionId),
          eq(
            attemptInterruptions.organizationId,
            attemptInterruptionEvents.organizationId,
          ),
        ),
      )
      .innerJoin(
        examAttempts,
        and(
          eq(examAttempts.id, attemptInterruptions.attemptId),
          eq(examAttempts.organizationId, attemptInterruptions.organizationId),
        ),
      )
      .where(
        and(
          eq(
            attemptInterruptionEvents.organizationId,
            resolveOrganizationId(ctx),
          ),
          eq(attemptInterruptionEvents.eventType, "detected"),
          eq(attemptInterruptionEvents.detectionSource, "heartbeat_timeout"),
        ),
      )
      .orderBy(
        asc(attemptInterruptionEvents.occurredAt),
        asc(attemptInterruptionEvents.interruptionId),
      );
  }

  return {
    insert,
    findDetected,
    findOutcome,
    listByInterruption,
    listByAttempt,
    findLatestOutcomeByAttempt,
    listHeartbeatDetectedEpisodes,
  };
}
