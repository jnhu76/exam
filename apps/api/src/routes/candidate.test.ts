import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createCandidateFieldRepo } from "@exam/db/src/repository/candidateFieldRepo.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import candidateRoutes from "./candidate.js";
import { buildTestApp } from "./testHelpers.js";

describe("candidate routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let adminToken: string;
  let organizationId: string;
  let identityFieldName: string;

  beforeAll(async () => {
    ctx = await buildTestApp(candidateRoutes);
    organizationId = crypto.randomUUID();
    const adminId = crypto.randomUUID();
    const now = new Date();
    await ctx.db.insert(schema.organizations).values({
      id: organizationId,
      name: "Candidate Test Organization",
      displayName: "Candidate Test Organization",
      slug: `candidate-test-${organizationId}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.users).values({
      id: adminId,
      organizationId,
      username: `candidate-admin-${organizationId}`,
      passwordHash: await hashPassword("password123"),
      name: "Candidate Test Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    adminToken = signJWT({
      actorId: adminId,
      role: "Admin",
      organizationId,
    });

    const fieldRepo = createCandidateFieldRepo(ctx.db);
    const repoCtx = {
      actorId: adminId,
      organizationId,
      targetOrganizationId: organizationId,
      role: "Admin" as const,
      permissions: [],
      sessionId: "test",
    };
    const created = await fieldRepo.create(repoCtx, {
      name: "employeeId",
      label: "身份编号",
      fieldType: "text",
      required: true,
      unique: true,
      sortOrder: 0,
    });
    identityFieldName = created.name;
  });

  async function deleteAuditLogs(): Promise<void> {
    await ctx.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, organizationId));
  }

  async function deleteOrganization(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 10; attempt++) {
      await deleteAuditLogs();
      try {
        await ctx.db
          .delete(schema.organizations)
          .where(eq(schema.organizations.id, organizationId));
        return;
      } catch (err) {
        lastError = err;
        const constraint =
          err && typeof err === "object"
            ? String((err as Record<string, unknown>).constraint_name ?? "")
            : "";
        if (constraint !== "audit_logs_organization_id_organizations_id_fk") {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    throw lastError;
  }

  afterAll(async () => {
    await deleteAuditLogs();
    await ctx.db
      .delete(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.organizationId, organizationId));
    await ctx.db
      .delete(schema.candidateFields)
      .where(eq(schema.candidateFields.organizationId, organizationId));
    await ctx.db
      .delete(schema.users)
      .where(eq(schema.users.organizationId, organizationId));
    await deleteOrganization();
    await ctx.cleanup();
  });

  it("GET /api/candidates returns paginated list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidates",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page", 1);
    expect(body).toHaveProperty("pageSize");
    expect(body.items).toBeInstanceOf(Array);
  });

  it("POST /api/candidates creates a candidate with user", async () => {
    const identity = `E-${Date.now()}`;
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `candidate-${Date.now()}`,
        password: "password123",
        name: "Test Candidate",
        fields: { [identityFieldName]: identity },
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.fields).toEqual({ [identityFieldName]: identity });
    expect(body).toHaveProperty("userId");
  });

  it("POST /api/candidates returns field validation details", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `missing-field-${Date.now()}`,
        password: "password123",
        name: "Missing Field",
        fields: {},
      },
      cookies: { "auth-token": adminToken },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: {
          fields: expect.arrayContaining([
            expect.objectContaining({
              field: `fields.${identityFieldName}`,
              code: "REQUIRED",
            }),
          ]),
        },
        requestId: expect.any(String),
      },
    });
  });

  it("POST /api/candidates returns a stable identity conflict", async () => {
    const identity = `duplicate-${Date.now()}`;
    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `candidate-first-${Date.now()}`,
        password: "password123",
        name: "First Candidate",
        fields: { [identityFieldName]: identity },
      },
      cookies: { "auth-token": adminToken },
    });
    expect(first.statusCode).toBe(201);

    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `candidate-second-${Date.now()}`,
        password: "password123",
        name: "Second Candidate",
        fields: { [identityFieldName]: identity },
      },
      cookies: { "auth-token": adminToken },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      error: {
        code: "CANDIDATE_IDENTITY_CONFLICT",
        requestId: expect.any(String),
      },
    });
  });

  it("PATCH /api/candidates/:id returns ErrorResponse v0 when missing", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/candidates/${crypto.randomUUID()}`,
      payload: { name: "Missing Candidate" },
      cookies: { "auth-token": adminToken },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: {
        code: "RESOURCE_NOT_FOUND",
        requestId: expect.any(String),
      },
    });
  });

  it("POST /api/candidates/import bulk imports candidates", async () => {
    const identitySuffix = Date.now();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {
        rows: [
          {
            username: `import1-${Date.now()}`,
            password: "password123",
            name: "Import One",
            fields: { [identityFieldName]: `I001-${identitySuffix}` },
          },
          {
            username: `import2-${Date.now()}`,
            password: "password123",
            name: "Import Two",
            fields: { [identityFieldName]: `I002-${identitySuffix}` },
          },
        ],
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(2);
    expect(body.total).toBe(2);
  });

  it("POST /api/candidates/import re-imports by username as update", async () => {
    const username = `dup-${Date.now()}`;
    const identity = `D-${Date.now()}`;
    const res1 = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {
        rows: [
          {
            username,
            password: "password123",
            name: "Dup User",
            fields: { [identityFieldName]: identity },
          },
        ],
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().created).toBe(1);

    const res2 = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {
        rows: [
          {
            username,
            password: "password123",
            name: "Dup User Updated",
            fields: { [identityFieldName]: identity },
          },
        ],
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res2.statusCode).toBe(200);
    const body = res2.json();
    expect(body.created).toBe(0);
    expect(body.updated).toBe(1);
    expect(body.errors).toHaveLength(0);
  });

  it("POST /api/candidates/import rejects missing username or name", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {
        rows: [
          { username: "", password: "123456", name: "No User", fields: {} },
          { username: "no-name", password: "123456", name: "", fields: {} },
        ],
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.errors).toHaveLength(2);
    expect(body.errors[0].row).toBe(1);
    expect(body.errors[1].row).toBe(2);
  });

  it("POST /api/candidates/import row errors include stable code field", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {
        rows: [
          { username: "", password: "123456", name: "No User", fields: {} },
        ],
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].row).toBe(1);
    expect(body.errors[0].code).toEqual(expect.any(String));
    expect(body.errors[0].code.length).toBeGreaterThan(0);
  });

  it("POST /api/candidates/import returns 400 ErrorResponse v0 for invalid body", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {},
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toEqual(expect.any(String));
    expect(body.error.details.fields).toBeInstanceOf(Array);
    expect(body.error.details.fields.length).toBeGreaterThan(0);
    expect(body.error.requestId).toEqual(expect.any(String));
  });

  it("POST /api/candidates requires Admin role", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: "forbidden",
        password: "password123",
        name: "Forbidden",
        fields: {},
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: {
        code: "PERMISSION_DENIED",
        requestId: expect.any(String),
      },
    });
  });
});
