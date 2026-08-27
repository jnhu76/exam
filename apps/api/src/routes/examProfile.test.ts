import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import examProfileRoutes from "./examProfile.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import { signJWT } from "@exam/auth/src/session.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { schema } from "@exam/db/src/schema/pg.js";

const VALID_PROFILE = {
  name: "Standard",
  description: "Default template",
  durationMinutes: 60,
  latestStartOffsetMinutes: 10,
  minSubmitAfterStartMinutes: 5,
  retakePolicy: "max_attempts",
  maxAttempts: 2,
  scoreStrategy: "highest",
  resultPublicationMode: "after_grading",
  interruptionTimePolicy: "bounded_grace",
  interruptionGracePerIncidentSeconds: 120,
  interruptionGracePerAttemptSeconds: 600,
};

describe("exam policy profile routes (P7-M2 CRUD)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examProfileRoutes);
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("POST /api/exam-profiles creates a profile", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...VALID_PROFILE, name: `Std-${uniquePrefix()}` },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.durationMinutes).toBe(60);
    expect(body.retakePolicy).toBe("max_attempts");
    expect(body.interruptionTimePolicy).toBe("bounded_grace");
    expect(body.interruptionGracePerIncidentSeconds).toBe(120);
    expect(body.createdAt).toBeDefined();
  });

  it("GET /api/exam-profiles lists organization profiles", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exam-profiles",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/exam-profiles/:id returns a profile; unknown id → 404", async () => {
    const name = `Get-${uniquePrefix()}`;
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...VALID_PROFILE, name },
      cookies: { "auth-token": ctx.adminToken },
    });
    const id = created.json().id;

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exam-profiles/${id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe(name);
  });

  it("GET unknown profile id → 404", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exam-profiles/${randomUUID()}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /api/exam-profiles/:id updates fields; explicit null clears", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...VALID_PROFILE, name: `Patch-${uniquePrefix()}` },
      cookies: { "auth-token": ctx.adminToken },
    });
    const id = created.json().id;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exam-profiles/${id}`,
      payload: { durationMinutes: 90, latestStartOffsetMinutes: null },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().durationMinutes).toBe(90);
    expect(res.json().latestStartOffsetMinutes).toBeNull();
    expect(res.json().minSubmitAfterStartMinutes).toBe(5);
  });

  it("PATCH empty body returns the existing profile unchanged (no audit)", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...VALID_PROFILE, name: `Noop-${uniquePrefix()}` },
      cookies: { "auth-token": ctx.adminToken },
    });
    const id = created.json().id;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exam-profiles/${id}`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().durationMinutes).toBe(60);
  });

  it("PATCH unknown id → 404", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exam-profiles/${randomUUID()}`,
      payload: { durationMinutes: 30 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /api/exam-profiles/:id removes the profile (204); follow-up get → 404", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...VALID_PROFILE, name: `Del-${uniquePrefix()}` },
      cookies: { "auth-token": ctx.adminToken },
    });
    const id = created.json().id;

    const del = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exam-profiles/${id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(del.statusCode).toBe(204);

    const get = await ctx.app.inject({
      method: "GET",
      url: `/api/exam-profiles/${id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(get.statusCode).toBe(404);
  });

  it("DELETE unknown id → 404", async () => {
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exam-profiles/${randomUUID()}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(404);
  });

  it("duplicate (org, name) → stable 409 RESOURCE_CONFLICT", async () => {
    const name = `Dup-${uniquePrefix()}`;
    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...VALID_PROFILE, name },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(first.statusCode).toBe(201);

    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...VALID_PROFILE, name },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("RESOURCE_CONFLICT");

    // Renaming an existing profile to a name another profile already owns is
    // also rejected (unique (org, name) on update).
    const other = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...VALID_PROFILE, name: `Other-${uniquePrefix()}` },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(other.statusCode).toBe(201);
    const rename = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exam-profiles/${first.json().id}`,
      payload: { name: other.json().name },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(rename.statusCode).toBe(409);
  });

  it("invalid interruption defaults rejected (bounded_grace without caps → 400)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: {
        ...VALID_PROFILE,
        name: `BadInterrupt-${uniquePrefix()}`,
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: null,
        interruptionGracePerAttemptSeconds: null,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    const fields = res.json().error.details.fields as Array<{
      code: string;
    }>;
    expect(fields.some((f) => f.code === "INVALID_INTERRUPTION_POLICY")).toBe(
      true,
    );
  });

  it("invalid interruption defaults rejected on update (bounded_grace with perIncident > aggregate → 400)", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...VALID_PROFILE, name: `BadUpdate-${uniquePrefix()}` },
      cookies: { "auth-token": ctx.adminToken },
    });
    const id = created.json().id;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exam-profiles/${id}`,
      payload: {
        interruptionGracePerIncidentSeconds: 900,
        interruptionGracePerAttemptSeconds: 600,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("non-Phase-1 retake policy rejected at the contract (400)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: {
        ...VALID_PROFILE,
        name: `BadRetake-${uniquePrefix()}`,
        retakePolicy: "daily_limit",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("RBAC: candidate token is denied (403)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exam-profiles",
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it("foreign-org access fails closed: view/update/delete → 404, no existence leak", async () => {
    // Org B admin with an active primary role assignment.
    const now = new Date();
    const orgBId = randomUUID();
    const orgBAdminId = randomUUID();
    const adminPasswordHash = await hashPassword("password123");
    await ctx.db.insert(schema.organizations).values({
      id: orgBId,
      name: `Org B ${uniquePrefix()}`,
      displayName: `Org B ${uniquePrefix()}`,
      slug: `org-b-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.users).values({
      id: orgBAdminId,
      organizationId: orgBId,
      username: `orgb-admin-${uniquePrefix()}`,
      passwordHash: adminPasswordHash,
      name: "Org B Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: orgBId,
      userId: orgBAdminId,
      role: "Admin" as never,
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const orgBToken = signJWT({
      actorId: orgBAdminId,
      organizationId: orgBId,
      role: "Admin",
      authEpoch: 0,
    });

    // Org A profile id.
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...VALID_PROFILE, name: `OrgA-${uniquePrefix()}` },
      cookies: { "auth-token": ctx.adminToken },
    });
    const orgAProfileId = created.json().id;

    const view = await ctx.app.inject({
      method: "GET",
      url: `/api/exam-profiles/${orgAProfileId}`,
      cookies: { "auth-token": orgBToken },
    });
    expect(view.statusCode).toBe(404);

    const patch = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exam-profiles/${orgAProfileId}`,
      payload: { durationMinutes: 1 },
      cookies: { "auth-token": orgBToken },
    });
    expect(patch.statusCode).toBe(404);

    const del = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exam-profiles/${orgAProfileId}`,
      cookies: { "auth-token": orgBToken },
    });
    expect(del.statusCode).toBe(404);

    // Org A's profile is untouched and still visible to Org A.
    const stillThere = await ctx.app.inject({
      method: "GET",
      url: `/api/exam-profiles/${orgAProfileId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(stillThere.statusCode).toBe(200);

    // Org B can create its own profile and list only its own.
    const own = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...VALID_PROFILE, name: `OrgB-${uniquePrefix()}` },
      cookies: { "auth-token": orgBToken },
    });
    expect(own.statusCode).toBe(201);
    const list = await ctx.app.inject({
      method: "GET",
      url: "/api/exam-profiles",
      cookies: { "auth-token": orgBToken },
    });
    const names = (list.json() as Array<{ name: string }>).map((p) => p.name);
    expect(names.every((n) => n.startsWith("OrgB-"))).toBe(true);
  });
});
