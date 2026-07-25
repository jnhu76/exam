import { randomUUID } from "node:crypto";
import type {
  EmailOutboxRow,
  EmailOutboxStatus,
  EmailType,
  OrganizationScope,
} from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { and, asc, count, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { emailOutbox } from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { now, resolveOrganizationId } from "./baseRepo.js";
import { executeInTransaction } from "../types.js";

/** Input for creating a new email outbox row. */
export interface CreateEmailOutboxInput {
  type: EmailType;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  maxAttempts: number;
  dedupeKey?: string | null;
}

/** Context type accepted by email outbox repo methods. */
export type EmailRepoContext =
  | OrganizationScope
  | TenantContext
  | RequestContext;

/** Extracts organizationId from any supported context type. */
function resolveOrgId(ctx: EmailRepoContext): string {
  return (ctx as OrganizationScope).organizationId;
}

/** Result of a claim operation. */
export interface ClaimResult {
  claimed: EmailOutboxRow[];
  totalClaimed: number;
}

/**
 * Creates a repository for the `email_outbox` table (P5-0 delivery runtime).
 *
 * The outbox is a persistent email queue: business transactions INSERT rows,
 * and a worker later claims due rows atomically using `FOR UPDATE SKIP LOCKED`.
 * All queries are scoped to the caller's `organizationId`.
 *
 * This repository accepts `OrganizationScope | TenantContext | RequestContext`
 * so that the email worker (a system process without an authenticated user) can
 * use it without fabricating a fake Admin context.
 *
 * @param db - Drizzle database connection.
 */
export function createEmailOutboxRepo(db: Database) {
  /**
   * Maps a raw snake_case database row (from raw SQL) to an EmailOutboxRow.
   * Validates nullable fields according to the state model — does not silently
   * substitute defaults for malformed data.
   */
  function mapRow(raw: Record<string, unknown>): EmailOutboxRow {
    const status = raw.status as EmailOutboxStatus;
    return {
      id: raw.id as string,
      organizationId: raw.organization_id as string,
      type: raw.type as EmailType,
      recipientEmail: raw.recipient_email as string,
      subject: raw.subject as string,
      bodyText: raw.body_text as string,
      bodyHtml: (raw.body_html as string | null) ?? null,
      status,
      attemptCount: Number(raw.attempt_count),
      maxAttempts: Number(raw.max_attempts),
      lockedAt: raw.locked_at ? new Date(raw.locked_at as string) : null,
      lockedBy: (raw.locked_by as string | null) ?? null,
      providerMessageId: (raw.provider_message_id as string | null) ?? null,
      dedupeKey: (raw.dedupe_key as string | null) ?? null,
      lastError: (raw.last_error as string | null) ?? null,
      nextAttemptAt: raw.next_attempt_at
        ? new Date(raw.next_attempt_at as string)
        : null,
      sentAt: raw.sent_at ? new Date(raw.sent_at as string) : null,
      createdAt: new Date(raw.created_at as string),
      updatedAt: new Date(raw.updated_at as string),
    };
  }

  /**
   * Inserts a new outbox row in `pending` status with `attemptCount = 0` and
   * no `sentAt` / `nextAttemptAt` / `lastError` / lock fields. Returns the
   * created row.
   */
  async function create(
    ctx: EmailRepoContext,
    input: CreateEmailOutboxInput,
  ): Promise<EmailOutboxRow> {
    const timestamp = now();
    const id = randomUUID();
    const status: EmailOutboxStatus = "pending";
    const row = {
      id,
      organizationId: resolveOrgId(ctx),
      type: input.type,
      recipientEmail: input.recipientEmail,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml ?? null,
      status,
      attemptCount: 0,
      maxAttempts: input.maxAttempts,
      lockedAt: null,
      lockedBy: null,
      providerMessageId: null,
      dedupeKey: input.dedupeKey ?? null,
      lastError: null,
      nextAttemptAt: null,
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
   * Finds the most recently sent row for the organization. Used by diagnostics
   * to derive `lastSuccessfulDeliveryAt`. Returns null if no sent rows exist.
   */
  async function findLastSent(
    ctx: EmailRepoContext,
    limit: number,
  ): Promise<EmailOutboxRow | null> {
    const rows = await db
      .select()
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.organizationId, resolveOrgId(ctx)),
          eq(emailOutbox.status, "sent"),
        ),
      )
      .orderBy(desc(emailOutbox.sentAt), desc(emailOutbox.id))
      .limit(limit);
    return (rows[0] as EmailOutboxRow | undefined) ?? null;
  }

  /**
   * Finds a single outbox row by id, scoped to the organization.
   * Returns `null` if not found or outside the organization boundary.
   */
  async function findById(
    ctx: EmailRepoContext,
    id: string,
  ): Promise<EmailOutboxRow | null> {
    const rows = await db
      .select()
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.organizationId, resolveOrgId(ctx)),
          eq(emailOutbox.id, id),
        ),
      );
    return (rows[0] as EmailOutboxRow | undefined) ?? null;
  }

  /**
   * Returns up to `limit` due `pending` rows for the organization: rows whose
   * `nextAttemptAt` is null (never tried / first attempt) or in the past
   * (`<= now`). Ordered oldest-first by `createdAt` so earlier enqueues are
   * sent first. This is a read-only query (no locking).
   */
  async function findDuePending(
    ctx: EmailRepoContext,
    nowDate: Date,
    limit: number,
  ): Promise<EmailOutboxRow[]> {
    const rows = await db
      .select()
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.organizationId, resolveOrgId(ctx)),
          eq(emailOutbox.status, "pending"),
          or(
            isNull(emailOutbox.nextAttemptAt),
            lte(emailOutbox.nextAttemptAt, nowDate),
          ),
        ),
      )
      .orderBy(asc(emailOutbox.createdAt), asc(emailOutbox.id))
      .limit(limit);
    return rows as EmailOutboxRow[];
  }

  /**
   * Atomically claims up to `batchSize` due rows for processing.
   *
   * Uses a CTE + FOR UPDATE SKIP LOCKED + UPDATE RETURNING in one atomic
   * PostgreSQL statement. Parameterized SQL is used because the locked CTE
   * composition is easier to review and verify as one explicit statement
   * than the Drizzle query builder equivalent.
   *
   * Executes in READ COMMITTED isolation (via the caller's transaction):
   * - each claim transaction is short-lived
   * - READ COMMITTED matches queue-consumer semantics
   * - concurrent committed state is visible to each new claim
   * - SKIP LOCKED supplies row-level work distribution
   *
   * @param organizationId - The organization to claim rows for.
   * @param now - Current time (bound parameter).
   * @param workerInstanceId - Unique identifier for this worker instance.
   * @param batchSize - Maximum number of rows to claim (validated > 0).
   * @returns The claimed rows.
   */
  async function claimDue(
    ctx: EmailRepoContext,
    nowDate: Date,
    workerInstanceId: string,
    batchSize: number,
  ): Promise<EmailOutboxRow[]> {
    const orgId = resolveOrgId(ctx);

    if (batchSize <= 0 || !Number.isFinite(batchSize)) {
      throw new Error(`batchSize must be a positive integer, got ${batchSize}`);
    }

    const result = await executeInTransaction(
      db,
      async (tx) => {
        // Pass the timestamp as a bound parameter and cast to timestamptz.
        // This is fully parameterized — no string interpolation of user input.
        const tsParam = sql`${nowDate.toISOString()}::timestamptz`;

        const rows = tx.execute<Record<string, unknown>>(
          sql`
            WITH candidates AS (
              SELECT id
              FROM email_outbox
              WHERE organization_id = ${orgId}
                AND (
                  status = 'pending'
                  OR (
                    status = 'retry_wait'
                    AND next_attempt_at <= ${tsParam}
                  )
                )
              ORDER BY created_at ASC, id ASC
              LIMIT ${batchSize}
              FOR UPDATE SKIP LOCKED
            )
            UPDATE email_outbox AS outbox
            SET
              status = 'processing',
              locked_at = ${tsParam},
              locked_by = ${workerInstanceId},
              attempt_count = outbox.attempt_count + 1,
              updated_at = ${tsParam}
            FROM candidates
            WHERE outbox.id = candidates.id
            RETURNING outbox.*;
          `,
        );
        return rows;
      },
      "read committed",
    );

    return result.map(mapRow);
  }

  /**
   * Recovers abandoned `processing` rows: rows locked longer than `lockTimeoutMs`
   * ago are returned to `pending` status and their lock fields are cleared.
   * Returns the number of recovered rows.
   */
  async function recoverAbandoned(
    ctx: EmailRepoContext,
    nowDate: Date,
    lockTimeoutMs: number,
  ): Promise<number> {
    const orgId = resolveOrgId(ctx);
    const cutoff = new Date(nowDate.getTime() - lockTimeoutMs);

    const result = await db
      .update(emailOutbox)
      .set({
        status: "pending",
        lockedAt: null,
        lockedBy: null,
        updatedAt: nowDate,
      })
      .where(
        and(
          eq(emailOutbox.organizationId, orgId),
          eq(emailOutbox.status, "processing"),
          lte(emailOutbox.lockedAt, cutoff),
        ),
      );
    return result.count ?? 0;
  }

  /**
   * Marks a processing row as `sent`. Sets the terminal status, sent timestamp,
   * provider message ID, and clears lock fields and nextAttemptAt.
   *
   * Ownership-fenced: only succeeds if the row is still `processing` and locked
   * by the given `workerInstanceId`. Returns `null` if ownership was lost
   * (another worker recovered and re-claimed the row) or the row doesn't exist.
   */
  async function markSent(
    ctx: EmailRepoContext,
    id: string,
    sentAt: Date,
    providerMessageId: string | null,
    workerInstanceId: string,
  ): Promise<EmailOutboxRow | null> {
    const [updated] = await db
      .update(emailOutbox)
      .set({
        status: "sent",
        sentAt,
        providerMessageId,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null,
        updatedAt: now(),
      })
      .where(
        and(
          eq(emailOutbox.organizationId, resolveOrgId(ctx)),
          eq(emailOutbox.id, id),
          eq(emailOutbox.status, "processing"),
          eq(emailOutbox.lockedBy, workerInstanceId),
        ),
      )
      .returning();
    return (updated as EmailOutboxRow | undefined) ?? null;
  }

  /**
   * Marks a processing row as `retry_wait`: increments attemptCount, records
   * the sanitized `lastError`, sets `nextAttemptAt`, clears lock fields, and
   * sets status to `retry_wait`. The caller supplies the post-increment
   * `attemptCount` value and the computed retry time so retry arithmetic lives
   * in one testable place (`computeNextRetryAt`).
   *
   * Ownership-fenced: only succeeds if the row is still `processing` and locked
   * by the given `workerInstanceId`. Returns `null` if ownership was lost.
   */
  async function markRetryWait(
    ctx: EmailRepoContext,
    id: string,
    attemptCount: number,
    lastError: string,
    nextAttemptAt: Date,
    workerInstanceId: string,
  ): Promise<EmailOutboxRow | null> {
    const [updated] = await db
      .update(emailOutbox)
      .set({
        status: "retry_wait",
        attemptCount,
        lastError,
        nextAttemptAt,
        lockedAt: null,
        lockedBy: null,
        updatedAt: now(),
      })
      .where(
        and(
          eq(emailOutbox.organizationId, resolveOrgId(ctx)),
          eq(emailOutbox.id, id),
          eq(emailOutbox.status, "processing"),
          eq(emailOutbox.lockedBy, workerInstanceId),
        ),
      )
      .returning();
    return (updated as EmailOutboxRow | undefined) ?? null;
  }

  /**
   * Marks a processing row as terminal `dead`: sets attemptCount, records the
   * sanitized `lastError`, sets status to `dead`, clears lock fields and
   * `nextAttemptAt`. Used when the send fails and `attemptCount` has reached
   * `maxAttempts`.
   *
   * Ownership-fenced: only succeeds if the row is still `processing` and locked
   * by the given `workerInstanceId`. Returns `null` if ownership was lost.
   */
  async function markDead(
    ctx: EmailRepoContext,
    id: string,
    attemptCount: number,
    lastError: string,
    workerInstanceId: string,
  ): Promise<EmailOutboxRow | null> {
    const [updated] = await db
      .update(emailOutbox)
      .set({
        status: "dead",
        attemptCount,
        lastError,
        nextAttemptAt: null,
        lockedAt: null,
        lockedBy: null,
        updatedAt: now(),
      })
      .where(
        and(
          eq(emailOutbox.organizationId, resolveOrgId(ctx)),
          eq(emailOutbox.id, id),
          eq(emailOutbox.status, "processing"),
          eq(emailOutbox.lockedBy, workerInstanceId),
        ),
      )
      .returning();
    return (updated as EmailOutboxRow | undefined) ?? null;
  }

  /**
   * Counts outbox rows grouped by status, scoped to the caller's organization.
   * Used by the diagnostics surface. Always returns all keys (zero when no rows
   * of that status exist).
   */
  async function countByStatus(ctx: EmailRepoContext): Promise<{
    pending: number;
    processing: number;
    retryWait: number;
    sent: number;
    dead: number;
  }> {
    const rows = await db
      .select({ status: emailOutbox.status, n: count() })
      .from(emailOutbox)
      .where(eq(emailOutbox.organizationId, resolveOrgId(ctx)))
      .groupBy(emailOutbox.status);
    const counts = {
      pending: 0,
      processing: 0,
      retryWait: 0,
      sent: 0,
      dead: 0,
    };
    for (const row of rows) {
      if (row.status === "pending") counts.pending = Number(row.n);
      else if (row.status === "processing") counts.processing = Number(row.n);
      else if (row.status === "retry_wait") counts.retryWait = Number(row.n);
      else if (row.status === "sent") counts.sent = Number(row.n);
      else if (row.status === "dead") counts.dead = Number(row.n);
    }
    return counts;
  }

  return {
    create,
    findById,
    findDuePending,
    findLastSent,
    claimDue,
    recoverAbandoned,
    markSent,
    markRetryWait,
    markDead,
    countByStatus,
  };
}

export type EmailOutboxRepo = ReturnType<typeof createEmailOutboxRepo>;
