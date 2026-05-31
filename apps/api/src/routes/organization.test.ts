import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import authPlugin from "../plugins/auth.js";
import { createDatabase } from "@exam/db/src/database.js";
import { migrateSqlite } from "@exam/db/src/sqlite.js";
import { sqliteSchema } from "@exam/db/src/schema/sqlite.js";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import organizationRoutes from "./organization.js";

async function buildApp() {
  const { db } = createDatabase();
  migrateSqlite(db);
  seed(db);

  const org = db.select().from(sqliteSchema.organizations).get()!;
  const users = db.select().from(sqliteSchema.users).all();
  const admin = users.find((u) => u.role === "SuperAdmin")!;
  const teacher = users.find((u) => u.role === "Teacher")!;

  const app = Fastify();
  await app.register(fastifyCookie);
  await app.register(authPlugin);
  await app.register(organizationRoutes, { prefix: "/api" });
  await app.ready();

  const adminToken = signJWT({
    actorId: admin.id,
    role: admin.role,
    organizationId: admin.organizationId,
  });
  const teacherToken = signJWT({
    actorId: teacher.id,
    role: teacher.role,
    organizationId: teacher.organizationId,
  });

  return { app, org, admin, teacher, adminToken, teacherToken, db };
}

describe("organization routes", () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    ctx = await buildApp();
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
