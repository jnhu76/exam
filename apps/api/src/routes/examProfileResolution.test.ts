import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import examRoutes from "./exam.js";
import examProfileRoutes from "./examProfile.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import attemptRoutes from "./attempts.js";
import {
  buildTestApp,
  uniquePrefix,
  createCandidateViaApi,
  publishExamViaApi,
} from "./testHelpers.js";
import { signJWT } from "@exam/auth/src/session.js";
import { schema } from "@exam/db/src/schema/pg.js";

/**
 * P7-M2 — exam creation with profile application (§19–§24).
 *
 * Proves the COPY-ON-APPLY authority model: profile defaults materialize into
 * ordinary Exam columns at creation; explicit request values and explicit
 * nulls win; no-profile creation is unchanged; and a profile edit or deletion
 * after application can NEVER change an existing Exam — publish + attempt
 * start succeed without any profile lookup.
 */
describe("exam creation with exam policy profile (P7-M2 resolution)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;

  const profilePayload = {
    name: "Standard",
    description: "Default template",
    durationMinutes: 60,
    latestStartOffsetMinutes: 10,
    minSubmitAfterStartMinutes: 5,
    retakePolicy: "max_attempts",
    maxAttempts: 2,
    scoreStrategy: "highest",
    resultPublicationMode: "after_grading",
    interruptionTimePolicy: "strict",
    interruptionGracePerIncidentSeconds: null,
    interruptionGracePerAttemptSeconds: null,
  };

  const examBasePayload = {
    title: "Profile Exam",
    courseId: "",
    durationMinutes: 60,
    openAt: new Date(Date.now() - 3600_000).toISOString(),
    closeAt: new Date(Date.now() + 86400_000).toISOString(),
    passingScore: 60,
    totalScore: 100,
    questionIds: [] as string[],
  };

  async function createProfile(
    payload: Record<string, unknown> = profilePayload,
  ): Promise<{ id: string; name: string }> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...payload, name: `${payload.name}-${uniquePrefix()}` },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  async function createExam(payload: Record<string, unknown>) {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload,
      cookies: { "auth-token": ctx.adminToken },
    });
    return res;
  }

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examProfileRoutes);
      await fastify.register(examRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(attemptRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Profile Course",
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
        type: "true_false",
        content: "Profile question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;
    examBasePayload.courseId = courseId;
    examBasePayload.questionIds = [questionId];
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── §39 no-profile compatibility ─────────────────────────────────

  it("no-profile create keeps master behavior: durationMinutes is required", async () => {
    const { durationMinutes: _omit, ...withoutDuration } = examBasePayload;
    const res = await createExam(withoutDuration);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    const fields = res.json().error.details.fields as Array<{
      field: string;
      code: string;
    }>;
    const durationIssue = fields.find((f) => f.field === "durationMinutes");
    expect(durationIssue?.code).toBe("INVALID_TYPE");
  });

  it("no-profile create applies the existing code defaults unchanged", async () => {
    const res = await createExam({ ...examBasePayload, durationMinutes: 45 });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.durationMinutes).toBe(45);
    expect(body.retakePolicy).toBe("unlimited");
    expect(body.maxAttempts).toBe(1);
    expect(body.scoreStrategy).toBe("highest");
    expect(body.resultPublicationMode).toBe("immediate");
    expect(body.interruptionTimePolicy).toBe("strict");
    expect(body.latestStartOffsetMinutes).toBeNull();
    expect(body.minSubmitAfterStartMinutes).toBeNull();
  });

  // ── §40 profile application precedence ───────────────────────────

  it("profile values apply when the request omits them", async () => {
    const profile = await createProfile();
    const { durationMinutes: _omit, ...withoutDuration } = examBasePayload;
    const res = await createExam({ ...withoutDuration, profileId: profile.id });
    expect(res.statusCode, `BODY: ${res.body}`).toBe(201);
    const body = res.json();
    expect(body.durationMinutes).toBe(60);
    expect(body.retakePolicy).toBe("max_attempts");
    expect(body.maxAttempts).toBe(2);
    expect(body.scoreStrategy).toBe("highest");
    expect(body.resultPublicationMode).toBe("after_grading");
    expect(body.latestStartOffsetMinutes).toBe(10);
    expect(body.minSubmitAfterStartMinutes).toBe(5);
    expect(body.interruptionTimePolicy).toBe("strict");
  });

  it("explicit request values override profile values", async () => {
    const profile = await createProfile();
    const res = await createExam({
      ...examBasePayload,
      durationMinutes: 90,
      maxAttempts: 3,
      profileId: profile.id,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.durationMinutes).toBe(90);
    expect(body.maxAttempts).toBe(3);
    // Profile values still apply for the omitted fields.
    expect(body.retakePolicy).toBe("max_attempts");
    expect(body.resultPublicationMode).toBe("after_grading");
  });

  it("explicit null overrides a nullable profile value", async () => {
    const profile = await createProfile();
    const res = await createExam({
      ...examBasePayload,
      durationMinutes: 60,
      latestStartOffsetMinutes: null,
      profileId: profile.id,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.latestStartOffsetMinutes).toBeNull();
    expect(body.minSubmitAfterStartMinutes).toBe(5);
  });

  it("explicit interruption override re-normalizes against profile caps (fail closed)", async () => {
    // Profile is bounded_grace with caps; request forces strict without
    // clearing caps → ADR-013 caps XOR rejects the combination.
    const profile = await createProfile({
      ...profilePayload,
      name: "Bounded",
      interruptionTimePolicy: "bounded_grace",
      interruptionGracePerIncidentSeconds: 120,
      interruptionGracePerAttemptSeconds: 600,
    });
    const res = await createExam({
      ...examBasePayload,
      durationMinutes: 60,
      interruptionTimePolicy: "strict",
      profileId: profile.id,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("profile bounded_grace caps apply when interruption fields are omitted", async () => {
    const profile = await createProfile({
      ...profilePayload,
      name: "Grace",
      interruptionTimePolicy: "bounded_grace",
      interruptionGracePerIncidentSeconds: 120,
      interruptionGracePerAttemptSeconds: 600,
    });
    const res = await createExam({
      ...examBasePayload,
      durationMinutes: 60,
      profileId: profile.id,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.interruptionTimePolicy).toBe("bounded_grace");
    expect(body.interruptionGracePerIncidentSeconds).toBe(120);
    expect(body.interruptionGracePerAttemptSeconds).toBe(600);
  });

  // ── §37 unknown / foreign profile ────────────────────────────────

  it("unknown profileId → 400 VALIDATION_ERROR on profileId (no leak)", async () => {
    const res = await createExam({
      ...examBasePayload,
      durationMinutes: 60,
      profileId: randomUUID(),
    });
    expect(res.statusCode).toBe(400);
    const fields = res.json().error.details.fields as Array<{
      field: string;
      code: string;
    }>;
    expect(fields.find((f) => f.field === "profileId")?.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("foreign-organization profileId → identical 400 (cross-org apply blocked, existence hidden)", async () => {
    // Org B admin creates a profile in Org B.
    const now = new Date();
    const orgBId = randomUUID();
    const orgBAdminId = randomUUID();
    await ctx.db.insert(schema.organizations).values({
      id: orgBId,
      name: `Org B ${uniquePrefix()}`,
      displayName: `Org B ${uniquePrefix()}`,
      slug: `org-b-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.users).values({
      id: orgBAdminId,
      organizationId: orgBId,
      username: `orgb-admin-${uniquePrefix()}`,
      passwordHash: "unused-hash",
      name: "Org B Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: orgBId,
      userId: orgBAdminId,
      role: "Admin" as never,
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const orgBToken = signJWT({
      actorId: orgBAdminId,
      organizationId: orgBId,
      role: "Admin",
      authEpoch: 0,
    });

    const orgBProfile = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...profilePayload, name: `OrgB-${uniquePrefix()}` },
      cookies: { "auth-token": orgBToken },
    });
    expect(orgBProfile.statusCode).toBe(201);

    // Applying Org B's profile to an Org A exam must fail exactly like an
    // unknown id — no cross-org existence leak.
    const res = await createExam({
      ...examBasePayload,
      durationMinutes: 60,
      profileId: orgBProfile.json().id,
    });
    expect(res.statusCode).toBe(400);
    const fields = res.json().error.details.fields as Array<{
      field: string;
      code: string;
    }>;
    expect(fields.find((f) => f.field === "profileId")?.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  // ── §43 canonical M1 validator still owns final Exam validation ──

  it("canonical M1 conflict validation still rejects an invalid final Exam policy", async () => {
    const profile = await createProfile();
    const res = await createExam({
      ...examBasePayload,
      durationMinutes: 60,
      // Inverted window — a profile field cannot create this; the request
      // window must still fail the canonical validator after profile apply.
      openAt: new Date(Date.now() + 86400_000).toISOString(),
      closeAt: new Date(Date.now() - 3600_000).toISOString(),
      profileId: profile.id,
    });
    expect(res.statusCode).toBe(400);
    const fields = res.json().error.details.fields as Array<{ code: string }>;
    expect(fields.some((f) => f.code === "EXAM_WINDOW_INVALID")).toBe(true);
  });

  // ── §23 copy-on-apply: profile edit after apply ──────────────────

  it("profile edit after apply does NOT change an existing Exam", async () => {
    const profile = await createProfile();
    const { durationMinutes: _omit, ...withoutDuration } = examBasePayload;
    const created = await createExam({
      ...withoutDuration,
      profileId: profile.id,
    });
    expect(created.statusCode).toBe(201);
    const examId = created.json().id;
    expect(created.json().durationMinutes).toBe(60);

    const patch = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exam-profiles/${profile.id}`,
      payload: { durationMinutes: 999, retakePolicy: "unlimited" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(patch.statusCode).toBe(200);

    const get = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().durationMinutes).toBe(60);
    expect(get.json().retakePolicy).toBe("max_attempts");
  });

  // ── §24 copy-on-apply: profile deletion must not break the Exam ──

  it("profile deletion after apply does NOT break the Exam — publish + attempt start succeed", async () => {
    const profile = await createProfile();
    const { durationMinutes: _omit, ...withoutDuration } = examBasePayload;
    // The profile's latestStartOffsetMinutes (10) is materialized into the
    // exam, so openAt must be recent for the late-entry gate to admit the
    // candidate (this IS the runtime consuming the applied value).
    const created = await createExam({
      ...withoutDuration,
      openAt: new Date(Date.now() - 60_000).toISOString(),
      profileId: profile.id,
    });
    expect(created.statusCode).toBe(201);
    const examId = created.json().id;

    const del = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exam-profiles/${profile.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(del.statusCode, `DELBODY: ${del.body}`).toBe(204);

    // Publish must not touch the profile.
    const published = await publishExamViaApi(ctx.app, ctx.adminToken, examId);
    expect(published.status).toBe("published");
    expect(published.durationMinutes).toBe(60);

    // Attempt start consumes Exam authority only.
    const username = `prof-cand-${uniquePrefix()}`;
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      username,
      ctx.org.id,
    );
    const enrollRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidate.candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(enrollRes.statusCode).toBe(200);

    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidate.token },
    });
    expect(startRes.statusCode).toBe(201);
    expect(startRes.json().examId).toBe(examId);
  });
});
