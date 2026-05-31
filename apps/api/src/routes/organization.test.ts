import { describe, expect, it, beforeAll, afterAll } from "vitest";
import organizationRoutes from "./organization.js";
import { buildTestApp } from "./testHelpers.js";

describe("organization routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(organizationRoutes);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("GET /api/organizations returns list for SuperAdmin", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/organizations",
      cookies: { "auth-token": ctx.adminToken },
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
      cookies: { "auth-token": ctx.teacherToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /api/organizations creates org for SuperAdmin", async () => {
    const slug = `test-org-${Date.now()}`;
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/organizations",
      payload: { name: "Test Org", displayName: "Test Org Display", slug },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Test Org");
    expect(body.slug).toBe(slug);
  });

  it("PATCH /api/organizations/:id updates org", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/organizations/${ctx.org.id}`,
      payload: { displayName: "Updated Name" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.displayName).toBe("Updated Name");
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
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();
    const delRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/organizations/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(delRes.statusCode).toBe(204);
  });
});
