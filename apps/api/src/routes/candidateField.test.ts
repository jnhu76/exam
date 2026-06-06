import { describe, expect, it, beforeAll, afterAll } from "vitest";
import candidateFieldRoutes from "./candidateField.js";
import { buildTestApp } from "./testHelpers.js";

describe("candidate field routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(candidateFieldRoutes);
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
