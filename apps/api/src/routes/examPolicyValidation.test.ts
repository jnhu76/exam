// P7-M1 integration: canonical exam-policy validation is enforced across
// create, draft-update, and publish (the freeze/acceptance gate).
// Authority: docs/audits/P7-M1-EXAM-POLICY-AUTHORITY-AND-VALIDATION.md §11, §21.

import { describe, expect, it, beforeAll } from "vitest";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";

/** Build a baseline valid create payload. */
function validCreatePayload(courseId: string, questionId: string) {
  return {
    title: "Policy Exam",
    courseId,
    durationMinutes: 60,
    openAt: new Date("2025-01-01T09:00:00Z").toISOString(),
    closeAt: new Date("2025-01-01T12:00:00Z").toISOString(),
    passingScore: 60,
    totalScore: 100,
    questionIds: [questionId],
  };
}

describe("P7-M1 exam policy validation — authoring + publish", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
    });
    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Policy Course",
        code: `PC-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;
    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: "Pick one",
        score: 100,
        options: [
          { id: "a", content: "A" },
          { id: "b", content: "B" },
        ],
        standardAnswer: "a",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;
  });

  // ── CREATE path ───────────────────────────────────────────────────

  it("rejects create with inverted window (openAt after closeAt)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...validCreatePayload(courseId, questionId),
        openAt: new Date("2025-01-02T00:00:00Z").toISOString(),
        closeAt: new Date("2025-01-01T00:00:00Z").toISOString(),
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const codes = (body.error.details?.fields ?? []).map(
      (f: { code: string }) => f.code,
    );
    expect(codes).toContain("EXAM_WINDOW_INVALID");
  });

  it("rejects create with passingScore > totalScore", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...validCreatePayload(courseId, questionId),
        passingScore: 150,
        totalScore: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts create with a valid baseline policy", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: validCreatePayload(courseId, questionId),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
  });

  // ── DRAFT-UPDATE path ─────────────────────────────────────────────

  it("rejects draft update into an inverted window", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: validCreatePayload(courseId, questionId),
      cookies: { "auth-token": ctx.adminToken },
    });
    const id = createRes.json().id;
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${id}`,
      payload: {
        openAt: new Date("2025-02-01T00:00:00Z").toISOString(),
        closeAt: new Date("2025-01-01T00:00:00Z").toISOString(),
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const codes = (body.error.details?.fields ?? []).map(
      (f: { code: string }) => f.code,
    );
    expect(codes).toContain("EXAM_WINDOW_INVALID");
  });

  // ── PUBLISH revalidation (the freeze/acceptance gate) ─────────────

  it("publishes a policy-valid draft (M1 publish path)", async () => {
    // Route authoring validators (create/update) reject every invalid policy
    // combination before publish, so an inverted-window draft cannot reach
    // publish through the HTTP surface. The publish revalidation gate itself
    // is pinned by engine unit tests (examCommands.test.ts: stale invalid
    // Exam rows → publishExam rejects). Here we prove the happy publish path
    // still works after the M1 refactor.
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: validCreatePayload(courseId, questionId),
      cookies: { "auth-token": ctx.adminToken },
    });
    const id = createRes.json().id;
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${id}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("published");
  });

  it("PATCH bounded_grace draft to strict with explicit null caps succeeds (null-merge regression)", async () => {
    // Regression for the nullable patch merge: `null` is business semantics
    // (clearing the caps), so the merged-policy validator must not resurrect
    // the old caps over an explicit null (`null ?? old` bug). bounded_grace →
    // strict + null caps is a legal transition and must return 200.
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...validCreatePayload(courseId, questionId),
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 120,
        interruptionGracePerAttemptSeconds: 300,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(createRes.statusCode).toBe(201);
    const id = createRes.json().id;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${id}`,
      payload: {
        interruptionTimePolicy: "strict",
        interruptionGracePerIncidentSeconds: null,
        interruptionGracePerAttemptSeconds: null,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.interruptionTimePolicy).toBe("strict");
    expect(body.interruptionGracePerIncidentSeconds).toBeNull();
    expect(body.interruptionGracePerAttemptSeconds).toBeNull();
  });
});
