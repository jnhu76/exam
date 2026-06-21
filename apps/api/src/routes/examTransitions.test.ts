import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import candidateRoutes from "./candidate.js";
import auditRoutes from "./audit.js";
import {
  buildTestApp,
  uniquePrefix,
  createCandidateViaApi,
} from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";

const adminCookies = (token: string) => ({ "auth-token": token });

let examCounter = 0;

async function createExamWithTimeWindow(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  title: string,
  openAt: Date,
  closeAt: Date,
): Promise<string> {
  examCounter++;
  const courseRes = await ctx.app.inject({
    method: "POST",
    url: "/api/courses",
    payload: {
      name: `Course ${title}`,
      code: `CTC-${examCounter}-${Date.now().toString(36)}`,
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

async function getExamStatus(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  examId: string,
): Promise<string> {
  const rows = await ctx.db
    .select({ status: schema.exams.status })
    .from(schema.exams)
    .where(eq(schema.exams.id, examId));
  return rows[0]?.status ?? "missing";
}

async function waitForAuditCount(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  action: string,
  targetId: string,
  want: number,
  timeoutMs = 1000,
): Promise<number> {
  for (let i = 0; i < Math.ceil(timeoutMs / 50); i++) {
    const auditRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/audit-logs?action=${action}`,
      cookies: adminCookies(ctx.adminToken),
    });
    const rows =
      auditRes.statusCode === 200 ? (auditRes.json().items ?? []) : [];
    const mine = rows.filter(
      (r: { targetId: string }) => r.targetId === targetId,
    );
    if (mine.length >= want) return mine.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return -1;
}

describe("exam reconciliation characterization (P2D-J2.6)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let candidateProfileId: string;
  let candidateToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(auditRoutes);
    });

    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `recon-${uniquePrefix()}`,
      ctx.org.id,
    );
    candidateProfileId = candidate.candidateProfileId;
    candidateToken = candidate.token;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function enroll(examId: string) {
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: adminCookies(ctx.adminToken),
    });
  }

  describe("candidate-triggered reconciliation: published -> open", () => {
    it("candidate exam list reconciles published -> open and writes exam.open audit", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Recon Pub->Open",
        new Date(Date.now() - 60_000),
        new Date(Date.now() + 86_400_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });
      await enroll(examId);

      const listRes = await ctx.app.inject({
        method: "GET",
        url: "/api/candidate/exams",
        cookies: { "auth-token": candidateToken },
      });
      expect(listRes.statusCode).toBe(200);

      expect(await getExamStatus(ctx, examId)).toBe("open");
      expect(await waitForAuditCount(ctx, "exam.open", examId, 1)).toBe(1);
    });

    it("candidate start attempt reconciles published -> open", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Recon Start",
        new Date(Date.now() - 60_000),
        new Date(Date.now() + 86_400_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });
      await enroll(examId);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": candidateToken },
      });
      expect(startRes.statusCode).toBe(201);

      expect(await getExamStatus(ctx, examId)).toBe("open");
    });
  });

  describe("candidate-triggered reconciliation: open -> closed", () => {
    it("candidate exam list reconciles published->open->closed and writes both exam.open and exam.closed audits", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Recon Open->Closed",
        new Date(Date.now() - 172_800_000),
        new Date(Date.now() - 60_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });
      await enroll(examId);

      const listRes = await ctx.app.inject({
        method: "GET",
        url: "/api/candidate/exams",
        cookies: { "auth-token": candidateToken },
      });
      expect(listRes.statusCode).toBe(200);

      expect(await getExamStatus(ctx, examId)).toBe("closed");
      expect(await waitForAuditCount(ctx, "exam.open", examId, 1)).toBe(1);
      expect(await waitForAuditCount(ctx, "exam.closed", examId, 1)).toBe(1);
    });
  });

  describe("reconciliation idempotency", () => {
    it("repeated candidate access does not write duplicate exam.open audit", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Recon Idempotent",
        new Date(Date.now() - 60_000),
        new Date(Date.now() + 86_400_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });
      await enroll(examId);

      await ctx.app.inject({
        method: "GET",
        url: "/api/candidate/exams",
        cookies: { "auth-token": candidateToken },
      });
      expect(await waitForAuditCount(ctx, "exam.open", examId, 1)).toBe(1);

      await ctx.app.inject({
        method: "GET",
        url: "/api/candidate/exams",
        cookies: { "auth-token": candidateToken },
      });
      await ctx.app.inject({
        method: "GET",
        url: "/api/candidate/exams",
        cookies: { "auth-token": candidateToken },
      });

      await new Promise((resolve) => setTimeout(resolve, 200));
      const count = await waitForAuditCount(ctx, "exam.open", examId, 1);
      expect(count).toBe(1);
    });
  });

  describe("admin route reconciliation: close", () => {
    it("close after reconciliation triggers open->closed writes exam.closed audit (not exam.close)", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Close Recon No Dup",
        new Date(Date.now() - 172_800_000),
        new Date(Date.now() - 60_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/close`,
        payload: {},
        cookies: adminCookies(ctx.adminToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("closed");

      // Reconciliation did published→open→closed in one pass.
      expect(await waitForAuditCount(ctx, "exam.open", examId, 1)).toBe(1);
      expect(await waitForAuditCount(ctx, "exam.closed", examId, 1)).toBe(1);

      // The close command was a no-op — exam.close audit is NOT written.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const closeCount = await waitForAuditCount(ctx, "exam.close", examId, 1);
      expect(closeCount).toBe(-1);
    });
  });

  describe("admin route reconciliation: unpublish", () => {
    it("unpublish of a stale published (now open) exam is rejected -> 409", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Unpublish Stale",
        new Date(Date.now() - 60_000),
        new Date(Date.now() + 86_400_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/unpublish`,
        cookies: adminCookies(ctx.adminToken),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("EXAM_UNPUBLISH_NOT_ALLOWED");
    });
  });

  describe("admin route reconciliation: extend", () => {
    it("extend of a stale open (now closed) exam is rejected -> 409 ALREADY_CLOSED", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Extend Stale",
        new Date(Date.now() - 172_800_000),
        new Date(Date.now() - 60_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/extend`,
        payload: { extendMinutes: 15 },
        cookies: adminCookies(ctx.adminToken),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("EXAM_EXTEND_NOT_ALLOWED");
      expect(res.json().error.details?.reason).toBe("ALREADY_CLOSED");
    });
  });

  describe("admin route reconciliation: cancel", () => {
    it("cancel of a stale open (now closed) exam is rejected -> 409", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Cancel Stale",
        new Date(Date.now() - 172_800_000),
        new Date(Date.now() - 60_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/cancel`,
        payload: {},
        cookies: adminCookies(ctx.adminToken),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("EXAM_CANCEL_NOT_ALLOWED");
    });
  });

  describe("admin route reconciliation: archive", () => {
    it("archive after reconciliation (published->open->closed) writes exam.open, exam.closed, and exam.archive audits", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Archive Recon",
        new Date(Date.now() - 172_800_000),
        new Date(Date.now() - 60_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/archive`,
        cookies: adminCookies(ctx.adminToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("archived");

      // Reconciliation did published→open→closed in one pass.
      expect(await waitForAuditCount(ctx, "exam.open", examId, 1)).toBe(1);
      expect(await waitForAuditCount(ctx, "exam.closed", examId, 1)).toBe(1);
      // Explicit archive action audit.
      expect(await waitForAuditCount(ctx, "exam.archive", examId, 1)).toBe(1);
    });

    it("archive idempotency: already-archived returns 200 with NO duplicate audit", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Archive Idem Recon",
        new Date(Date.now() + 3600_000),
        new Date(Date.now() + 172_800_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/archive`,
        cookies: adminCookies(ctx.adminToken),
      });
      expect(await waitForAuditCount(ctx, "exam.archive", examId, 1)).toBe(1);

      const second = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/archive`,
        cookies: adminCookies(ctx.adminToken),
      });
      expect(second.statusCode).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 200));
      const count = await waitForAuditCount(ctx, "exam.archive", examId, 2);
      expect(count).toBe(-1);
    });
  });

  describe("audit behavior characterization", () => {
    it("successful close writes exam.close audit with fromStatus/toStatus metadata", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Close Audit Meta",
        new Date(Date.now() - 60_000),
        new Date(Date.now() + 86_400_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/extend`,
        payload: { extendMinutes: 30 },
        cookies: adminCookies(ctx.adminToken),
      });

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/close`,
        payload: { reason: "done" },
        cookies: adminCookies(ctx.adminToken),
      });
      expect(await waitForAuditCount(ctx, "exam.close", examId, 1)).toBe(1);

      const auditRes = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/audit-logs?action=exam.close`,
        cookies: adminCookies(ctx.adminToken),
      });
      const rows = auditRes.json().items as any[];
      const mine = rows.filter((r) => r.targetId === examId);
      expect(mine[0]?.metadata?.fromStatus).toBe("open");
      expect(mine[0]?.metadata?.toStatus).toBe("closed");
      expect(mine[0]?.metadata?.reason).toBe("done");
    });

    it("admin GET (non-mutating) does not reconcile; candidate list does", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Recon Audit Asymmetry",
        new Date(Date.now() - 60_000),
        new Date(Date.now() + 86_400_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });
      await enroll(examId);

      const adminGetRes = await ctx.app.inject({
        method: "GET",
        url: `/api/exams/${examId}`,
        cookies: adminCookies(ctx.adminToken),
      });
      expect(adminGetRes.statusCode).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 200));
      const countBeforeCandidate = await waitForAuditCount(
        ctx,
        "exam.open",
        examId,
        1,
      );
      expect(countBeforeCandidate).toBe(-1);

      await ctx.app.inject({
        method: "GET",
        url: "/api/candidate/exams",
        cookies: { "auth-token": candidateToken },
      });
      expect(await waitForAuditCount(ctx, "exam.open", examId, 1)).toBe(1);
    });

    it("admin extend on stale-published reconciles and writes exam.open audit", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Extend Recon Open",
        new Date(Date.now() - 60_000),
        new Date(Date.now() + 86_400_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/extend`,
        payload: { extendMinutes: 30 },
        cookies: adminCookies(ctx.adminToken),
      });
      expect(res.statusCode).toBe(200);

      expect(await waitForAuditCount(ctx, "exam.open", examId, 1)).toBe(1);
      expect(await waitForAuditCount(ctx, "exam.extend", examId, 1)).toBe(1);
    });

    it("admin cancel on stale-published reconciles and writes exam.open audit", async () => {
      const examId = await createExamWithTimeWindow(
        ctx,
        "Cancel Recon Open",
        new Date(Date.now() - 60_000),
        new Date(Date.now() + 86_400_000),
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: adminCookies(ctx.adminToken),
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/cancel`,
        payload: {},
        cookies: adminCookies(ctx.adminToken),
      });
      expect(res.statusCode).toBe(200);

      expect(await waitForAuditCount(ctx, "exam.open", examId, 1)).toBe(1);
      expect(await waitForAuditCount(ctx, "exam.cancel", examId, 1)).toBe(1);
    });
  });
});
