import { describe, expect, it, beforeAll, afterAll } from "vitest";
import settingsRoutes from "./settings.js";
import { buildTestApp } from "./testHelpers.js";

describe("settings routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(settingsRoutes);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("GET /api/settings/branding returns branding", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/settings/branding?organizationSlug=${ctx.org.slug}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("productName");
  });

  it("PATCH /api/admin/settings/branding requires auth", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/admin/settings/branding",
      payload: { productName: "Nope" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/admin/settings requires auth", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/settings",
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/admin/settings returns settings for authenticated admin", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/settings",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode, `status ${res.statusCode}, body: ${res.body}`).toBe(
      200,
    );
    // Returns either the full settings object or `{}` when none exist yet.
    const body = res.json();
    expect(
      typeof body === "object" && body !== null && !Array.isArray(body),
    ).toBe(true);
  });

  it("PATCH updates branding and authenticated GET returns it", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/admin/settings/branding",
      payload: { productName: "Updated Platform" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.productName).toBe("Updated Platform");

    const getRes = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/settings/branding",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toMatchObject({ productName: "Updated Platform" });
  });
});
