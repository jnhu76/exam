import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import proctorMonitoringRoutes from "./proctorMonitoring.js";
import {
  buildTestApp,
  createCandidateViaApi,
  createExamViaApi,
} from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createClientEventRepo } from "@exam/db/src/repository/clientEventRepo.js";

/**
 * T9 (#544): monitoring timeline ordering is owned by the server-stamped
 * `receivedAt` (+ id tiebreaker). A client cannot relocate its events — or
 * hijack pagination membership — with adversarial `occurredAt` extremes
 * (year 2099 / year 1970). `occurredAt` remains visible as display data.
 */
const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(courseRoutes);
  await fastify.register(questionRoutes);
  await fastify.register(candidateRoutes);
  await fastify.register(examRoutes);
  await fastify.register(attemptRoutes);
  await fastify.register(proctorMonitoringRoutes);
};

describe("proctor timeline ordering (receivedAt authority, #544)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let attemptId: string;
  let examId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });

    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: `TimelineExam-${randomUUID().slice(0, 8)}`,
      courseCode: `timeline-${randomUUID().slice(0, 8)}`,
      courseName: "Timeline Ordering Course",
      questionContent: "Timeline question",
      questionAnswer: true,
      questionScore: 10,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await ctx.db
      .update(schema.exams)
      .set({ status: "published" })
      .where(eq(schema.exams.id, examId));

    const cand = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `timeline-cand-${Date.now()}`,
      ctx.org.id,
    );
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [cand.candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    const start = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": cand.token },
    });
    expect(start.statusCode).toBe(201);
    attemptId = start.json().id as string;
  });

  afterAll(async () => {
    await ctx.db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.organizationId, ctx.org.id));
    await ctx.cleanup();
  });

  /** Seeds one event with fully controlled receivedAt AND occurredAt. */
  async function seedEvent(
    name: string,
    receivedAt: Date,
    occurredAt: Date,
  ): Promise<string> {
    await createClientEventRepo(ctx.db).createMany(
      {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate",
        permissions: [],
        sessionId: "timeline-sess",
      },
      [
        {
          userId: ctx.candidate.id,
          attemptId,
          examId,
          questionId: null,
          kind: "exam_telemetry",
          level: "info",
          name,
          route: null,
          occurredAt,
          receivedAt,
          clientSessionId: "timeline-sess",
          metadata: {},
          userAgent: null,
        },
      ],
    );
    return name;
  }

  it("orders by receivedAt even when occurredAt claims the extremes; pagination cannot be hijacked", async () => {
    const base = new Date("2026-09-15T10:00:00.000Z");
    const minute = (n: number) => new Date(base.getTime() + n * 60_000);

    // Insertion (receive) order: first, middle, last — but the first claims
    // year 2099 and the middle claims year 1970 in occurredAt.
    const first = await seedEvent(
      "timeline_first",
      minute(0),
      new Date("2099-01-01T00:00:00.000Z"),
    );
    const middle = await seedEvent(
      "timeline_middle",
      minute(5),
      new Date("1970-01-01T00:00:00.000Z"),
    );
    const last = await seedEvent(
      "timeline_last",
      minute(10),
      new Date("2026-09-15T10:09:30.000Z"),
    );

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${attemptId}/proctor-events`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{
      id: string;
      name: string;
      occurredAt: string;
    }>;
    const names = items.map((i) => i.name);

    // receive order wins: last (10m) > middle (5m) > first (0m). The 2099
    // claim does NOT move `first` to the head; the 1970 claim does not sink
    // `middle` to the tail.
    expect(names.indexOf("timeline_last")).toBeLessThan(
      names.indexOf("timeline_middle"),
    );
    expect(names.indexOf("timeline_middle")).toBeLessThan(
      names.indexOf("timeline_first"),
    );
    // occurredAt is still displayed for each row (advisory field present).
    const firstItem = items.find((i) => i.name === "timeline_first")!;
    expect(firstItem.occurredAt).toBe("2099-01-01T00:00:00.000Z");

    // Page membership follows the same authority: with limit=1, page 1 is
    // the newest RECEIVED event, never the 2099-claimed one.
    const page1 = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${attemptId}/proctor-events?limit=1&page=1`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const p1Items = page1.json().items as Array<{ name: string }>;
    expect(p1Items).toHaveLength(1);
    expect(p1Items[0]!.name).toBe("timeline_last");
  });
});
