import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import {
  candidateProfiles,
  emailOutbox,
  examEnrollments,
  notifications,
} from "@exam/db/src/schema/pg.js";

describe("exam enrollment routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;
  let examId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(examRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Enrollment Course",
        code: `ENR-${uniquePrefix()}`,
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
        content: "Enrollment question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;

    const candRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `enroll-cand-${uniquePrefix()}`,
        password: "password123",
        name: "Enroll Candidate",
        fields: {},
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    candidateProfileId = candRes.json().id;

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Enrollment Exam",
        courseId,
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    examId = examRes.json().id;

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("POST /api/exams/:examId/enrollments adds a candidate", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.enrollments).toHaveLength(1);
    expect(body.enrollments[0].candidateId).toBe(candidateProfileId);
    expect(body.enrollments[0].status).toBe("assigned");
    // No skips on a clean add; skippedCandidates is empty (not undefined).
    expect(body.skippedCandidates).toEqual([]);
  });

  it("GET /api/exams/:examId/enrollments lists enrollments", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/enrollments`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].candidateId).toBe(candidateProfileId);
  });

  it("POST /api/exams/:examId/enrollments skips duplicate", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(0);
    expect(body.skipped).toBe(1);
    // Backward-compat: the enrollments array holds only newly-added rows, so a
    // pure-duplicate batch adds nothing.
    expect(body.enrollments).toHaveLength(0);
    // Per-skip reason reporting: the duplicate is reported with its reason.
    expect(body.skippedCandidates).toEqual([
      { candidateId: candidateProfileId, reason: "DUPLICATE" },
    ]);
  });

  it("DELETE /api/exams/:examId/enrollments/:id removes assigned enrollment", async () => {
    const listRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/enrollments`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const enrollmentId = listRes.json()[0].id;

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exams/${examId}/enrollments/${enrollmentId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(204);

    const afterList = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/enrollments`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(afterList.json()).toHaveLength(0);
  });

  it("POST /api/exams/:examId/enrollments skips non-existent candidate", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: {
        candidateIds: ["00000000-0000-0000-0000-000000000000"],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().added).toBe(0);
    expect(res.json().skipped).toBe(1);
    // Per-skip reason reporting: a non-existent candidate is NOT_FOUND.
    expect(res.json().skippedCandidates).toEqual([
      {
        candidateId: "00000000-0000-0000-0000-000000000000",
        reason: "NOT_FOUND",
      },
    ]);
  });

  it("POST /api/exams/:examId/enrollments reports mixed skips + keeps added/skipped/enrollments backward-compatible", async () => {
    // Create a fresh candidate that WILL be added.
    const freshRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `enroll-mix-${uniquePrefix()}`,
        password: "password123",
        name: "Mix Candidate",
        fields: {},
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const freshId = freshRes.json().id;

    // Ensure candidateProfileId is enrolled (state from earlier tests is not
    // guaranteed — the DELETE test may have removed it). Enroll it fresh so the
    // DUPLICATE case below is deterministic.
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });

    // Batch: one already-enrolled (candidateProfileId, DUPLICATE), one
    // non-existent (NOT_FOUND), one fresh (added).
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: {
        candidateIds: [
          candidateProfileId,
          "00000000-0000-0000-0000-000000000000",
          freshId,
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Backward-compatible counts.
    expect(body.added).toBe(1);
    expect(body.skipped).toBe(2);
    expect(body.enrollments).toHaveLength(1); // only freshId newly added
    expect(
      body.enrollments.map((e: { candidateId: string }) => e.candidateId),
    ).toContain(freshId);
    // Per-skip reasons, in input order.
    expect(body.skippedCandidates).toEqual([
      { candidateId: candidateProfileId, reason: "DUPLICATE" },
      {
        candidateId: "00000000-0000-0000-0000-000000000000",
        reason: "NOT_FOUND",
      },
    ]);
  });
});

describe("exam_assigned notifications on enrollment (#299)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let examId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(examRoutes);
      await fastify.register(candidateRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Notify Course",
        code: `NOTIF-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Notification Exam",
        courseId,
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    examId = examRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function createCandidateViaApi(
    username: string,
    email: string | null,
  ): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `notify-${username}-${uniquePrefix()}`,
        password: "password123",
        name: `Notify Candidate ${username}`,
        ...(email === null ? {} : { email }),
        fields: {},
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  function inboxRowsFor(candidateUserId: string) {
    return ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, candidateUserId));
  }

  function outboxRowsFor(candidateUserId: string) {
    return ctx.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.recipientUserId, candidateUserId));
  }

  async function resolveCandidateUserId(
    candidateProfileId: string,
  ): Promise<string> {
    const [profile] = await ctx.db
      .select()
      .from(candidateProfiles)
      .where(eq(candidateProfiles.id, candidateProfileId));
    return profile!.userId;
  }

  it("a new enrollment with email atomically creates 1 Inbox + 1 Email outbox row", async () => {
    const profileId = await createCandidateViaApi(
      "withmail",
      "with@example.com",
    );
    const candidateUserId = await resolveCandidateUserId(profileId);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [profileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().added).toBe(1);

    const inbox = await inboxRowsFor(candidateUserId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.type).toBe("exam_assigned");
    expect(inbox[0]!.title).toBe("考试已安排");
    expect(inbox[0]!.body).toContain("Notification Exam");
    // The action path is the authorized candidate exam list.
    expect(inbox[0]!.actionPath).toBe("/exam/list");

    const outbox = await outboxRowsFor(candidateUserId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.type).toBe("exam_notification");
    expect(outbox[0]!.notificationId).toBe(inbox[0]!.id);
    expect(outbox[0]!.recipientEmail).toBe("with@example.com");
    expect(outbox[0]!.subject).toBe("考试已安排");
    expect(outbox[0]!.bodyText).toContain("/exam/list");
  });

  it("a new enrollment without email creates Inbox only (no outbox row)", async () => {
    const profileId = await createCandidateViaApi("nomail", null);
    const candidateUserId = await resolveCandidateUserId(profileId);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [profileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);

    const inbox = await inboxRowsFor(candidateUserId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.type).toBe("exam_assigned");
    expect(await outboxRowsFor(candidateUserId)).toHaveLength(0);
  });

  it("a duplicate enrollment notifies nothing (no new Inbox, no new Email)", async () => {
    const profileId = await createCandidateViaApi("dupmail", "dup@example.com");
    const candidateUserId = await resolveCandidateUserId(profileId);

    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [profileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(first.json().added).toBe(1);

    const second = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [profileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().added).toBe(0);
    expect(second.json().skippedCandidates).toEqual([
      { candidateId: profileId, reason: "DUPLICATE" },
    ]);

    expect(await inboxRowsFor(candidateUserId)).toHaveLength(1);
    expect(await outboxRowsFor(candidateUserId)).toHaveLength(1);
  });

  it("a candidate from another organization is skipped with no notification (tenant boundary)", async () => {
    // Seed a foreign org + candidate profile + user directly (no API can do
    // this cross-org), then offer the foreign profile id to the route.
    const foreignOrg = await createOrganizationRepo(ctx.db).create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions: [],
        sessionId: "s",
      },
      {
        name: "Foreign Org",
        displayName: "Foreign Org",
        slug: `foreign-${uniquePrefix()}`,
      },
    );
    const foreignUser = await createUserRepo(ctx.db).create(
      {
        actorId: "system",
        organizationId: foreignOrg.id,
        role: "Admin",
        permissions: [],
        sessionId: "s",
      },
      {
        username: `foreign-${uniquePrefix()}`,
        passwordHash: "x",
        name: "Foreign Candidate",
        role: "Candidate",
        isActive: true,
        email: "foreign@example.com",
      },
    );
    const [foreignProfile] = await ctx.db
      .insert(candidateProfiles)
      .values({
        id: randomUUID(),
        organizationId: foreignOrg.id,
        userId: foreignUser.id,
        fields: {},
      })
      .returning();

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [foreignProfile!.id] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().added).toBe(0);
    expect(res.json().skippedCandidates).toEqual([
      { candidateId: foreignProfile!.id, reason: "NOT_FOUND" },
    ]);

    // No enrollment, no Inbox, no Email leaked across the tenant boundary.
    const foreignUserRepoRows = await ctx.db
      .select()
      .from(examEnrollments)
      .where(eq(examEnrollments.candidateId, foreignProfile!.id));
    expect(foreignUserRepoRows).toHaveLength(0);
    expect(await inboxRowsFor(foreignUser.id)).toHaveLength(0);
    expect(await outboxRowsFor(foreignUser.id)).toHaveLength(0);
  });
});
