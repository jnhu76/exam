import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createCandidateFieldRepo } from "@exam/db/src/repository/candidateFieldRepo.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import { eq, sql } from "drizzle-orm";
import candidateRoutes from "./candidate.js";
import { buildTestApp, createFutureRoleUserForTest } from "./testHelpers.js";

async function installCandidateCreateAuditFailure(
  db: Awaited<ReturnType<typeof buildTestApp>>["db"],
): Promise<() => Promise<void>> {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const functionName = `fail_candidate_create_audit_${suffix}`;
  const triggerName = `fail_candidate_create_audit_trigger_${suffix}`;
  await db.execute(
    sql.raw(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected candidate create audit failure';
      END;
      $$ LANGUAGE plpgsql
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON audit_logs
      FOR EACH ROW
      WHEN (NEW.action = 'candidate.create')
      EXECUTE FUNCTION ${functionName}()
    `),
  );
  return async () => {
    await db.execute(
      sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_logs`),
    );
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`));
  };
}

describe("candidate routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let adminToken: string;
  let teacherToken: string;
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
    // RBAC-M10-E: every login-capable test user needs a primary active
    // assignment, or the authority resolver returns no_active_assignments
    // and every authenticated request fail-closes with 401.
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: crypto.randomUUID(),
      organizationId,
      userId: adminId,
      role: "Admin",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    adminToken = signJWT({
      actorId: adminId,
      role: "Admin",
      organizationId,
      authEpoch: 0,
    });
    ({ token: teacherToken } = await createFutureRoleUserForTest(
      ctx.db,
      organizationId,
      "Teacher",
      "candidate-teacher",
    ));

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

  afterAll(async () => {
    // Quiescence precondition (see testCleanup.ts): candidate routes emit
    // best-effort audit writes via `fastify.auditWrites`. A late insert that
    // commits between `deleteExamBusinessData` and the org-row delete causes an
    // `audit_logs_organization_id_organizations_id_fk` FK violation. Drain the
    // accepted audit work BEFORE deleting the org tree.
    await ctx.drainAuditWrites();
    await cleanupOrganizationTestData(ctx.db, organizationId);
    await ctx.cleanup();
  });

  it("GET /api/candidates returns paginated list", async () => {
    const username = `listed-candidate-${Date.now()}`;
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username,
        password: "password123",
        name: "Listed Candidate",
        fields: { [identityFieldName]: `listed-${Date.now()}` },
      },
      cookies: { "auth-token": adminToken },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();

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
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.id,
          name: "Listed Candidate",
          username,
          isActive: true,
        }),
      ]),
    );
  });

  it("allows Teacher to read the candidate list used by enrollment", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidates",
      cookies: { "auth-token": teacherToken },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      items: expect.any(Array),
      total: expect.any(Number),
    });
  });

  it("keeps candidate creation unavailable to Teacher", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `teacher-cannot-create-${Date.now()}`,
        password: "password123",
        name: "Forbidden Candidate",
        fields: { [identityFieldName]: `forbidden-${Date.now()}` },
      },
      cookies: { "auth-token": teacherToken },
    });

    expect(res.statusCode).toBe(403);
  });

  it("creates a candidate and updates its name through the HTTP routes", async () => {
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

    const updateRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/candidates/${body.id}`,
      payload: { name: "Updated Candidate" },
      cookies: { "auth-token": adminToken },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json()).toMatchObject({
      id: body.id,
      name: "Updated Candidate",
      fields: { [identityFieldName]: identity },
    });
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
    const body = res.json();
    expect(body).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: {
          fields: expect.arrayContaining([
            expect.objectContaining({
              field: `fields.${identityFieldName}`,
              code: "REQUIRED",
              // Machine params per message contract D0.4/D0.7 (C2): the
              // failing configured field's label is structural.
              params: { label: "身份编号" },
            }),
          ]),
        },
        requestId: expect.any(String),
      },
    });
    // T6: the compatibility message remains present and non-empty —
    // dual-emitted alongside the machine code, never removed.
    const requiredField = body.error.details.fields.find(
      (f: { code: string }) => f.code === "REQUIRED",
    );
    expect(requiredField.message.length).toBeGreaterThan(0);
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
    expect(body.logId).toEqual(expect.any(String));
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

  it("rolls back a newly created identity row when its import audit fails", async () => {
    const username = `audit-failure-${Date.now()}`;
    const removeFailure = await installCandidateCreateAuditFailure(ctx.db);
    try {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/candidates/import",
        payload: {
          rows: [
            {
              username,
              password: "password123",
              name: "Rolled Back Candidate",
              fields: { [identityFieldName]: `R-${Date.now()}` },
            },
          ],
        },
        cookies: { "auth-token": adminToken },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ created: 0, updated: 0 });
      expect(response.json().errors).toHaveLength(1);
      const users = await ctx.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.username, username));
      expect(users).toHaveLength(0);
    } finally {
      await removeFailure();
    }
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
    expect(body.logId).toEqual(expect.any(String));
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
