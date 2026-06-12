import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import candidateFieldRoutes from "./candidateField.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";

describe("candidate field routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  const p = uniquePrefix();

  beforeAll(async () => {
    ctx = await buildTestApp(candidateFieldRoutes);
  });

  afterAll(async () => {
    const fields = await ctx.db
      .select()
      .from(schema.candidateFields)
      .where(eq(schema.candidateFields.organizationId, ctx.org.id));
    for (const f of fields) {
      if (f.name.startsWith(`cf-${p}`)) {
        await ctx.db
          .delete(schema.candidateFields)
          .where(eq(schema.candidateFields.id, f.id));
      }
    }
    await ctx.cleanup();
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
        name: `cf-${p}-employeeId`,
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
    expect(body.name).toBe(`cf-${p}-employeeId`);
    expect(body.required).toBe(true);
  });

  it("PATCH /api/candidate-fields/:id updates a field", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidate-fields",
      payload: {
        name: `cf-${p}-department`,
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
        name: `cf-${p}-toDelete`,
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
        name: `cf-${p}-forbidden`,
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
