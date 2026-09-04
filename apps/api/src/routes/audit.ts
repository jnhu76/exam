import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import {
  AuditActionMetadataResponseSchema,
  AuditLogExportQuerySchema,
  AuditLogPageResponseSchema,
  AuditLogQuerySchema,
  AUDIT_EXPORT_MAX_ROWS,
  ErrorResponseSchema,
  decodeAuditCursor,
  encodeAuditCursor,
} from "@exam/contracts";
import type { AuditLogFilters } from "@exam/contracts";
import { AuditAction, Permission, type AuditActionKey } from "@exam/authz";
import {
  createAuditLogQueryRepo,
  type AuditLogRowWithActor,
} from "@exam/db/src/repository/auditLogRepo.js";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { generateCSV } from "@exam/import-export";
import { recordSensitiveReadAudit } from "../audit/auditWriter.js";
import { AUDIT_ACTION_DEFINITIONS } from "../audit/auditPolicy.js";

/** OpenAPI security definition for cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/** Route params for `GET /admin/users/:id/effective-authority`. */
const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Builds the repository filter from the shared search/export query fields.
 * `from`/`to` arrive as ISO datetime strings and are parsed to JS `Date` here
 * — the SAME filter object feeds both the page query and the CSV export so a
 * filter can never mean different things in the two serializations.
 */
function buildAuditFilter(query: AuditLogFilters): {
  action?: string;
  targetType?: string;
  targetId?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
} {
  const filter: {
    action?: string;
    targetType?: string;
    targetId?: string;
    actorId?: string;
    from?: Date;
    to?: Date;
  } = {};
  if (query.action) filter.action = query.action;
  if (query.targetType) filter.targetType = query.targetType;
  if (query.targetId) filter.targetId = query.targetId;
  if (query.actorId) filter.actorId = query.actorId;
  if (query.from) filter.from = new Date(query.from);
  if (query.to) filter.to = new Date(query.to);
  return filter;
}

/** Projects one audit row into the shared `AuditLogResponseSchema` shape. */
function toAuditLogResponse(row: AuditLogRowWithActor) {
  return {
    id: row.auditLog.id,
    organizationId: row.auditLog.organizationId,
    actorId: row.auditLog.actorId,
    actorName: row.actorName,
    action: row.auditLog.action,
    targetType: row.auditLog.targetType,
    targetId: row.auditLog.targetId,
    metadata: row.auditLog.metadata,
    ipAddress: row.auditLog.ipAddress,
    userAgent: row.auditLog.userAgent,
    createdAt: row.auditLog.createdAt.toISOString(),
  };
}

/**
 * CSV export columns. Deliberately NOT the raw metadata JSON: the
 * metadata payload can embed PII (e.g. `email` in user.invited) and has no
 * stable column shape. Export carries safe operational fields only — the same
 * redaction rule as the underlying audit data (no secrets, no plaintext
 * credentials, no raw personal payloads).
 */
const EXPORT_HEADERS = [
  // i18n-copy-allow: data-format — CSV export header/value data contract
  "时间",
  // i18n-copy-allow: data-format — CSV export header/value data contract
  "操作",
  // i18n-copy-allow: data-format — CSV export header/value data contract
  "操作者",
  // i18n-copy-allow: data-format — CSV export header/value data contract
  "操作者ID",
  // i18n-copy-allow: data-format — CSV export header/value data contract
  "对象类型",
  // i18n-copy-allow: data-format — CSV export header/value data contract
  "对象ID",
  // i18n-copy-allow: data-format — CSV export header/value data contract
  "IP地址",
  // i18n-copy-allow: data-format — CSV export header/value data contract
  "请求ID",
] as const;

function toExportRow(row: AuditLogRowWithActor): Record<string, unknown> {
  const metadata = row.auditLog.metadata ?? {};
  return {
    时间: row.auditLog.createdAt.toISOString(),
    操作: row.auditLog.action,
    操作者: row.actorName ?? "",
    操作者ID: row.auditLog.actorId,
    对象类型: row.auditLog.targetType,
    对象ID: row.auditLog.targetId,
    IP地址: row.auditLog.ipAddress ?? "",
    请求ID: typeof metadata.requestId === "string" ? metadata.requestId : "",
  };
}

/**
 * Fastify plugin that registers the audit routes:
 *   - `GET /admin/audit-logs`            — bounded keyset search (cursor)
 *   - `GET /admin/audit-logs/export`     — bounded CSV export of the SAME query
 *   - `GET /admin/audit-log/actions`     — active action vocabulary for the UI
 */
const auditRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /admin/audit-logs
   *
   * Bounded keyset-paginated audit log search for the current organization.
   * Ordered `(created_at DESC, id DESC)`; `nextCursor` is opaque and encodes
   * the last row of the page (the client never decodes it). A malformed
   * cursor is rejected with 400 INVALID_CURSOR.
   */
  fastify.get(
    "/admin/audit-logs",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AuditLogView),
      ],
      schema: {
        querystring: AuditLogQuerySchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: AuditLogPageResponseSchema, 400: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const query = AuditLogQuerySchema.parse(request.query);
      const repo = createAuditLogQueryRepo(fastify.db);

      // SNAPSHOT: the server owns the audit window's upper bound. A first
      // page freezes it (`to` filter, else server-now) and returns it as
      // `snapshotTo`; a continuation page takes it from the cursor so rows
      // written mid-pagination never appear, and a stale client-echoed `to`
      // can never widen the window back open.
      let after: { createdAt: Date; id: string } | undefined;
      let snapshotTo: Date;
      if (query.cursor) {
        const decoded = decodeAuditCursor(query.cursor);
        if (!decoded) {
          return reply
            .code(400)
            .send(buildErrorResponse(request.id, "INVALID_CURSOR"));
        }
        after = { createdAt: new Date(decoded.createdAt), id: decoded.id };
        snapshotTo = new Date(decoded.snapshotTo);
      } else {
        snapshotTo = query.to ? new Date(query.to) : new Date();
      }

      const filter = buildAuditFilter(query);
      filter.to = snapshotTo;

      const { items, hasMore } = await repo.listKeysetFiltered(ctx, {
        limit: query.limit,
        filter,
        ...(after ? { after } : {}),
      });

      const last = items[items.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeAuditCursor(
              snapshotTo,
              last.auditLog.createdAt,
              last.auditLog.id,
            )
          : null;

      return {
        items: items.map(toAuditLogResponse),
        nextCursor,
        snapshotTo: snapshotTo.toISOString(),
      };
    },
  );

  /**
   * GET /admin/audit-logs/export
   *
   * CSV export of the SAME search query (same filters, same ordering) —
   * export is another serialization of the search, never a second query
   * path. `snapshotTo` binds the export to the exact audit window the search
   * pages projected (echo the page response's `snapshotTo`); omitting it
   * opens a fresh window at server-now. The row cap is the single
   * server-owned AUDIT_EXPORT_MAX_ROWS constant — there is deliberately no
   * client `limit` parameter to compete with it — and matching rows beyond
   * the cap are refused (409 EXPORT_EXCEEDS_LIMIT, details.maxRows) rather
   * than silently truncated. Every successful export is itself audited under
   * `audit_log.exported`.
   */
  fastify.get(
    "/admin/audit-logs/export",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AuditLogView),
      ],
      schema: {
        querystring: AuditLogExportQuerySchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: z.string(),
          400: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const query = AuditLogExportQuerySchema.parse(request.query);
      const repo = createAuditLogQueryRepo(fastify.db);

      const snapshotTo = query.snapshotTo
        ? new Date(query.snapshotTo)
        : new Date();
      const filter = buildAuditFilter(query);
      filter.to = snapshotTo;

      // Fetch one row beyond the cap: hasMore is the refusal signal, so the
      // client never receives a silently truncated CSV.
      const { items, hasMore } = await repo.listKeysetFiltered(ctx, {
        limit: AUDIT_EXPORT_MAX_ROWS,
        filter,
      });

      if (hasMore) {
        return reply.code(409).send(
          buildErrorResponse(request.id, "EXPORT_EXCEEDS_LIMIT", {
            maxRows: AUDIT_EXPORT_MAX_ROWS,
          }),
        );
      }

      const csv =
        "\uFEFF" + generateCSV([...EXPORT_HEADERS], items.map(toExportRow));

      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header(
        "Content-Disposition",
        `attachment; filename="audit-logs-${Date.now()}.csv"`,
      );

      await recordSensitiveReadAudit(fastify.db, request, ctx, {
        action: AuditAction.AuditLogExported,
        targetType: "organization",
        targetId: ctx.organizationId,
        metadata: { format: "csv", rowCount: items.length },
      });

      return reply.send(csv);
    },
  );

  /**
   * GET /admin/audit-log/actions
   *
   * The ACTIVE audit action vocabulary, projected from the single audit
   * policy registry (lifecycle === "active"). The web action dropdown renders
   * from this list — it can never become a stale hardcoded duplicate when a
   * new action ships. Text stays in web i18n; `durability`/`obligation`/
   * `frequency` are the canonical policy facts.
   */
  fastify.get(
    "/admin/audit-log/actions",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AuditLogView),
      ],
      schema: {
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: AuditActionMetadataResponseSchema },
      },
    },
    async () => {
      const actions = (
        Object.keys(AUDIT_ACTION_DEFINITIONS) as AuditActionKey[]
      )
        .filter(
          (action) => AUDIT_ACTION_DEFINITIONS[action].lifecycle === "active",
        )
        .map((action) => {
          const def = AUDIT_ACTION_DEFINITIONS[action];
          return {
            action,
            durability: def.durability,
            obligation: def.obligation,
            frequency: def.frequency,
          };
        })
        .sort((a, b) => a.action.localeCompare(b.action));
      return { actions };
    },
  );
};

export default auditRoutes;
