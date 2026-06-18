import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import authRoutes from "./auth.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import { buildTestApp, createExamViaApi } from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";

let examCounter = 0;

async function createExam(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  title: string,
) {
  examCounter++;
  return createExamViaApi(ctx.app, ctx.adminToken, {
    examTitle: title,
    courseCode: `SM${examCounter}`,
    courseName: `Course for ${title}`,
    questionContent: `Question for ${title}`,
    questionAnswer: true,
    questionScore: 100,
    durationMinutes: 60,
    passingScore: 60,
    totalScore: 100,
  });
}

const adminCookies = (token: string) => ({ "auth-token": token });

describe("exam state machine transitions", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("draft exam can be updated", async () => {
    const examId = await createExam(ctx, "SM Draft Update");

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: { title: "SM Updated Title" },
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("SM Updated Title");
  });

  it("draft exam can be published", async () => {
    const examId = await createExam(ctx, "SM Publish Draft");

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("published");
  });

  it("published exam cannot be republished", async () => {
    const examId = await createExam(ctx, "SM Republish");

    const firstRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });
    expect(firstRes.statusCode).toBe(200);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(409);
  });

  it("published exam can be archived", async () => {
    const examId = await createExam(ctx, "SM Archive");

    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });
    expect(publishRes.statusCode).toBe(200);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/archive`,
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("archived");
  });

  it("archived exam cannot be published", async () => {
    const examId = await createExam(ctx, "SM Archived Publish");

    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });
    expect(publishRes.statusCode).toBe(200);

    const archiveRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/archive`,
      cookies: adminCookies(ctx.adminToken),
    });
    expect(archiveRes.statusCode).toBe(200);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(409);
  });

  it("draft exam can be deleted", async () => {
    const examId = await createExam(ctx, "SM Delete Draft");

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exams/${examId}`,
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(204);
  });

  it("published exam cannot be deleted", async () => {
    const examId = await createExam(ctx, "SM Delete Published");

    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });
    expect(publishRes.statusCode).toBe(200);

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exams/${examId}`,
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(409);
  });
});

describe("exam auto-transition on access", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let candidateProfileId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
      await fastify.register(attemptRoutes);
    });

    const existing = await ctx.db
      .select({ id: schema.candidateProfiles.id })
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.userId, ctx.candidate.id));
    if (existing[0]) {
      candidateProfileId = existing[0].id;
    } else {
      const id = crypto.randomUUID();
      await ctx.db.insert(schema.candidateProfiles).values({
        id,
        organizationId: ctx.org.id,
        userId: ctx.candidate.id,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      candidateProfileId = id;
    }
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function enrollCandidate(examId: string) {
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: adminCookies(ctx.adminToken),
    });
  }

  it("published exam auto-opens when candidate accesses exam list past openAt", async () => {
    const openAt = new Date(Date.now() - 3600000);
    const closeAt = new Date(Date.now() + 86400000);
    const examId = await createExamWithTimeWindow(
      ctx,
      "Auto-Open List",
      openAt,
      closeAt,
    );

    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });
    expect(publishRes.statusCode).toBe(200);
    expect(publishRes.json().status).toBe("published");

    await enrollCandidate(examId);

    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate/exams",
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(listRes.statusCode).toBe(200);
    const exams = listRes.json();
    const target = exams.find((e: any) => e.examId === examId);
    expect(target).toBeDefined();
    expect(target.availabilityStatus).toBe("available");

    const examAfter = await ctx.db
      .select({ status: schema.exams.status })
      .from(schema.exams)
      .where(eq(schema.exams.id, examId));
    expect(examAfter[0]?.status).toBe("open");
  });

  it("published exam stays published when candidate accesses before openAt", async () => {
    const openAt = new Date(Date.now() + 86400000);
    const closeAt = new Date(Date.now() + 172800000);
    const examId = await createExamWithTimeWindow(
      ctx,
      "No Auto-Open",
      openAt,
      closeAt,
    );

    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });
    expect(publishRes.statusCode).toBe(200);

    await enrollCandidate(examId);

    await ctx.app.inject({
      method: "GET",
      url: "/api/candidate/exams",
      cookies: { "auth-token": ctx.candidateToken },
    });

    const examAfter = await ctx.db
      .select({ status: schema.exams.status })
      .from(schema.exams)
      .where(eq(schema.exams.id, examId));
    expect(examAfter[0]?.status).toBe("published");
  });

  it("open exam auto-closes when candidate accesses exam list past closeAt", async () => {
    const openAt = new Date(Date.now() - 172800000);
    const closeAt = new Date(Date.now() - 3600000);
    const examId = await createExamWithTimeWindow(
      ctx,
      "Auto-Close List",
      openAt,
      closeAt,
    );

    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });
    expect(publishRes.statusCode).toBe(200);

    await enrollCandidate(examId);

    const listRes1 = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate/exams",
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(listRes1.statusCode).toBe(200);
    const examAfterFirst = await ctx.db
      .select({ status: schema.exams.status })
      .from(schema.exams)
      .where(eq(schema.exams.id, examId));
    expect(examAfterFirst[0]?.status).toBe("closed");
  });

  it("published exam auto-opens on candidate start attempt", async () => {
    const openAt = new Date(Date.now() - 3600000);
    const closeAt = new Date(Date.now() + 86400000);
    const examId = await createExamWithTimeWindow(
      ctx,
      "Auto-Open Start",
      openAt,
      closeAt,
    );

    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });
    expect(publishRes.statusCode).toBe(200);

    await enrollCandidate(examId);

    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(startRes.statusCode).toBe(201);

    const examAfter = await ctx.db
      .select({ status: schema.exams.status })
      .from(schema.exams)
      .where(eq(schema.exams.id, examId));
    expect(examAfter[0]?.status).toBe("open");
  });
});

async function createExamWithTimeWindow(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  title: string,
  openAt: Date,
  closeAt: Date,
): Promise<string> {
  const courseRes = await ctx.app.inject({
    method: "POST",
    url: "/api/courses",
    payload: {
      name: `Course ${title}`,
      code: `CWT-${Date.now()}`,
      description: "",
    },
    cookies: adminCookies(ctx.adminToken),
  });
  const courseId = courseRes.json().id;

  const qRes = await ctx.app.inject({
    method: "POST",
    url: "/api/questions",
    payload: {
      courseId,
      type: "true_false",
      content: `Q ${title}`,
      standardAnswer: true,
      score: 100,
    },
    cookies: adminCookies(ctx.adminToken),
  });
  const questionId = qRes.json().id;

  const examRes = await ctx.app.inject({
    method: "POST",
    url: "/api/exams",
    payload: {
      title,
      courseId,
      durationMinutes: 60,
      openAt: openAt.toISOString(),
      closeAt: closeAt.toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionIds: [questionId],
    },
    cookies: adminCookies(ctx.adminToken),
  });
  return examRes.json().id;
}
