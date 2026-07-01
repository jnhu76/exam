import { randomUUID } from "node:crypto";
import type {
  EmailOutboxRow,
  EmailOutboxStatus,
  EmailType,
} from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { and, asc, count, eq, isNull, lte, or } from "drizzle-orm";
import { emailOutbox } from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { now, resolveOrganizationId } from "./baseRepo.js";

/** Input for creating a new email outbox row. */
export interface CreateEmailOutboxInput {
  type: EmailType;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  maxAttempts: number;
}

/** Select row type for the `email_outbox` table. */
type EmailOutboxSelect = typeof emailOutbox.$inferSelect;

/**
 * Creates a repository for the `email_outbox` table.
 *
 * The outbox is a persistent email queue: business transactions INSERT rows,
 * and a worker (`EmailOutboxService.processDueEmails`) later queries due
 * `pending` rows and sends them. All queries are scoped to the caller's
 * `organizationId` (the single-tenant data boundary).
 *
 * `now` for storage timestamps comes from {@link baseRepo.now} (non-business
 * storage stamps, allowlisted under ADR-006); `nextRetryAt` / `sentAt` are
 * passed explicitly by the caller so retry arithmetic stays deterministic and
 * testable.
 *
 * @param db - Drizzle database connection.
 */
export function createEmailOutboxRepo(db: Database) {
  /**
   * Inserts a new outbox row in `pending` status with `attempts = 0` and no
   * `sentAt` / `nextRetryAt` / `lastError`. Returns the created row.
   */
  async function create(
    ctx: TenantContext | RequestContext,
    input: CreateEmailOutboxInput,
  ): Promise<EmailOutboxRow> {
    const timestamp = now();
    const id = randomUUID();
    const status: EmailOutboxStatus = "pending";
    const row = {
      id,
      organizationId: resolveOrganizationId(ctx),
      type: input.type,
      recipientEmail: input.recipientEmail,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml ?? null,
      status,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      lastError: null,
      nextRetryAt: null,
      sentAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const [created] = await db.insert(emailOutbox).values(row).returning();
    if (!created) {
      throw new NotFoundError("Failed to read back created email outbox row");
    }
    return created;
  }

  /**
   * Finds a single outbox row by id, scoped to the tenant's organization.
   * Returns `null` if not found or outside the tenant boundary.
   */
  async function findById(
    ctx: TenantContext | RequestContext,
    id: string,
  ): Promise<EmailOutboxRow | null> {
    const rows = await db
      .select()
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.organizationId, resolveOrganizationId(ctx)),
          eq(emailOutbox.id, id),
        ),
      );
    return (rows[0] as EmailOutboxSelect | undefined) ?? null;
  }

  /**
   * Returns up to `limit` due `pending` rows for the tenant: rows whose
   * `nextRetryAt` is null (never tried / first attempt) or in the past
   * (`<= now`). Ordered oldest-first by `createdAt` so earlier enqueues are
   * sent first. This is the worker's primary query.
   */
  async function findDuePending(
    ctx: TenantContext | RequestContext,
    nowDate: Date,
    limit: number,
  ): Promise<EmailOutboxRow[]> {
    const rows = await db
      .select()
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.organizationId, resolveOrganizationId(ctx)),
          eq(emailOutbox.status, "pending"),
          or(
            isNull(emailOutbox.nextRetryAt),
            lte(emailOutbox.nextRetryAt, nowDate),
          ),
        ),
      )
      .orderBy(asc(emailOutbox.createdAt), asc(emailOutbox.id))
      .limit(limit);
    return rows as EmailOutboxRow[];
  }

  /**
   * Marks a row as `sent`: sets `status`, `sentAt`, and `nextRetryAt = null`.
   * The terminal send timestamp is supplied by the caller (deterministic).
   * Returns the updated row or `null` if not found / outside tenant.
   */
  async function markSent(
    ctx: TenantContext | RequestContext,
    id: string,
    sentAt: Date,
  ): Promise<EmailOutboxRow | null> {
    const [updated] = await db
      .update(emailOutbox)
      .set({
        status: "sent",
        sentAt,
        nextRetryAt: null,
        updatedAt: now(),
      })
      .where(
        and(
          eq(emailOutbox.organizationId, resolveOrganizationId(ctx)),
          eq(emailOutbox.id, id),
        ),
      )
      .returning();
    return (updated as EmailOutboxRow | undefined) ?? null;
  }

  /**
   * Marks a row for retry: increments `attempts`, records the sanitized
   * `lastError`, sets `nextRetryAt`, and keeps `status = pending`. The caller
   * supplies the post-increment `attempts` value and the computed retry time
   * so retry arithmetic lives in one testable place (`computeNextRetryAt`).
   */
  async function markRetryScheduled(
    ctx: TenantContext | RequestContext,
    id: string,
    attempts: number,
    lastError: string,
    nextRetryAt: Date,
  ): Promise<EmailOutboxRow | null> {
    const [updated] = await db
      .update(emailOutbox)
      .set({
        status: "pending",
        attempts,
        lastError,
        nextRetryAt,
        updatedAt: now(),
      })
      .where(
        and(
          eq(emailOutbox.organizationId, resolveOrganizationId(ctx)),
          eq(emailOutbox.id, id),
        ),
      )
      .returning();
    return (updated as EmailOutboxRow | undefined) ?? null;
  }

  /**
   * Marks a row as terminal `failed`: increments `attempts`, records the
   * sanitized `lastError`, sets `status = failed`, and clears `nextRetryAt`.
   * Used when the send fails and `attempts` has reached `maxAttempts`.
   */
  async function markFailed(
    ctx: TenantContext | RequestContext,
    id: string,
    attempts: number,
    lastError: string,
  ): Promise<EmailOutboxRow | null> {
    const [updated] = await db
      .update(emailOutbox)
      .set({
        status: "failed",
        attempts,
        lastError,
        nextRetryAt: null,
        updatedAt: now(),
      })
      .where(
        and(
          eq(emailOutbox.organizationId, resolveOrganizationId(ctx)),
          eq(emailOutbox.id, id),
        ),
      )
      .returning();
    return (updated as EmailOutboxRow | undefined) ?? null;
  }

  /**
   * Counts outbox rows grouped by status, scoped to the caller's
   * organization. Used by the diagnostics surface to surface pending/sent/
   * failed totals without exposing row content. Always returns all three
   * keys (zero when no rows of that status exist).
   */
  async function countByStatus(
    ctx: TenantContext | RequestContext,
  ): Promise<{ pending: number; sent: number; failed: number }> {
    const rows = await db
      .select({ status: emailOutbox.status, n: count() })
      .from(emailOutbox)
      .where(eq(emailOutbox.organizationId, resolveOrganizationId(ctx)))
      .groupBy(emailOutbox.status);
    const counts = { pending: 0, sent: 0, failed: 0 };
    for (const row of rows) {
      if (
        row.status === "pending" ||
        row.status === "sent" ||
        row.status === "failed"
      ) {
        counts[row.status] = Number(row.n);
      }
    }
    return counts;
  }

  return {
    create,
    findById,
    findDuePending,
    markSent,
    markRetryScheduled,
    markFailed,
    countByStatus,
  };
}

export type EmailOutboxRepo = ReturnType<typeof createEmailOutboxRepo>;
