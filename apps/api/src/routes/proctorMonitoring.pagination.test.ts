import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
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
 * MAJOR-2 corrective: merged timeline pagination.
 *
 * Proves correct pagination when client_events and audit_logs are merged
 * into a single global-order timeline. Each test seeds controlled rows
 * with deterministic server-owned timestamps, then verifies page membership,
 * ordering, total, and totalPages via the GET /admin/attempts/:id/proctor-events
 * endpoint.
 */
const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(courseRoutes);
  await fastify.register(questionRoutes);
  await fastify.register(candidateRoutes);
  await fastify.register(examRoutes);
  await fastify.register(attemptRoutes);
  await fastify.register(proctorMonitoringRoutes);
};

describe("proctor timeline pagination (M2 corrective)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let attemptId: string;
  let examId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });

    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: `PaginationExam-${randomUUID().slice(0, 8)}`,
      courseCode: `pagination-${randomUUID().slice(0, 8)}`,
      courseName: "Pagination Course",
      questionContent: "Pagination question",
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
      `pagination-cand-${Date.now()}`,
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
    await ctx.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, ctx.org.id));
    await ctx.cleanup();
  });

  // Single cleanup authority: a failing test must not leak rows into the
  // next case's total/membership assertions (P4b/P5/P6 count exactly).
  afterEach(async () => {
    await ctx.db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.organizationId, ctx.org.id));
    await ctx.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, ctx.org.id));
  });

  /** Seeds one client event with a fully controlled receivedAt. */
  async function seedClientEvent(
    name: string,
    receivedAt: Date,
    opts?: { occurredAt?: Date },
  ): Promise<void> {
    await createClientEventRepo(ctx.db).createMany(
      {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate",
        permissions: [],
        sessionId: "pagination-sess",
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
          occurredAt: opts?.occurredAt ?? receivedAt,
          receivedAt,
          clientSessionId: "pagination-sess",
          metadata: {},
          userAgent: null,
        },
      ],
    );
  }

  /** Seeds one audit log with a fully controlled createdAt. */
  async function seedAuditEvent(
    action: string,
    createdAt: Date,
  ): Promise<void> {
    await ctx.db.insert(schema.auditLogs).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      actorId: ctx.candidate.id,
      action,
      targetType: "attempt",
      targetId: attemptId,
      metadata: { requestId: "pagination-test" },
      createdAt,
    });
  }

  async function fetchTimeline(
    limit: number,
    page: number,
  ): Promise<{
    items: Array<{ id: string; name: string; source: string }>;
    total: number;
    totalPages: number;
  }> {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${attemptId}/proctor-events?limit=${limit}&page=${page}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  // P1: one-source dominated page 2 — 5 client events, 0 audit events
  it("P1: one-source dominated page 2 returns correct items", async () => {
    const base = new Date("2026-09-15T10:00:00.000Z");
    const minute = (n: number) => new Date(base.getTime() + n * 60_000);

    // Insert 5 client events at t=0,1,2,3,4 (newest-first order: C4,C3,C2,C1,C0).
    for (let i = 0; i < 5; i++) {
      await seedClientEvent(`p1_client_${i}`, minute(i));
    }

    // limit=2 page=2 → expect C2 and C1 (positions 2-3 in the global order).
    const page2 = await fetchTimeline(2, 2);
    expect(page2.total).toBe(5);
    expect(page2.totalPages).toBe(3);
    expect(page2.items).toHaveLength(2);
    const names = page2.items.map((i) => i.name);
    expect(names).toContain("p1_client_2");
    expect(names).toContain("p1_client_1");
    // C2 was received at t=2, C1 at t=1, so C2 is newer.
    expect(names.indexOf("p1_client_2")).toBeLessThan(
      names.indexOf("p1_client_1"),
    );

    // page=3 → expect C0.
    const page3 = await fetchTimeline(2, 3);
    expect(page3.items).toHaveLength(1);
    expect(page3.items[0]!.name).toBe("p1_client_0");
  });

  // P2: mixed source interleave — client and audit events interleave by
  //     server-owned instant.
  it("P2: mixed source interleave respects global ordering across pages", async () => {
    const base = new Date("2026-09-15T11:00:00.000Z");
    const minute = (n: number) => new Date(base.getTime() + n * 60_000);

    // Construct: C5 t=50, A4 t=40, C3 t=30, A2 t=20, C1 t=10
    await seedClientEvent("p2_C5", minute(50));
    await seedAuditEvent("attempt.timeGrant", minute(40));
    await seedClientEvent("p2_C3", minute(30));
    await seedAuditEvent("attempt.forceSubmit", minute(20));
    await seedClientEvent("p2_C1", minute(10));

    // limit=2 page=1 → C5, A4 (newest two)
    const page1 = await fetchTimeline(2, 1);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0]!.name).toBe("p2_C5");
    expect(page1.items[0]!.source).toBe("client_event");
    expect(page1.items[1]!.name).toBe("grant_time");
    expect(page1.items[1]!.source).toBe("audit_log");

    // limit=2 page=2 → C3, A2
    const page2 = await fetchTimeline(2, 2);
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0]!.name).toBe("p2_C3");
    expect(page2.items[1]!.name).toBe("force_submit");

    // limit=2 page=3 → C1 only
    const page3 = await fetchTimeline(2, 3);
    expect(page3.items).toHaveLength(1);
    expect(page3.items[0]!.name).toBe("p2_C1");
  });

  // P3: occurredAt adversarial on page 2 — extreme occurredAt values cannot
  //     change page membership, global ordering, or total.
  it("P3: adversarial occurredAt does not affect pagination", async () => {
    const base = new Date("2026-09-15T12:00:00.000Z");
    const minute = (n: number) => new Date(base.getTime() + n * 60_000);

    // C_normal at t=0 with normal occurredAt
    await seedClientEvent("p3_Cnormal", minute(0));
    // C_futuro at t=1 with occurredAt = year 2099
    await seedClientEvent("p3_Cfuturo", minute(1), {
      occurredAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    // C_pasto at t=2 with occurredAt = year 1970
    await seedClientEvent("p3_Cpasto", minute(2), {
      occurredAt: new Date("1970-01-01T00:00:00.000Z"),
    });
    // C_later at t=3 with normal occurredAt
    await seedClientEvent("p3_Clater", minute(3));
    // C_last at t=4
    await seedClientEvent("p3_Clast", minute(4));

    // Total must be 5 regardless of occurredAt extremes.
    const all = await fetchTimeline(10, 1);
    expect(all.total).toBe(5);
    expect(all.totalPages).toBe(1);
    const allNames = all.items.map((i) => i.name);
    // Order by receivedAt: C_last(4) > Clater(3) > Cpasto(2) > Cfuturo(1) > Cnormal(0)
    expect(allNames).toEqual([
      "p3_Clast",
      "p3_Clater",
      "p3_Cpasto",
      "p3_Cfuturo",
      "p3_Cnormal",
    ]);

    // page=2 with limit=2 → positions 2-3 = Cpasto, Cfuturo
    const page2 = await fetchTimeline(2, 2);
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0]!.name).toBe("p3_Cpasto");
    expect(page2.items[1]!.name).toBe("p3_Cfuturo");

    // 2099 event is NOT at position 0; 1970 event is NOT at the tail.
    expect(allNames[0]).toBe("p3_Clast"); // NOT Cfuturo
    expect(allNames[allNames.length - 1]).toBe("p3_Cnormal"); // NOT Cpasto
  });

  // P4: irrelevant audit actions — audit rows with non-timeline actions must
  //     not appear in items and must not inflate total.
  it("P4: irrelevant audit actions excluded from timeline items and total", async () => {
    const base = new Date("2026-09-15T13:00:00.000Z");
    const minute = (n: number) => new Date(base.getTime() + n * 60_000);

    // Seed relevant timeline events: 2 client + 1 timeline audit
    await seedClientEvent("p4_C1", minute(0));
    await seedClientEvent("p4_C2", minute(10));
    await seedAuditEvent("attempt.timeGrant", minute(5));

    // Seed irrelevant audit actions for the same attempt — these must NOT
    // appear in the timeline and must NOT inflate the total.
    const irrelevantActions = [
      "attempt.created",
      "attempt.submitted",
      "attempt.graded",
      "candidate.enrolled",
    ];
    for (let i = 0; i < irrelevantActions.length; i++) {
      await ctx.db.insert(schema.auditLogs).values({
        id: randomUUID(),
        organizationId: ctx.org.id,
        actorId: ctx.candidate.id,
        action: irrelevantActions[i]!,
        targetType: "attempt",
        targetId: attemptId,
        metadata: { requestId: "p4-irrelevant" },
        createdAt: minute(i + 1),
      });
    }

    // Total should be 3 (2 client + 1 timeline audit), not 7.
    const all = await fetchTimeline(10, 1);
    expect(all.total).toBe(3);
    expect(all.totalPages).toBe(1);
    expect(all.items).toHaveLength(3);

    // Verify no irrelevant action names appear.
    const itemNames = all.items.map((i) => i.name);
    expect(itemNames).not.toContain("attempt.created");
    expect(itemNames).not.toContain("attempt.submitted");
    expect(itemNames).not.toContain("attempt.graded");
    expect(itemNames).not.toContain("candidate.enrolled");
  });

  // P4b: adversarial — 55 irrelevant audit rows, ALL newer than the single
  // relevant audit row. The timeline admission predicate (action IN ...) must
  // be applied in SQL BEFORE LIMIT: a newer irrelevant prefix must not crowd
  // the admitted audit row out of the fetch window. An under-filled page here
  // is a defect, not an accepted outcome.
  it("P4b: newer irrelevant audit prefix must not hide admitted rows", async () => {
    const base = new Date("2026-09-15T14:00:00.000Z");
    const second = (n: number) => new Date(base.getTime() + n * 1000);

    // 1 relevant timeline audit row at t=0 — older than every irrelevant row.
    await seedAuditEvent("attempt.forceSubmit", second(0));
    // 2 client events at t=5, t=10.
    await seedClientEvent("p4b_C1", second(5));
    await seedClientEvent("p4b_C2", second(10));

    // 55 irrelevant audit rows with NEWER timestamps (t=1..55).
    const irrelevantActions = [
      "attempt.created",
      "attempt.submitted",
      "attempt.graded",
      "candidate.enrolled",
    ];
    for (let i = 1; i <= 55; i++) {
      await ctx.db.insert(schema.auditLogs).values({
        id: randomUUID(),
        organizationId: ctx.org.id,
        actorId: ctx.candidate.id,
        action: irrelevantActions[i % irrelevantActions.length]!,
        targetType: "attempt",
        targetId: attemptId,
        metadata: { requestId: "p4b-irrelevant" },
        createdAt: second(i),
      });
    }

    // limit=10: the irrelevant prefix (55 rows) alone exceeds the fetch window.
    const res = await fetchTimeline(10, 1);
    expect(res.total).toBe(3);
    expect(res.totalPages).toBe(1);
    expect(res.items).toHaveLength(3);
    expect(res.items.map((i) => i.name)).toEqual([
      "p4b_C2",
      "p4b_C1",
      "force_submit",
    ]);
    expect(res.items.map((i) => i.source)).toEqual([
      "client_event",
      "client_event",
      "audit_log",
    ]);
  });
  it("P5: page 2 reaches past a 150-row client-event source", async () => {
    const base = new Date("2026-09-15T15:00:00.000Z");
    const at = (n: number) => new Date(base.getTime() + n * 1000);

    // 145 events with distinct receivedAt: e_i at base + i seconds.
    // Newest-first global order: e144 is position 1 ... e0 is position 145.
    const rows = Array.from({ length: 145 }, (_, i) => ({
      userId: ctx.candidate.id,
      attemptId,
      examId,
      questionId: null,
      kind: "exam_telemetry",
      level: "info",
      name: `p5_e${i}`,
      route: null,
      occurredAt: at(i),
      receivedAt: at(i),
      clientSessionId: "p5-sess",
      metadata: {},
      userAgent: null,
    }));
    await createClientEventRepo(ctx.db).createMany(
      {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate",
        permissions: [],
        sessionId: "p5-sess",
      },
      rows,
    );

    // 5 tied OLDEST events at base-1s sharing one receivedAt, with fixed
    // ascending ids (01 < ... < 05): they occupy global positions 146..150
    // and must surface in id DESC order — proves the tiebreaker at the tail.
    const tiedIds = [1, 2, 3, 4, 5].map(
      (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    );
    for (let n = 1; n <= 5; n++) {
      await ctx.db.insert(schema.clientEvents).values({
        id: tiedIds[n - 1]!,
        organizationId: ctx.org.id,
        userId: ctx.candidate.id,
        attemptId,
        examId,
        questionId: null,
        kind: "exam_telemetry",
        level: "info",
        name: `p5_f${n}`,
        route: null,
        occurredAt: at(-1),
        receivedAt: at(-1),
        clientSessionId: "p5-sess",
        metadata: {},
        userAgent: null,
      });
    }

    const eNames = (from: number, to: number) =>
      Array.from({ length: from - to + 1 }, (_, k) => `p5_e${from - k}`);

    // Page 1 = global positions 1..100 = e144..e45.
    const page1 = await fetchTimeline(100, 1);
    expect(page1.total).toBe(150);
    expect(page1.totalPages).toBe(2);
    expect(page1.items.map((i) => i.name)).toEqual(eNames(144, 45));

    // Page 2 = global positions 101..150 = e44..e0, then the tied tail in
    // id DESC order (f5..f1).
    const page2 = await fetchTimeline(100, 2);
    expect(page2.total).toBe(150);
    expect(page2.totalPages).toBe(2);
    expect(page2.items).toHaveLength(50);
    expect(page2.items.map((i) => i.name)).toEqual([
      ...eNames(44, 0),
      "p5_f5",
      "p5_f4",
      "p5_f3",
      "p5_f2",
      "p5_f1",
    ]);
  });

  // P6: page 2 past a >100-row AUDIT source — the page must be the global
  // tail across sources, not a per-source window. 30 client events at even
  // seconds, 110 timeline audit rows at odd seconds: 140 admitted rows on
  // strictly alternating instants.
  it("P6: page 2 past a >100-row audit source is globally merged", async () => {
    const base = new Date("2026-09-15T16:00:00.000Z");
    const at = (n: number) => new Date(base.getTime() + n * 1000);

    // C_j at s=2j (j=0..29), A_j at s=2j+1 (j=0..109). Newest first: A109
    // (s=219) ... C0 (s=0). Global positions 101..140 ↔ seconds 39..0.
    for (let j = 0; j < 30; j++) {
      await seedClientEvent(`p6_C${j}`, at(2 * j));
    }
    for (let j = 0; j < 110; j++) {
      await seedAuditEvent("attempt.timeGrant", at(2 * j + 1));
    }

    const page1 = await fetchTimeline(100, 1);
    expect(page1.total).toBe(140);
    expect(page1.totalPages).toBe(2);
    expect(page1.items).toHaveLength(100);
    expect(page1.items[0]!.name).toBe("grant_time");
    expect(page1.items[0]!.source).toBe("audit_log");

    const page2 = await fetchTimeline(100, 2);
    expect(page2.total).toBe(140);
    expect(page2.totalPages).toBe(2);
    expect(page2.items).toHaveLength(40);

    // Exact global membership: seconds 39..0 alternate audit/client.
    const expected: Array<{ name: string; source: string }> = [];
    for (let s = 39; s >= 0; s--) {
      expected.push({
        name: s % 2 === 1 ? "grant_time" : `p6_C${s / 2}`,
        source: s % 2 === 1 ? "audit_log" : "client_event",
      });
    }
    expect(
      page2.items.map((i) => ({ name: i.name, source: i.source })),
    ).toEqual(expected);
  });
});
