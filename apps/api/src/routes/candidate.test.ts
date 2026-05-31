import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import authPlugin from "../plugins/auth.js";
import { createDatabase } from "@exam/db/src/database.js";
import { migrateSqlite } from "@exam/db/src/sqlite.js";
import { sqliteSchema } from "@exam/db/src/schema/sqlite.js";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import candidateRoutes from "./candidate.js";

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
  await app.register(candidateRoutes, { prefix: "/api" });
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

describe("candidate routes", () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    ctx = await buildApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("GET /api/candidates returns list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidates",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeInstanceOf(Array);
  });

  it("POST /api/candidates creates a candidate with user", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `candidate-${Date.now()}`,
        password: "password123",
        name: "Test Candidate",
        fields: { employeeId: "E001" },
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.fields).toEqual({ employeeId: "E001" });
    expect(body).toHaveProperty("userId");
  });

  it("POST /api/candidates/import bulk imports candidates", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {
        rows: [
          {
            username: `import1-${Date.now()}`,
            password: "password123",
            name: "Import One",
            fields: { employeeId: "I001" },
          },
          {
            username: `import2-${Date.now()}`,
            password: "password123",
            name: "Import Two",
            fields: { employeeId: "I002" },
          },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(2);
    expect(body.total).toBe(2);
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
      cookies: { "auth-token": ctx.teacherToken },
    });
    expect(res.statusCode).toBe(403);
  });
});
