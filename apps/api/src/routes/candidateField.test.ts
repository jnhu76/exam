import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import authPlugin from "../plugins/auth.js";
import { createDatabase } from "@exam/db/src/database.js";
import { migrateSqlite } from "@exam/db/src/sqlite.js";
import { sqliteSchema } from "@exam/db/src/schema/sqlite.js";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import candidateFieldRoutes from "./candidateField.js";

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
  await app.register(candidateFieldRoutes, { prefix: "/api" });
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

describe("candidate field routes", () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    ctx = await buildApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("GET /api/candidate-fields returns list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate-fields",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeInstanceOf(Array);
  });

  it("POST /api/candidate-fields creates a field", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidate-fields",
      payload: {
        name: "employeeId",
        label: "工号",
        fieldType: "text",
        required: true,
        unique: true,
        sortOrder: 0,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("employeeId");
    expect(body.label).toBe("工号");
    expect(body.required).toBe(true);
  });

  it("PATCH /api/candidate-fields/:id updates a field", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidate-fields",
      payload: {
        name: "department",
        label: "Department",
        fieldType: "text",
        required: false,
        unique: false,
        sortOrder: 1,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/candidate-fields/${created.id}`,
      payload: { label: "部门" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().label).toBe("部门");
  });

  it("DELETE /api/candidate-fields/:id deletes a field", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidate-fields",
      payload: {
        name: "toDelete",
        label: "ToDelete",
        fieldType: "text",
        required: false,
        unique: false,
        sortOrder: 2,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/candidate-fields/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(204);
  });

  it("POST /api/candidate-fields requires Admin role", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidate-fields",
      payload: {
        name: "forbidden",
        label: "Forbidden",
        fieldType: "text",
        required: false,
        unique: false,
        sortOrder: 0,
      },
      cookies: { "auth-token": ctx.teacherToken },
    });
    expect(res.statusCode).toBe(403);
  });
});
