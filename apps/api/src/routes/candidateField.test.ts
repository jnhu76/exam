import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { eq } from "drizzle-orm";
import candidateFieldRoutes from "./candidateField.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";

describe("candidate field routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let adminToken: string;
  let organizationId: string;
  let identityFieldId: string;
  const p = uniquePrefix();

  beforeAll(async () => {
    ctx = await buildTestApp(candidateFieldRoutes);
    organizationId = crypto.randomUUID();
    const adminId = crypto.randomUUID();
    const candidateUserId = crypto.randomUUID();
    const now = new Date();
    await ctx.db.insert(schema.organizations).values({
      id: organizationId,
      name: "Candidate Field Test Organization",
      displayName: "Candidate Field Test Organization",
      slug: `candidate-field-test-${organizationId}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.users).values([
      {
        id: adminId,
        organizationId,
        username: `candidate-field-admin-${organizationId}`,
        passwordHash: await hashPassword("password123"),
        name: "Candidate Field Test Admin",
        role: "Admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: candidateUserId,
        organizationId,
        username: `candidate-field-user-${organizationId}`,
        passwordHash: await hashPassword("password123"),
        name: "Candidate Field Test User",
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    // RBAC-M10-E: primary active assignments for both test users.
    await ctx.db.insert(schema.userRoleAssignments).values([
      {
        id: crypto.randomUUID(),
        organizationId,
        userId: adminId,
        role: "Admin",
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        organizationId,
        userId: candidateUserId,
        role: "Candidate",
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await ctx.db.insert(schema.candidateProfiles).values({
      id: crypto.randomUUID(),
      organizationId,
      userId: candidateUserId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    adminToken = signJWT({
      actorId: adminId,
      role: "Admin",
      organizationId,
    });
  });

  afterAll(async () => {
    await cleanupOrganizationTestData(ctx.db, organizationId);
    await ctx.cleanup();
  });

  it("GET /api/candidate-fields returns list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate-fields",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeInstanceOf(Array);
  });

  it("POST /api/candidate-fields creates a field", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidate-fields",
      payload: {
        name: `cf-${p}-employeeId`,
        label: "工号",
        fieldType: "text",
        required: true,
        unique: false,
        sortOrder: 0,
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe(`cf-${p}-employeeId`);
    expect(body.required).toBe(true);
  });

  it("POST /api/candidate-fields rejects a second unique identity field", async () => {
    if (!identityFieldId) {
      const createRes = await ctx.app.inject({
        method: "POST",
        url: "/api/candidate-fields",
        payload: {
          name: `cf-${p}-identity`,
          label: "身份字段",
          fieldType: "text",
          required: true,
          unique: true,
          sortOrder: 0,
        },
        cookies: { "auth-token": adminToken },
      });
      expect(createRes.statusCode).toBe(201);
      identityFieldId = createRes.json().id;
    }

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidate-fields",
      payload: {
        name: `cf-${p}-secondIdentity`,
        label: "第二身份字段",
        fieldType: "text",
        required: true,
        unique: true,
        sortOrder: 1,
      },
      cookies: { "auth-token": adminToken },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: {
        code: "CANDIDATE_IDENTITY_FIELD_CONFLICT",
        requestId: expect.any(String),
      },
    });
  });

  it("POST /api/candidate-fields returns validation details", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidate-fields",
      payload: {
        name: "",
        label: "",
        fieldType: "invalid",
      },
      cookies: { "auth-token": adminToken },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: {
          fields: expect.arrayContaining([
            expect.objectContaining({ field: "name", code: "TOO_SMALL" }),
            expect.objectContaining({ field: "label", code: "TOO_SMALL" }),
          ]),
        },
        requestId: expect.any(String),
      },
    });
  });

  it("PATCH /api/candidate-fields/:id updates a field", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidate-fields",
      payload: {
        name: `cf-${p}-department`,
        label: "Department",
        fieldType: "text",
        required: false,
        unique: false,
        sortOrder: 1,
      },
      cookies: { "auth-token": adminToken },
    });
    const created = createRes.json();
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/candidate-fields/${created.id}`,
      payload: { label: "部门" },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().label).toBe("部门");
  });

  it("DELETE /api/candidate-fields/:id deletes a field", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidate-fields",
      payload: {
        name: `cf-${p}-toDelete`,
        label: "ToDelete",
        fieldType: "text",
        required: false,
        unique: false,
        sortOrder: 2,
      },
      cookies: { "auth-token": adminToken },
    });
    const created = createRes.json();
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/candidate-fields/${created.id}`,
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
  });

  it("DELETE /api/candidate-fields/:id blocks an active identity field", async () => {
    const localOrgId = crypto.randomUUID();
    const localAdminId = crypto.randomUUID();
    const localCandidateUserId = crypto.randomUUID();
    const now = new Date();
    await ctx.db.insert(schema.organizations).values({
      id: localOrgId,
      name: "Candidate Field Delete Test Organization",
      displayName: "Candidate Field Delete Test Organization",
      slug: `candidate-field-delete-test-${localOrgId}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.users).values([
      {
        id: localAdminId,
        organizationId: localOrgId,
        username: `candidate-field-delete-admin-${localOrgId}`,
        passwordHash: await hashPassword("password123"),
        name: "Candidate Field Delete Test Admin",
        role: "Admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: localCandidateUserId,
        organizationId: localOrgId,
        username: `candidate-field-delete-user-${localOrgId}`,
        passwordHash: await hashPassword("password123"),
        name: "Candidate Field Delete Test User",
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    // RBAC-M10-E: primary active assignments for the local test users.
    await ctx.db.insert(schema.userRoleAssignments).values([
      {
        id: crypto.randomUUID(),
        organizationId: localOrgId,
        userId: localAdminId,
        role: "Admin",
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        organizationId: localOrgId,
        userId: localCandidateUserId,
        role: "Candidate",
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await ctx.db.insert(schema.candidateProfiles).values({
      id: crypto.randomUUID(),
      organizationId: localOrgId,
      userId: localCandidateUserId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    const localAdminToken = signJWT({
      actorId: localAdminId,
      role: "Admin",
      organizationId: localOrgId,
    });

    try {
      const createRes = await ctx.app.inject({
        method: "POST",
        url: "/api/candidate-fields",
        payload: {
          name: `cf-${p}-localIdentity`,
          label: "本地身份字段",
          fieldType: "text",
          required: true,
          unique: true,
          sortOrder: 0,
        },
        cookies: { "auth-token": localAdminToken },
      });
      expect(createRes.statusCode).toBe(201);

      const res = await ctx.app.inject({
        method: "DELETE",
        url: `/api/candidate-fields/${createRes.json().id}`,
        cookies: { "auth-token": localAdminToken },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: {
          code: "CANDIDATE_FIELD_IN_USE",
          requestId: expect.any(String),
        },
      });
    } finally {
      await cleanupOrganizationTestData(ctx.db, localOrgId);
    }
  });

  it("PATCH /api/candidate-fields/:id returns ErrorResponse v0 when missing", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/candidate-fields/${crypto.randomUUID()}`,
      payload: { label: "Missing Field" },
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

  it("POST /api/candidate-fields requires Admin role", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidate-fields",
      payload: {
        name: `cf-${p}-forbidden`,
        label: "Forbidden",
        fieldType: "text",
        required: false,
        unique: false,
        sortOrder: 0,
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
