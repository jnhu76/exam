import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signJWT } from "@exam/auth/src/session.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { schema } from "@exam/db/src/schema/pg.js";
import type { Role } from "@exam/domain";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import proctorMonitoringRoutes from "./proctorMonitoring.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";

describe("GET /api/admin/proctor/exams", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let proctorToken: string;
  let teacherToken: string;
  let graderToken: string;
  const visibleExamIds: string[] = [];
  let foreignExamId: string;

  async function createRoleToken(role: Exclude<Role, "Admin" | "System">) {
    const id = randomUUID();
    await ctx.db.insert(schema.users).values({
      id,
      organizationId: ctx.org.id,
      username: `proctor-discovery-${role.toLowerCase()}-${uniquePrefix()}`,
      passwordHash: await hashPassword("test-password"),
      name: `${role} discovery`,
      role,
      isActive: true,
    });
    return signJWT(
      { actorId: id, role, organizationId: ctx.org.id },
      getRuntimeConfig().authSecret.jwtSecret,
    );
  }

  async function seedCourse(organizationId: string, suffix: string) {
    const id = randomUUID();
    await ctx.db.insert(schema.courses).values({
      id,
      organizationId,
      name: `Discovery course ${suffix}`,
      code: `DISC-${suffix}-${uniquePrefix()}`,
      description: "",
    });
    return id;
  }

  async function seedExam(
    organizationId: string,
    courseId: string,
    status: string,
    title: string,
  ) {
    const id = randomUUID();
    await ctx.db.insert(schema.exams).values({
      id,
      organizationId,
      title,
      description: "",
      courseId,
      status,
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: new Date("2026-07-17T01:00:00.000Z"),
      closeAt: new Date("2026-07-17T03:00:00.000Z"),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [],
      questionSnapshot: [],
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: false,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
    });
    return id;
  }

  beforeAll(async () => {
    ctx = await buildTestApp(proctorMonitoringRoutes);
    [proctorToken, teacherToken, graderToken] = await Promise.all([
      createRoleToken("Proctor"),
      createRoleToken("Teacher"),
      createRoleToken("Grader"),
    ]);

    const ownCourseId = await seedCourse(ctx.org.id, "own");
    for (const status of ["published", "open", "closed"] as const) {
      visibleExamIds.push(
        await seedExam(ctx.org.id, ownCourseId, status, `${status} exam`),
      );
    }
    await seedExam(ctx.org.id, ownCourseId, "draft", "draft exam");
    await seedExam(ctx.org.id, ownCourseId, "archived", "archived exam");

    const foreignOrganizationId = randomUUID();
    await ctx.db.insert(schema.organizations).values({
      id: foreignOrganizationId,
      name: "Foreign organization",
      displayName: "Foreign organization",
      slug: `foreign-${uniquePrefix()}`,
    });
    const foreignCourseId = await seedCourse(foreignOrganizationId, "foreign");
    foreignExamId = await seedExam(
      foreignOrganizationId,
      foreignCourseId,
      "open",
      "foreign open exam",
    );
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it.each([
    ["Admin", () => ctx.adminToken],
    ["Proctor", () => proctorToken],
  ] as const)("returns 200 for %s", async (_role, token) => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/proctor/exams",
      cookies: { "auth-token": token() },
    });
    expect(response.statusCode).toBe(200);
  });

  it("returns only supported exams from the authenticated organization", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/proctor/exams",
      cookies: { "auth-token": proctorToken },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(3);
    expect(body.items.map((item: { examId: string }) => item.examId)).toEqual(
      expect.arrayContaining(visibleExamIds),
    );
    expect(body.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ examId: foreignExamId }),
      ]),
    );
    expect(
      body.items.every((item: { status: string }) =>
        ["published", "open", "closed"].includes(item.status),
      ),
    ).toBe(true);
  });

  it("returns an exact non-sensitive projection", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/proctor/exams",
      cookies: { "auth-token": proctorToken },
    });
    const item = response.json().items[0];
    expect(Object.keys(item).sort()).toEqual(
      ["closeAt", "examId", "openAt", "status", "title"].sort(),
    );
    for (const forbidden of [
      "questionIds",
      "questionSnapshot",
      "standardAnswer",
      "rubric",
      "candidateAnswer",
      "gradingResult",
      "enrollments",
      "controlFlags",
    ]) {
      expect(item).not.toHaveProperty(forbidden);
    }
  });

  it.each([
    ["Teacher", () => teacherToken],
    ["Grader", () => graderToken],
    ["Candidate", () => ctx.candidateToken],
  ] as const)("returns 403 for %s", async (_role, token) => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/proctor/exams",
      cookies: { "auth-token": token() },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("PERMISSION_DENIED");
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/proctor/exams",
    });
    expect(response.statusCode).toBe(401);
  });
});
