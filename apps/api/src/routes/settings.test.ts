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

  it("PATCH /api/admin/settings/branding updates branding", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/admin/settings/branding",
      payload: { productName: "Updated Platform" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.productName).toBe("Updated Platform");
  });
});
