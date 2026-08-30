import { z } from "zod";

/**
 * Query contract for audit-log search/export.
 *
 * The audit search is a bounded KEYSET-cursor projection of the audit_logs
 * table: `ORDER BY (created_at DESC, id DESC)` with an opaque `cursor` that
 * encodes the snapshot upper bound plus the last-seen `(createdAt, id)` pair.
 * There is deliberately NO offset pagination here — page/pageSize were removed
 * when the route migrated to the cursor (the generic
 * {@link PaginationParamsSchema} remains for the other list endpoints that
 * still use it).
 *
 * SNAPSHOT CONSISTENCY: search, its keyset pages, and the CSV export are
 * projections of ONE audit window. The server freezes the upper bound on the
 * first page (`to` filter, else server-now), returns it as `snapshotTo`, and
 * encodes it inside every cursor it issues. A continuation page or a snapshot
 * export therefore never sees rows written after the window opened. The
 * server — not the client — owns the snapshot.
 *
 * Every search and export consumer parses the SAME {@link AuditLogFiltersSchema}
 * so a filter cannot mean different things in the page vs the CSV.
 */

/** Default page size for audit search pages. */
export const AUDIT_SEARCH_DEFAULT_LIMIT = 20;
/** Hard upper bound on a single audit search page. */
export const AUDIT_SEARCH_MAX_LIMIT = 100;
/** Hard upper bound on a single audit CSV export. */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;

/** Filter fields shared by the page query and the export query. */
const AuditLogFilterFields = {
  /** Exact-match action (closed AuditAction vocabulary, enforced at write). */
  action: z.string().min(1).max(120).optional(),
  /** Exact-match target type (e.g. `exam`, `user`). */
  targetType: z.string().min(1).max(120).optional(),
  /** Exact-match target resource id. */
  targetId: z.string().min(1).max(128).optional(),
  /** Exact-match actor (user) id. */
  actorId: z.string().min(1).max(128).optional(),
  /**
   * Inclusive lower bound on `createdAt` (ISO datetime). Re-sent on every
   * page; unlike `to` it is never frozen into the snapshot.
   */
  from: z.string().datetime().optional(),
  /**
   * Inclusive upper bound on `createdAt` (ISO datetime). On a FIRST page this
   * is the caller's filter; the server freezes it (or server-now when absent)
   * as the snapshot bound. On a CONTINUATION page the bound comes from the
   * cursor's snapshot — a re-sent `to` is ignored so a stale client echo can
   * never widen the window mid-pagination.
   */
  to: z.string().datetime().optional(),
} satisfies Record<string, z.ZodTypeAny>;

/** Shared filter schema for audit search and export. */
export const AuditLogFiltersSchema = z.object(AuditLogFilterFields);

/** Type for the shared audit filter fields. */
export type AuditLogFilters = z.infer<typeof AuditLogFiltersSchema>;

/**
 * Query schema for `GET /admin/audit-logs`: bounded keyset page.
 * `cursor` is opaque (see {@link encodeAuditCursor} / {@link decodeAuditCursor});
 * a malformed cursor is rejected by the route with 400.
 */
export const AuditLogQuerySchema = AuditLogFiltersSchema.extend({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(AUDIT_SEARCH_MAX_LIMIT)
    .default(AUDIT_SEARCH_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
});

/** Type for audit search query parameters. */
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

/**
 * Query schema for `GET /admin/audit-logs/export`. The same filter vocabulary
 * as the page, plus the optional `snapshotTo` that binds the export to the
 * SAME audit window the search pages projected (echo the search response's
 * `snapshotTo`; omit it to open a fresh window at server-now). No `limit` —
 * the export cap is the single server-owned constant
 * {@link AUDIT_EXPORT_MAX_ROWS}; exports beyond it are refused (409), never
 * truncated. No cursor — export is one bounded read of the matching rows in
 * the same `(created_at, id) DESC` order as the page.
 */
export const AuditLogExportQuerySchema = AuditLogFiltersSchema.extend({
  snapshotTo: z.string().datetime().optional(),
});

/** Type for audit export query parameters. */
export type AuditLogExportQuery = z.infer<typeof AuditLogExportQuerySchema>;

// ── Keyset cursor ────────────────────────────────────────────────────

/**
 * Cursor format: `v2|<snapshotTo ISO>|<lastCreatedAt ISO>|<audit row id>`.
 * The leading `snapshotTo` is the frozen upper bound of the audit window the
 * cursor belongs to, making the cursor self-contained: the server re-derives
 * the window from the token on every continuation page. Version-prefixed so
 * an encoding change is detected instead of silently mis-parsed (v1 cursors
 * carried no snapshot and are rejected). URL-unfriendly characters are
 * handled by the client's URLSearchParams / the server's query decoding —
 * the same convention the existing `from`/`to` ISO datetime filters already
 * rely on.
 */
export const AUDIT_CURSOR_VERSION = "v2";

/** Decoded keyset cursor — the snapshot bound plus the previous page's last row. */
export interface AuditCursor {
  /** Frozen inclusive upper bound of the audit window (ISO datetime). */
  snapshotTo: string;
  /** ISO datetime of the last-seen row's `createdAt`. */
  createdAt: string;
  /** Id of the last-seen audit row. */
  id: string;
}

const AUDIT_CURSOR_SEPARATOR = "|";
const AUDIT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isISODatetime(value: string): boolean {
  return z.string().datetime().safeParse(value).success;
}

/**
 * Encodes a snapshot bound and a row's `(createdAt, id)` into an opaque
 * cursor string.
 */
export function encodeAuditCursor(
  snapshotTo: Date | string,
  createdAt: Date | string,
  id: string,
): string {
  const toISO = (value: Date | string): string =>
    typeof value === "string" ? value : value.toISOString();
  return [AUDIT_CURSOR_VERSION, toISO(snapshotTo), toISO(createdAt), id].join(
    AUDIT_CURSOR_SEPARATOR,
  );
}

/**
 * Decodes an audit cursor. Returns `null` when the cursor is malformed
 * (wrong version, wrong segment count, non-datetime, non-uuid id) so the
 * route can answer 400 instead of 500.
 */
export function decodeAuditCursor(cursor: string): AuditCursor | null {
  const parts = cursor.split(AUDIT_CURSOR_SEPARATOR);
  if (parts.length !== 4) return null;
  const [version, snapshotTo, createdAt, id] = parts;
  if (version !== AUDIT_CURSOR_VERSION) return null;
  if (!snapshotTo || !isISODatetime(snapshotTo)) return null;
  if (!createdAt || !isISODatetime(createdAt)) return null;
  if (!id || !AUDIT_ID_PATTERN.test(id)) return null;
  return { snapshotTo, createdAt, id };
}

// ── Responses ─────────────────────────────────────────────────────────

/**
 * Response schema for a single audit log entry, recording an actor's action on a target resource.
 */
export const AuditLogResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  actorId: z.string(),
  actorName: z.string().nullable().optional(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
});

/** Type for a single audit log entry. */
export type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;

/**
 * Response schema for a keyset-paginated audit log page. `snapshotTo` is the
 * frozen inclusive upper bound of this window (the caller's `to` filter on
 * the first page, else server-now) — echo it to {@link AuditLogExportQuerySchema}
 * to export the SAME window. `nextCursor` is the opaque cursor for the NEXT
 * page (or null when this is the last page); the client never needs to decode
 * it, and the cursor carries the snapshot so continuations stay in-window.
 */
export const AuditLogPageResponseSchema = z.object({
  items: z.array(AuditLogResponseSchema),
  nextCursor: z.string().nullable(),
  snapshotTo: z.string().datetime(),
});

/** Type for an audit log page response. */
export type AuditLogPageResponse = z.infer<typeof AuditLogPageResponseSchema>;

/**
 * Response schema for a single timeline event. A timeline event is a
 * projection of an audit log entry scoped to one attempt target; the shape
 * is identical to `AuditLogResponseSchema`.
 */
export const AttemptTimelineEventSchema = AuditLogResponseSchema;

/** Type for a single timeline event. */
export type AttemptTimelineEvent = z.infer<typeof AttemptTimelineEventSchema>;

/**
 * Response schema for `GET /api/admin/attempts/:attemptId/timeline`: the
 * ordered list of audit-log events for one attempt, oldest-first.
 */
export const AttemptTimelineResponseSchema = z.object({
  events: z.array(AttemptTimelineEventSchema),
});

/** Type for the attempt timeline response. */
export type AttemptTimelineResponse = z.infer<
  typeof AttemptTimelineResponseSchema
>;
