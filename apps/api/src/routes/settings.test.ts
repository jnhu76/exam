import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import authPlugin from "../plugins/auth.js";
import { createDatabase } from "@exam/db/src/database.js";
import { migrateSqlite } from "@exam/db/src/sqlite.js";
import { sqliteSchema } from "@exam/db/src/schema/sqlite.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import settingsRoutes from "./settings.js";

async function buildApp() {
  const { db } = createDatabase();
  migrateSqlite(db);
  await seed(db);

  const org = db
    .select()
    .from(sqliteSchema.organizations)
    .get()!;
  const admin = db
    .select()
    .from(sqliteSchema.users)
    .get()!;

  const app = Fastify();
  await app.register(fastifyCookie);
  await app.register(authPlugin);
  await app.register(settingsRoutes, { prefix: "/api" });
  await app.ready();

  const token = signJWT({
    actorId: admin.id,
    role: admin.role,
    organizationId: admin.organizationId,
  });

  return { app, org, admin, token, db };
}

describe("settings routes", () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    ctx = await buildApp();
  });

  afterAll(async () => {
    await ctx.app.close();
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
      cookies: { "auth-token": ctx.token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.productName).toBe("Updated Platform");
  });
});
