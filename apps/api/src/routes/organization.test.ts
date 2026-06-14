import { describe, expect, it, beforeAll, afterAll } from "vitest";
import organizationRoutes from "./organization.js";
import { buildTestApp, createFutureRoleUserForTest } from "./testHelpers.js";

describe("organization routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let superAdminToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(organizationRoutes);
    const futureSuperAdmin = await createFutureRoleUserForTest(
      ctx.db,
      ctx.org.id,
      "SuperAdmin",
      "future-superadmin",
    );
    superAdminToken = futureSuperAdmin.token;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("GET /api/organizations returns list for SuperAdmin", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/organizations",
      cookies: { "auth-token": superAdminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toBeInstanceOf(Array);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toHaveProperty("name");
    expect(body[0]).toHaveProperty("slug");
  });

  it("GET /api/organizations forbidden for non-SuperAdmin", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/organizations",
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

  it("POST /api/organizations creates org for SuperAdmin", async () => {
    const slug = `test-org-${Date.now()}`;
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/organizations",
      payload: { name: "Test Org", displayName: "Test Org Display", slug },
      cookies: { "auth-token": superAdminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Test Org");
    expect(body.slug).toBe(slug);
  });

  it("POST /api/organizations returns validation details", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/organizations",
      payload: { name: "", displayName: "", slug: "" },
      cookies: { "auth-token": superAdminToken },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: {
          fields: expect.arrayContaining([
            expect.objectContaining({ field: "name", code: "TOO_SMALL" }),
            expect.objectContaining({
              field: "displayName",
              code: "TOO_SMALL",
            }),
            expect.objectContaining({ field: "slug", code: "TOO_SMALL" }),
          ]),
        },
        requestId: expect.any(String),
      },
    });
  });

  it("POST /api/organizations returns a stable slug conflict", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/organizations",
      payload: {
        name: "Duplicate Organization",
        displayName: "Duplicate Organization",
        slug: ctx.org.slug,
      },
      cookies: { "auth-token": superAdminToken },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: {
        code: "RESOURCE_CONFLICT",
        requestId: expect.any(String),
      },
    });
  });

  it("PATCH /api/organizations/:id updates org", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/organizations/${ctx.org.id}`,
      payload: { displayName: "Updated Name" },
      cookies: { "auth-token": superAdminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.displayName).toBe("Updated Name");
  });

  it("PATCH /api/organizations/:id returns ErrorResponse v0 when missing", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/organizations/${crypto.randomUUID()}`,
      payload: { displayName: "Missing Organization" },
      cookies: { "auth-token": superAdminToken },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: {
        code: "RESOURCE_NOT_FOUND",
        requestId: expect.any(String),
      },
    });
  });

  it("DELETE /api/organizations/:id deletes org", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/organizations",
      payload: {
        name: "ToDelete",
        displayName: "ToDelete",
        slug: `to-delete-${Date.now()}`,
      },
      cookies: { "auth-token": superAdminToken },
    });
    const created = createRes.json();
    const delRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/organizations/${created.id}`,
      cookies: { "auth-token": superAdminToken },
    });
    expect(delRes.statusCode).toBe(204);
    expect(delRes.body).toBe("");
  });
});
