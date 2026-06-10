import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "@exam/api/src/routes/testHelpers.js";
import type { TestContext } from "@exam/api/src/routes/testHelpers.js";
import authRoutes from "@exam/api/src/routes/auth.js";
import settingsRoutes from "@exam/api/src/routes/settings.js";
import organizationRoutes from "@exam/api/src/routes/organization.js";
import userRoutes from "@exam/api/src/routes/user.js";
import candidateRoutes from "@exam/api/src/routes/candidate.js";
import candidateFieldRoutes from "@exam/api/src/routes/candidateField.js";
import courseRoutes from "@exam/api/src/routes/course.js";
import questionRoutes from "@exam/api/src/routes/question.js";
import examRoutes from "@exam/api/src/routes/exam.js";
import attemptRoutes from "@exam/api/src/routes/attempts.js";
import scoreRoutes from "@exam/api/src/routes/scores.js";
import { exportRoutes } from "@exam/api/src/routes/export.js";
import systemRoutes from "@exam/api/src/routes/system.js";
import type { FastifyPluginAsync } from "fastify";
import {
  createCandidateViaApi,
  createExamViaApi,
  publishExamViaApi,
  exportResultsCsvAsAdmin,
} from "@exam/api/src/routes/testHelpers.js";

async function buildFullStackApp(): Promise<TestContext> {
  const allRoutes: FastifyPluginAsync = async (fastify) => {
    await fastify.register(authRoutes, { prefix: "/api/auth" });
    await fastify.register(settingsRoutes, { prefix: "/api" });
    await fastify.register(organizationRoutes, { prefix: "/api" });
    await fastify.register(userRoutes, { prefix: "/api" });
    await fastify.register(candidateRoutes, { prefix: "/api" });
    await fastify.register(candidateFieldRoutes, { prefix: "/api" });
    await fastify.register(courseRoutes, { prefix: "/api" });
    await fastify.register(questionRoutes, { prefix: "/api" });
    await fastify.register(examRoutes, { prefix: "/api" });
    await fastify.register(attemptRoutes, { prefix: "/api" });
    await fastify.register(scoreRoutes, { prefix: "/api" });
    await fastify.register(exportRoutes, { prefix: "/api" });
    await fastify.register(systemRoutes, { prefix: "/api" });
    fastify.get("/api/health", async () => ({ status: "ok" }));
  };
  return buildTestApp(allRoutes, { prefix: "" });
}

describe("Smoke — user management CRUD", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildFullStackApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it("lists users including all roles", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/users",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThanOrEqual(3);
  });

  it("creates a new admin user", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: "smoke-admin",
        password: "password123",
        name: "Smoke Admin",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().username).toBe("smoke-admin");
  });

  it("updates user name", async () => {
    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/users",
      cookies: { "auth-token": ctx.adminToken },
    });
    const teacher = listRes
      .json()
      .items.find((u: { role: string }) => u.role === "Teacher");
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${teacher.id}`,
      payload: { name: "Updated Teacher" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Updated Teacher");
  });
});

describe("Smoke — organization management", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildFullStackApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it("lists organizations", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/organizations",
      cookies: { "auth-token": ctx.superAdminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThanOrEqual(1);
  });

  it("creates, updates, then deletes an organization", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/organizations",
      payload: {
        name: "Smoke Org",
        displayName: "Smoke Organization",
        slug: "smoke-org",
      },
      cookies: { "auth-token": ctx.superAdminToken },
    });
    expect(createRes.statusCode).toBe(201);
    const orgId = createRes.json().id;

    const updateRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/organizations/${orgId}`,
      payload: { displayName: "Updated Org" },
      cookies: { "auth-token": ctx.superAdminToken },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().displayName).toBe("Updated Org");

    const deleteRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/organizations/${orgId}`,
      cookies: { "auth-token": ctx.superAdminToken },
    });
    expect(deleteRes.statusCode).toBe(204);
  });
});

describe("Smoke — candidate fields CRUD", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildFullStackApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it("lists candidate fields (empty by default)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate-fields",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("creates a field, gets template, then deletes it", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidate-fields",
      payload: {
        name: "employeeId",
        label: "Employee ID",
        fieldType: "text",
        required: true,
        unique: true,
        sortOrder: 0,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(createRes.statusCode).toBe(201);
    const fieldId = createRes.json().id;

    const updateRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/candidate-fields/${fieldId}`,
      payload: {
        label: "Staff Number",
        required: true,
        unique: true,
        sortOrder: 0,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().label).toBe("Staff Number");

    const templateRes = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate-fields/template",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(templateRes.statusCode).toBe(200);
    expect(templateRes.json().headers).toContain("employeeId");

    const deleteRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/candidate-fields/${fieldId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(deleteRes.statusCode).toBe(204);
  });
});

describe("Smoke — settings branding", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildFullStackApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it("gets public branding by org slug", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/settings/branding?organizationSlug=${ctx.org.slug}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("productName");
  });

  it("admin can update branding settings", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/admin/settings/branding",
      payload: { productName: "Test Platform", productSubtitle: "Test Sub" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().productName).toBe("Test Platform");
  });
});

describe("Smoke — course + question CRUD", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildFullStackApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it("creates a course, a true_false question, lists and updates", async () => {
    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: { name: "Smoke Course", code: "SC101", description: "test" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(courseRes.statusCode).toBe(201);
    const courseId = courseRes.json().id;

    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "1+1=2",
        standardAnswer: true,
        score: 10,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(qRes.statusCode).toBe(201);
    const questionId = qRes.json().id;

    const listRes = await ctx.app.inject({
      method: "GET",
      url: `/api/questions?courseId=${courseId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().total).toBeGreaterThanOrEqual(1);

    const updateRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${questionId}`,
      payload: { content: "2+2=4?" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().content).toBe("2+2=4?");
  });
});

describe("Smoke — exam archive lifecycle", () => {
  let ctx: TestContext;
  let examId: string;
  beforeAll(async () => {
    ctx = await buildFullStackApp();
    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Archive Smoke",
      courseCode: "ARC101",
      courseName: "Archive Course",
      questionContent: "test",
      questionAnswer: true,
      questionScore: 10,
      durationMinutes: 30,
      passingScore: 5,
      totalScore: 10,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examId);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it("archives a published exam", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/archive`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("archived");
  });

  it("exam detail reflects archived status and empty stats", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("archived");
    expect(res.json().stats.participantCount).toBe(0);
  });
});

describe("Smoke — submit exam, archive, view scores, export CSV", () => {
  let ctx: TestContext;
  let examId: string;
  beforeAll(async () => {
    ctx = await buildFullStackApp();
    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Score Smoke",
      courseCode: "SCR101",
      courseName: "Score Course",
      questionContent: "2+2=4",
      questionAnswer: true,
      questionScore: 10,
      durationMinutes: 30,
      passingScore: 5,
      totalScore: 10,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examId);
    await import("@exam/api/src/routes/testHelpers.js").then((m) =>
      m.submitExamAsCandidate(
        ctx.app,
        ctx.adminToken,
        ctx.org.id,
        examId,
        "score-user",
      ),
    );
    const archiveRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/archive`,
      cookies: { "auth-token": ctx.adminToken },
    });
    if (archiveRes.statusCode !== 200) {
      throw new Error(`archive failed: ${archiveRes.statusCode}`);
    }
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it("score list shows the submitted attempt with score 10", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/scores`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBeGreaterThanOrEqual(1);
    const item = res.json().items[0];
    expect(item.score).toBe(10);
    expect(item.passed).toBe(true);
  });

  it("exports scores as CSV containing the candidate", async () => {
    const csv = await exportResultsCsvAsAdmin(ctx.app, ctx.adminToken, examId);
    expect(csv.body).toContain("score-user");
  });
});

describe("Smoke — RBAC role restrictions", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildFullStackApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it("candidate cannot access admin user list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/users",
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it("teacher cannot create users", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: "x",
        password: "123456",
        name: "X",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.teacherToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it("teacher can list courses", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/courses",
      cookies: { "auth-token": ctx.teacherToken },
    });
    expect(res.statusCode).toBe(200);
  });

  it("unauthenticated request to protected endpoint returns 401", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exams",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("Smoke — system dashboard and health", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildFullStackApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it("dashboard returns stats", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/system/dashboard",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("totalQuestions");
    expect(body).toHaveProperty("activeExams");
    expect(body).toHaveProperty("totalCandidates");
  });

  it("health returns status for authenticated user", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/system/health",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("status");
  });
});
