import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import authPlugin from "../plugins/auth.js";
import { createDatabase } from "@exam/db/src/database.js";
import { migrateSqlite } from "@exam/db/src/sqlite.js";
import { sqliteSchema } from "@exam/db/src/schema/sqlite.js";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import userRoutes from "./user.js";

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
  await app.register(userRoutes, { prefix: "/api" });
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

describe("user routes", () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    ctx = await buildApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("GET /api/users returns list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/users",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toBeInstanceOf(Array);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/users creates a user", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `newuser-${Date.now()}`,
        password: "password123",
        name: "New User",
        role: "Teacher",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("New User");
    expect(body.role).toBe("Teacher");
    expect(body).not.toHaveProperty("passwordHash");
  });

  it("PATCH /api/users/:id updates a user", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `updateuser-${Date.now()}`,
        password: "password123",
        name: "Update Me",
        role: "Teacher",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${created.id}`,
      payload: { name: "Updated Name" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Updated Name");
  });

  it("DELETE /api/users/:id deletes a user", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `deleteuser-${Date.now()}`,
        password: "password123",
        name: "Delete Me",
        role: "Proctor",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/users/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(204);
  });

  it("POST /api/users requires Admin role", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: "forbidden",
        password: "password123",
        name: "Forbidden",
        role: "Teacher",
      },
      cookies: { "auth-token": ctx.teacherToken },
    });
    expect(res.statusCode).toBe(403);
  });
});
