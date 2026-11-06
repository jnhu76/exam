import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@exam/db/schema/pg";
import { executeInTransaction } from "@exam/db/types";
import { buildTestApp, type TestContext } from "../routes/testHelpers.js";
import { ensureTargetOrg, getRequestContext } from "../routes/helpers.js";
import {
  recordAtomicHttpAudit,
  recordAtomicSystemAudit,
  recordBestEffortAudit,
} from "./auditWriter.js";

const atomicBodySchema = z.object({
  targetType: z.string(),
  targetId: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const systemAtomicBodySchema = z.object({
  incidentId: z.string(),
  examId: z.string(),
  operationId: z.string().optional(),
});

const changedFieldsBodySchema = z.object({
  targetId: z.string(),
  changedFields: z.array(z.string()),
});

async function countAudit(
  ctx: TestContext,
  action: string,
  targetId: string,
): Promise<number> {
  const rows = await ctx.db
    .select({ id: schema.auditLogs.id })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.action, action),
        eq(schema.auditLogs.targetId, targetId),
      ),
    );
  return rows.length;
}

describe("owned audit writer boundary", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      fastify.post(
        "/audit-writer/atomic",
        { preHandler: fastify.authenticate },
        async (request) => {
          const tenant = ensureTargetOrg(getRequestContext(request));
          const body = atomicBodySchema.parse(request.body);
          await executeInTransaction(fastify.db, async (tx) => {
            await recordAtomicHttpAudit(tx, request, tenant, {
              action: "user.create",
              targetType: body.targetType,
              targetId: body.targetId,
              ...(body.metadata ? { metadata: body.metadata } : {}),
            });
          });
          return { ok: true };
        },
      );

      fastify.post(
        "/audit-writer/best-effort",
        { preHandler: fastify.authenticate },
        async (request) => {
          const tenant = ensureTargetOrg(getRequestContext(request));
          const body = changedFieldsBodySchema.parse(request.body);
          recordBestEffortAudit(fastify, request, tenant, {
            action: "question.update",
            targetType: "question",
            targetId: body.targetId,
            metadata: { changedFields: body.changedFields },
          });
          return { ok: true };
        },
      );

      fastify.post(
        "/audit-writer/user-agent",
        { preHandler: fastify.authenticate },
        async (request) => {
          const tenant = ensureTargetOrg(getRequestContext(request));
          recordBestEffortAudit(fastify, request, tenant, {
            action: "logout",
            targetType: "session",
            targetId: "bounded-user-agent",
            // #325 logout audit payload schema requires the revocation flag.
            metadata: { revoked: false },
          });
          return { ok: true };
        },
      );

      // PR-A regression seam: the system writer boundary as the incident
      // delivery orchestrator exercises it (atomic system audit inside a
      // transaction, optional operation identity, no HTTP request).
      fastify.post(
        "/audit-writer/system-atomic",
        { preHandler: fastify.authenticate },
        async (request) => {
          const tenant = ensureTargetOrg(getRequestContext(request));
          const body = systemAtomicBodySchema.parse(request.body);
          await executeInTransaction(fastify.db, async (tx) => {
            await recordAtomicSystemAudit(
              tx,
              {
                tenant,
                ...(body.operationId ? { operationId: body.operationId } : {}),
              },
              {
                action: "incident.created",
                targetType: "incident",
                targetId: body.incidentId,
                metadata: {
                  incidentId: body.incidentId,
                  examId: body.examId,
                  type: "network_interruption",
                  version: 1,
                },
              },
            );
          });
          return { ok: true };
        },
      );
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it.each([
    ["targetType", "t".repeat(65), "valid-target"],
    ["targetId", "user", "i".repeat(129)],
  ])(
    "rejects an over-limit %s before inserting",
    async (_label, targetType, targetId) => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/audit-writer/atomic",
        cookies: { "auth-token": ctx.adminToken },
        payload: { targetType, targetId },
      });

      expect(response.statusCode).toBe(400);
      expect(await countAudit(ctx, "user.create", targetId)).toBe(0);
    },
  );

  it("rejects unexpected sensitive payload keys", async () => {
    const targetId = crypto.randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/audit-writer/atomic",
      cookies: { "auth-token": ctx.adminToken },
      payload: {
        targetType: "user",
        targetId,
        metadata: { password: "must-not-be-recorded" },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(await countAudit(ctx, "user.create", targetId)).toBe(0);
  });

  it("keeps best-effort work independent when serialized metadata exceeds the byte ceiling", async () => {
    const targetId = crypto.randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/audit-writer/best-effort",
      cookies: { "auth-token": ctx.adminToken },
      payload: {
        targetId,
        changedFields: Array.from({ length: 16 }, () => "界".repeat(100)),
      },
    });

    expect(response.statusCode).toBe(200);
    await ctx.drainAuditWrites();
    expect(await countAudit(ctx, "question.update", targetId)).toBe(0);
  });

  it("records best-effort metadata eagerly without retaining request", async () => {
    const targetId = crypto.randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/audit-writer/best-effort",
      cookies: { "auth-token": ctx.adminToken },
      payload: {
        targetId,
        changedFields: ["name"],
      },
    });
    expect(response.statusCode).toBe(200);
    await ctx.drainAuditWrites();
    const rows = await ctx.db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, targetId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("question.update");
  });

  it("truncates user-agent evidence to its documented bound", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/audit-writer/user-agent",
      cookies: { "auth-token": ctx.adminToken },
      headers: { "user-agent": "u".repeat(700) },
    });

    expect(response.statusCode).toBe(200);
    await ctx.drainAuditWrites();
    const rows = await ctx.db
      .select({ userAgent: schema.auditLogs.userAgent })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, "bounded-user-agent"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userAgent).toHaveLength(512);
  });

  // PR-A: the system writer carries the operation identity under
  // metadata.operationId. metadata.requestId is the HTTP writer's key — a
  // system row must never present an operation id (or any other value) as an
  // HTTP request id.
  it("preserves the system operation identity under metadata.operationId without fabricating an HTTP requestId", async () => {
    const incidentId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/audit-writer/system-atomic",
      cookies: { "auth-token": ctx.adminToken },
      payload: { incidentId, examId: crypto.randomUUID(), operationId },
    });

    expect(response.statusCode).toBe(200);
    const rows = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, incidentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toMatchObject({ operationId });
    expect(rows[0]?.metadata).not.toHaveProperty("requestId");
    // System audits keep the tenant boundary of the context they were given.
    expect(rows[0]?.organizationId).toBe(ctx.org.id);
  });

  it("writes neither identity key for a system audit without an operationId", async () => {
    const incidentId = crypto.randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/audit-writer/system-atomic",
      cookies: { "auth-token": ctx.adminToken },
      payload: { incidentId, examId: crypto.randomUUID() },
    });

    expect(response.statusCode).toBe(200);
    const rows = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, incidentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).not.toHaveProperty("operationId");
    expect(rows[0]?.metadata).not.toHaveProperty("requestId");
  });
});
