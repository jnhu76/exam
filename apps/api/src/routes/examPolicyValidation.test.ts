// P7-M1 integration: canonical exam-policy validation is enforced across
// create, draft-update, and publish (the freeze/acceptance gate).
// Authority: docs/contracts/exam-policy-authority.md §11, §21.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
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
// ── Phase A2 (#291): deadline / untimed authoring + timed_sync block ──

describe("Phase A2 timing modes — authoring gate", () => {
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
        name: "Phase A Course",
        code: `PA-${uniquePrefix()}`,
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
        type: "true_false",
        content: "Phase A question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  function fieldCodes(body: {
    error?: { details?: { fields?: Array<{ code: string }> } };
  }) {
    return (body.error?.details?.fields ?? []).map((f) => f.code);
  }

  it("creates a deadline exam: durationMinutes null, closeAt kept", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...validCreatePayload(courseId, questionId),
        timingMode: "deadline",
        durationMinutes: null,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.timingMode).toBe("deadline");
    expect(body.durationMinutes).toBeNull();
    expect(body.closeAt).not.toBeNull();
  });

  it("creates an untimed exam: durationMinutes null, closeAt null", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...validCreatePayload(courseId, questionId),
        timingMode: "untimed",
        durationMinutes: null,
        closeAt: null,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.timingMode).toBe("untimed");
    expect(body.durationMinutes).toBeNull();
    expect(body.closeAt).toBeNull();
  });

  it("rejects timed_sync with EXAM_TIMING_MODE_INVALID", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...validCreatePayload(courseId, questionId),
        timingMode: "timed_sync",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(fieldCodes(body)).toContain("EXAM_TIMING_MODE_INVALID");
  });

  it("rejects deadline + durationMinutes (illegal combination)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...validCreatePayload(courseId, questionId),
        timingMode: "deadline",
        durationMinutes: 60,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(fieldCodes(res.json())).toContain("EXAM_TIMING_MODE_INVALID");
  });

  it("rejects untimed + closeAt (illegal combination)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...validCreatePayload(courseId, questionId),
        timingMode: "untimed",
        durationMinutes: null,
        // closeAt present on an untimed exam.
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(fieldCodes(res.json())).toContain("EXAM_TIMING_MODE_INVALID");
  });

  it("deadline + bounded_grace is rejected at authoring", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...validCreatePayload(courseId, questionId),
        timingMode: "deadline",
        durationMinutes: null,
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 120,
        interruptionGracePerAttemptSeconds: 300,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(fieldCodes(res.json())).toContain("EXAM_TIMING_MODE_INVALID");
  });

  it("draft update switches timed_window → untimed and clears timing fields", async () => {
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
        timingMode: "untimed",
        durationMinutes: null,
        closeAt: null,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.timingMode).toBe("untimed");
    expect(body.durationMinutes).toBeNull();
    expect(body.closeAt).toBeNull();
  });

  it("publishes a deadline-mode draft (freeze gate accepts the mode)", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...validCreatePayload(courseId, questionId),
        timingMode: "deadline",
        durationMinutes: null,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const id = createRes.json().id;
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${id}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().timingMode).toBe("deadline");
  });
});

// ── #516 product truthfulness: unsupported control flags ─────────────
// detectTabSwitch/disableCopyPaste are UI-exposed; restrictIp/requireLockdown
// are API-only. None has runtime enforcement, so activation must fail closed
// on every policy-authority path while historical rows stay readable.

describe("unsupported control flags — activation gate (#516)", () => {
  const UNSUPPORTED_FLAGS = [
    "detectTabSwitch",
    "disableCopyPaste",
    "restrictIp",
    "requireLockdown",
  ] as const;

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
        name: "Truth Course",
        code: `PT-${uniquePrefix()}`,
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
        content: "Truth question",
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

  afterAll(async () => {
    await ctx.cleanup();
  });

  function fieldFindings(body: {
    error?: { details?: { fields?: Array<{ field: string; code: string }> } };
  }) {
    return body.error?.details?.fields ?? [];
  }

  function adminCtx() {
    return {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
  }

  // ── T2: create route — flag=true rejected, exam NOT created ──────

  it.each(UNSUPPORTED_FLAGS)(
    "rejects create with controlFlags.%s=true (deterministic, no exam created)",
    async (flag) => {
      const listBefore = await ctx.app.inject({
        method: "GET",
        url: "/api/exams",
        cookies: { "auth-token": ctx.adminToken },
      });
      const totalBefore = listBefore.json().total as number;

      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          ...validCreatePayload(courseId, questionId),
          controlFlags: { [flag]: true },
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      const findings = fieldFindings(body);
      expect(findings).toEqual([
        {
          field: flag,
          code: "UNSUPPORTED_EXAM_CONTROL",
          message: expect.any(String),
        },
      ]);

      const listAfter = await ctx.app.inject({
        method: "GET",
        url: "/api/exams",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(listAfter.json().total).toBe(totalBefore);
    },
  );

  it("accepts the same create payload with all unsupported flags false", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...validCreatePayload(courseId, questionId),
        controlFlags: {
          detectTabSwitch: false,
          disableCopyPaste: false,
          restrictIp: false,
          requireLockdown: false,
        },
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().controlFlags.detectTabSwitch).toBe(false);
  });

  // ── T3: update route — rejected, persisted policy unchanged ──────

  it.each(UNSUPPORTED_FLAGS)(
    "rejects draft update setting controlFlags.%s=true and leaves persisted policy unchanged",
    async (flag) => {
      const createRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: validCreatePayload(courseId, questionId),
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(createRes.statusCode).toBe(201);
      const id = createRes.json().id;

      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/exams/${id}`,
        payload: { controlFlags: { [flag]: true } },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
      expect(fieldFindings(res.json())).toEqual([
        {
          field: flag,
          code: "UNSUPPORTED_EXAM_CONTROL",
          message: expect.any(String),
        },
      ]);

      const getRes = await ctx.app.inject({
        method: "GET",
        url: `/api/exams/${id}`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().controlFlags[flag]).toBe(false);
    },
  );

  // ── T4: publish revalidation + historical-row compatibility ──────
  // The historical/stale row is represented through the allowed fixture seam
  // (direct repo write — the HTTP surface rejects activation by design, so it
  // cannot manufacture such a row anymore). Publish must fail closed; the row
  // itself must stay readable verbatim.

  it("historical row with unsupported flag=true: readable, publish fail-closed, unrelated edits revalidated", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: validCreatePayload(courseId, questionId),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(createRes.statusCode).toBe(201);
    const id = createRes.json().id;
    const historicalFlags = {
      ...createRes.json().controlFlags,
      detectTabSwitch: true,
      restrictIp: true,
    };
    await createExamRepo(ctx.db).update(adminCtx(), id, {
      controlFlags: historicalFlags,
    });

    // Historical read: the row (and its legacy vocabulary) stays readable.
    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().controlFlags).toEqual(historicalFlags);

    // Publish is the authority/freeze boundary — fail closed, no coercion.
    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${id}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(publishRes.statusCode).toBe(400);
    expect(publishRes.json().error.code).toBe("VALIDATION_ERROR");
    const publishFindings = fieldFindings(publishRes.json());
    expect(publishFindings.map((f) => f.code)).toEqual([
      "UNSUPPORTED_EXAM_CONTROL",
      "UNSUPPORTED_EXAM_CONTROL",
    ]);
    expect(publishFindings.map((f) => f.field)).toEqual([
      "detectTabSwitch",
      "restrictIp",
    ]);

    // Draft update revalidates the FULL merged policy: editing an unrelated
    // field cannot sneak a historical unsupported row back into authority.
    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${id}`,
      payload: { title: "Renamed historical exam" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(patchRes.statusCode).toBe(400);
    expect(fieldFindings(patchRes.json()).map((f) => f.code)).toContain(
      "UNSUPPORTED_EXAM_CONTROL",
    );

    // The failed attempts never rewrote the row (no silent true→false).
    const reread = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(reread.json().controlFlags).toEqual(historicalFlags);
  });
});
