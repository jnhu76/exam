import { randomUUID } from "node:crypto";
import type {
  NotificationType,
  OrganizationScope,
  RequestContext,
} from "@exam/domain";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { notifications } from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import { now } from "./baseRepo.js";

/**
 * Context type accepted by notification repo methods.
 *
 * Mirrors {@link EmailRepoContext}: the publication fan-out may run inside a
 * business transaction with a `TenantContext` / `RequestContext`, while a
 * future system-side reader can pass a bare `OrganizationScope`. The recipient
 * is ALWAYS supplied explicitly per-method — it is never inferred from ctx —
 * so a system process cannot accidentally read another user's Inbox.
 */
export type NotificationRepoContext =
  | OrganizationScope
  | TenantContext
  | RequestContext;

/** Extracts organizationId from any supported context type. */
function resolveOrgId(ctx: NotificationRepoContext): string {
  return (ctx as OrganizationScope).organizationId;
}

/** Row type for a notification, mirroring the `notifications` table. */
export type NotificationRow = typeof notifications.$inferSelect;

/** Input for creating a single Inbox notification row. */
export interface CreateNotificationInput {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  actionPath?: string | null;
  dedupeKey?: string | null;
}

/** Result of an idempotent insert: the existing row when the dedupe key hit. */
export interface InsertResult {
  row: NotificationRow;
  /** True iff a NEW row was inserted (false = dedupe-key reuse). */
  created: boolean;
}

/** Optional filters for the Inbox list query. */
export interface ListOptions {
  page: number;
  pageSize: number;
  /** When true, return only rows with `read_at IS NULL`. */
  unreadOnly?: boolean;
}

/** Paginated list result. */
export interface ListResult {
  items: NotificationRow[];
  total: number;
}

/**
 * Creates a repository for the `notifications` Inbox table (P5-N1).
 *
 * All queries are scoped to `(organizationId, recipientUserId)`. The recipient
 * is passed per-method (never inferred from ctx) so a system reader cannot
 * cross user boundaries by accident.
 *
 * @param db - Drizzle database connection (may be a transaction handle).
 */
export function createNotificationRepo(db: Database) {
  /**
   * Inserts one notification row. When `dedupeKey` is set and a row with the
   * same `(organizationId, recipientUserId, dedupeKey)` already exists, the
   * insert becomes a no-op (ON CONFLICT DO NOTHING) and the existing row is
   * returned with `created: false`. This makes fan-out idempotent under
   * retry / duplicate publication triggers.
   */
  async function insert(
    ctx: NotificationRepoContext,
    input: CreateNotificationInput,
  ): Promise<InsertResult> {
    const timestamp = now();
    const id = randomUUID();
    const organizationId = resolveOrgId(ctx);
    const dedupeKey = input.dedupeKey ?? null;

    // ON CONFLICT DO NOTHING: PostgreSQL uses unique-index inference to pick
    // the partial UNIQUE (organization_id, recipient_user_id, dedupe_key)
    // WHERE dedupe_key IS NOT NULL. Omitting an explicit target lets Postgres
    // infer from any matching unique index; rows without a dedupe key never
    // conflict (the partial index excludes them).
    const inserted = await db
      .insert(notifications)
      .values({
        id,
        organizationId,
        recipientUserId: input.recipientUserId,
        type: input.type,
        title: input.title,
        body: input.body,
        actionPath: input.actionPath ?? null,
        createdAt: timestamp,
        readAt: null,
        dedupeKey,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length > 0) {
      return { row: inserted[0]!, created: true };
    }

    // Conflict: a row with the same (org, recipient, dedupeKey) already exists.
    // Re-read it scoped to the recipient so the caller gets the existing row.
    const existing = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          eq(notifications.recipientUserId, input.recipientUserId),
          eq(notifications.dedupeKey, dedupeKey!),
        ),
      );
    if (existing.length === 0) {
      // Should not happen: ON CONFLICT DO NOTHING fired, so a row must exist.
      throw new Error(
        "notification insert returned no row but no dedupe match found",
      );
    }
    return { row: existing[0]!, created: false };
  }

  /**
   * Inserts many notification rows in a single statement, idempotent per row
   * via ON CONFLICT DO NOTHING. Used by the publication fan-out. Returns the
   * number of rows actually inserted (existing rows are not re-counted).
   *
   * Note: callers that need to know which recipients got a NEW row vs. an
   * existing one should call {@link insert} per recipient. The fan-out uses
   * this batch path because it does not need that distinction.
   */
  async function insertMany(
    ctx: NotificationRepoContext,
    inputs: CreateNotificationInput[],
  ): Promise<{ insertedCount: number }> {
    if (inputs.length === 0) return { insertedCount: 0 };
    const organizationId = resolveOrgId(ctx);
    const timestamp = now();
    const rows = inputs.map((input) => ({
      id: randomUUID(),
      organizationId,
      recipientUserId: input.recipientUserId,
      type: input.type,
      title: input.title,
      body: input.body,
      actionPath: input.actionPath ?? null,
      createdAt: timestamp,
      readAt: null,
      dedupeKey: input.dedupeKey ?? null,
    }));
    const inserted = await db
      .insert(notifications)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    return { insertedCount: inserted.length };
  }

  /**
   * Lists a recipient's Inbox page. Stable order: `created_at DESC, id DESC`.
   * When `unreadOnly` is true, only rows with `read_at IS NULL` are returned.
   * Always scoped to `(organizationId, recipientUserId)`.
   */
  async function list(
    ctx: NotificationRepoContext,
    recipientUserId: string,
    opts: ListOptions,
  ): Promise<ListResult> {
    const organizationId = resolveOrgId(ctx);
    const offset = (opts.page - 1) * opts.pageSize;
    const where = and(
      eq(notifications.organizationId, organizationId),
      eq(notifications.recipientUserId, recipientUserId),
      ...(opts.unreadOnly ? [isNull(notifications.readAt)] : []),
    );
    const items = await db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(opts.pageSize)
      .offset(offset);
    const totalRows = await db
      .select({ value: count() })
      .from(notifications)
      .where(where);
    const total = Number(totalRows[0]?.value ?? 0);
    return { items, total };
  }

  /**
   * Counts unread notifications for a recipient (`read_at IS NULL`), scoped
   * to `(organizationId, recipientUserId)`.
   */
  async function countUnread(
    ctx: NotificationRepoContext,
    recipientUserId: string,
  ): Promise<number> {
    const organizationId = resolveOrgId(ctx);
    const rows = await db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          eq(notifications.recipientUserId, recipientUserId),
          isNull(notifications.readAt),
        ),
      );
    return Number(rows[0]?.value ?? 0);
  }

  /**
   * Marks a single notification read for a recipient. Returns the updated row
   * on success, or `null` when the row does not exist OR belongs to another
   * recipient / organization (anti-enumeration: same result for missing and
   * foreign). Idempotent: a repeat call on an already-read row is a 200 no-op
   * that returns the row unchanged.
   */
  async function markRead(
    ctx: NotificationRepoContext,
    recipientUserId: string,
    notificationId: string,
  ): Promise<NotificationRow | null> {
    const organizationId = resolveOrgId(ctx);
    const [updated] = await db
      .update(notifications)
      .set({ readAt: now() })
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          eq(notifications.recipientUserId, recipientUserId),
          eq(notifications.id, notificationId),
          isNull(notifications.readAt),
        ),
      )
      .returning();
    if (updated) return updated;
    // No row updated: either already-read, missing, or foreign. Re-read to
    // distinguish "already read" (return the row, idempotent) from
    // "missing/foreign" (return null, anti-enumeration).
    const existing = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          eq(notifications.recipientUserId, recipientUserId),
          eq(notifications.id, notificationId),
        ),
      );
    return existing[0] ?? null;
  }

  /**
   * Marks all unread notifications read for a recipient, scoped to
   * `(organizationId, recipientUserId)`. Returns the number of rows updated.
   */
  async function markAllRead(
    ctx: NotificationRepoContext,
    recipientUserId: string,
  ): Promise<number> {
    const organizationId = resolveOrgId(ctx);
    const result = await db
      .update(notifications)
      .set({ readAt: now() })
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          eq(notifications.recipientUserId, recipientUserId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return result.length;
  }

  // `asc` is intentionally NOT imported: V1 Inbox order is always
  // created_at DESC, id DESC. A future admin ascending view can add it.

  return {
    insert,
    insertMany,
    list,
    countUnread,
    markRead,
    markAllRead,
  };
}

/** Repository type for the notifications Inbox table. */
export type NotificationRepo = ReturnType<typeof createNotificationRepo>;
