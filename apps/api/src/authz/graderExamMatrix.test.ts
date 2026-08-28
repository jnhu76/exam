import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import courseRoutes from "../routes/course.js";
import questionRoutes from "../routes/question.js";
import examRoutes from "../routes/exam.js";
import attemptRoutes from "../routes/attempts.js";
import candidateRoutes from "../routes/candidate.js";
import scoreRoutes from "../routes/scores.js";
import { adminGraderAssignmentRoutes } from "../routes/graderAssignments.admin.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  createCandidateViaApi,
  uniquePrefix,
  type TestContext,
} from "../routes/testHelpers.js";

/**
 * Issue #296 — Grader@Exam adversarial scope matrix (Exam A / Exam B).
 *
 * One Grader (G) holds an ACTIVE grader_exam_assignments row for Exam A
 * ONLY. The matrix proves, endpoint by endpoint, that:
 *   - the grading-queue LIST shows only Exam A rows and the pagination TOTAL
 *     reflects the scope BEFORE pagination (list and count agree);
 *   - an EMPTY assignment set sees an empty queue (never org-wide);
 *   - grading detail/write fold out-of-scope probes into the canonical 404
 *     (anti-enumeration — never a 403 that leaks existence);
 *   - a bare Grader role WITHOUT assignments sees nothing (role ≠ resource
 *     assignment; the scope row alone grants nothing);
 *   - multi-role combinations stay correct (Admin+Grader → org-wide via the
 *     Admin short-circuit; Teacher+Grader → the Teacher course assignment
 *     grants NO grading scope and the Grader exam assignment grants NO
 *     course authority);
 *   - revocation is effective on the NEXT request.
 */
describe("Grader@Exam scope matrix (issue #296)", () => {
  let ctx: TestContext;
  let courseAId: string;
  let courseBId: string;
  let examAId: string;
  let examBId: string;
  let examAQuestionId: string;
  let examBQuestionId: string;
  let graderToken = "";
  let graderUserId = "";
  let unassignedGraderToken = "";
  let unassignedGraderUserId = "";
  let adminGraderToken = "";
  let teacherGraderToken = "";
  let teacherGraderUserId = "";

  /**
   * Pending attempt ids in submission order:
   * [0]=A#1, [1]=A#2, [2]=B#1, [3]=B#2. The Admin-parity test grades B#1
   * (flipping it out of the pending queue), so B#2 remains the untouched
   * out-of-scope pending probe for the later grant tests.
   */
  const attemptIds: string[] = [];

  const tGet = (url: string, token = graderToken) =>
    ctx.app.inject({ method: "GET", url, cookies: { "auth-token": token } });
  const tPost = (url: string, payload: unknown, token = graderToken) =>
    ctx.app.inject({
      method: "POST",
      url,
      cookies: { "auth-token": token },
      payload,
    });

  /** Grant a grader exam assignment through the REAL Admin API. */
  const grantExam = async (userId: string, examId: string) => {
    const res = await tPost(
      `/api/admin/users/${userId}/exam-assignments`,
      { examId },
      ctx.adminToken,
    );
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { outcome: string };
  };

  const revokeExam = async (userId: string, examId: string) => {
    const res = await tPost(
      `/api/admin/users/${userId}/exam-assignments/${examId}/revoke`,
      {},
      ctx.adminToken,
    );
    expect(res.statusCode, res.body).toBe(200);
  };

  /**
   * Creates + publishes an exam seeded with ONE text_response question
   * (score 100, rubric set) — the manual-graded substrate for queue work.
   */
  const createManualExam = async (
    courseId: string,
    examTitle: string,
  ): Promise<{ examId: string; questionId: string }> => {
    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "text_response",
        content: `论述题 ${examTitle}`,
        standardAnswer: null,
        rubric: `按逻辑完整性给分（${examTitle}）`,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(qRes.statusCode, qRes.body).toBe(201);
    const questionId = (qRes.json() as { id: string }).id;

    const now = new Date();
    const eRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: examTitle,
        courseId,
        durationMinutes: 60,
        openAt: now.toISOString(),
        closeAt: new Date(now.getTime() + 86_400_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(eRes.statusCode, eRes.body).toBe(201);
    const examId = (eRes.json() as { id: string }).id;

    const pubRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(pubRes.statusCode, pubRes.body).toBe(200);
    return { examId, questionId };
  };

  /**
   * Drives one real candidate submission on an already-published exam —
   * the attempt lands with pending_manual grading entries, i.e. REAL queue
   * work (the queue reads attempt_grading_entries, never fabricated state).
   */
  const submitCandidateOnExam = async (
    examId: string,
    questionId: string,
    candidateUsername: string,
  ): Promise<string> => {
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      candidateUsername,
      ctx.org.id,
    );
    const enrollRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidate.candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(enrollRes.statusCode, enrollRes.body).toBe(200);

    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidate.token },
    });
    expect(startRes.statusCode, startRes.body).toBe(201);
    const attemptId = (startRes.json() as { id: string }).id;

    const answerRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer: "我的论述作答",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": candidate.token },
    });
    expect(answerRes.statusCode, answerRes.body).toBe(200);

    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": candidate.token },
    });
    expect(submitRes.statusCode, submitRes.body).toBe(200);
    expect(
      (submitRes.json() as { status: string }).status,
      "text_response submission must land pending manual grading",
    ).toBe("submitted");

    attemptIds.push(attemptId);
    return attemptId;
  };

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(scoreRoutes);
      await fastify.register(adminGraderAssignmentRoutes);
    });

    const createCourse = async (name: string, code: string) => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/courses",
        payload: { name, code, description: "" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    };
    courseAId = await createCourse("GMatrix Course A", `GA-${uniquePrefix()}`);
    courseBId = await createCourse("GMatrix Course B", `GB-${uniquePrefix()}`);

    const examA = await createManualExam(
      courseAId,
      `GMatrix Exam A ${uniquePrefix()}`,
    );
    examAId = examA.examId;
    examAQuestionId = examA.questionId;
    const examB = await createManualExam(
      courseBId,
      `GMatrix Exam B ${uniquePrefix()}`,
    );
    examBId = examB.examId;
    examBQuestionId = examB.questionId;

    // Two pending attempts per exam: scope totals are provable (2 in-scope,
    // 2 out-of-scope) and the Admin-parity grading of B#1 leaves B#2 pending.
    await submitCandidateOnExam(
      examAId,
      examAQuestionId,
      `gmatrix-cand-a1-${uniquePrefix()}`,
    );
    await submitCandidateOnExam(
      examAId,
      examAQuestionId,
      `gmatrix-cand-a2-${uniquePrefix()}`,
    );
    await submitCandidateOnExam(
      examBId,
      examBQuestionId,
      `gmatrix-cand-b1-${uniquePrefix()}`,
    );
    await submitCandidateOnExam(
      examBId,
      examBQuestionId,
      `gmatrix-cand-b2-${uniquePrefix()}`,
    );

    // Grader G: active assignment to Exam A ONLY, granted via the REAL API
    // (product path proof + outcome contract).
    const grader = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Grader",
      "gmatrix-grader",
    );
    graderToken = grader.token;
    graderUserId = grader.user.id;
    const assigned = await grantExam(graderUserId, examAId);
    expect(assigned.outcome).toBe("applied");

    // Bare Grader role, ZERO exam assignments.
    const bare = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Grader",
      "gmatrix-grader-noassign",
    );
    unassignedGraderToken = bare.token;
    unassignedGraderUserId = bare.user.id;

    // Admin+Grader: secondary Grader assignment on the primary Admin.
    const adminGrader = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Admin",
      "gmatrix-admin-grader",
    );
    const now2 = new Date();
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      userId: adminGrader.user.id,
      role: "Grader",
      isPrimary: false,
      isActive: true,
      createdAt: now2,
      updatedAt: now2,
    });
    adminGraderToken = adminGrader.token;

    // Teacher+Grader: Teacher holds Course A (teacher authority) AND a
    // secondary Grader role with ZERO exam assignments — neither side
    // widens the other.
    const teacherGrader = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "gmatrix-teacher-grader",
    );
    teacherGraderUserId = teacherGrader.user.id;
    teacherGraderToken = teacherGrader.token;
    const now3 = new Date();
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      userId: teacherGraderUserId,
      role: "Grader",
      isPrimary: false,
      isActive: true,
      createdAt: now3,
      updatedAt: now3,
    });
    await ctx.db.insert(schema.teacherCourseAssignments).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      teacherUserId: teacherGraderUserId,
      courseId: courseAId,
      status: "active",
      assignedBy: ctx.admin.id,
      assignedAt: now3,
      revokedBy: null,
      revokedAt: null,
      createdAt: now3,
      updatedAt: now3,
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── Queue LIST (filter BEFORE pagination + totals) ──

  it("GET /admin/grading-queue — Grader sees only Exam A rows, never Exam B", async () => {
    const res = await tGet("/api/admin/grading-queue");
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ examId: string; attemptId: string }>;
      total: number;
    };
    const examIds = body.items.map((i) => i.examId);
    expect(examIds).toContain(examAId);
    expect(examIds).not.toContain(examBId);
    expect(body.items.length).toBe(2);
    expect(body.total).toBe(2);
  });

  it("queue TOTAL reflects the scope BEFORE pagination (pageSize=1 keeps total=2)", async () => {
    const res = await tGet("/api/admin/grading-queue?page=1&pageSize=1");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; total: number };
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(2);
  });

  it("examId filter IN scope returns that exam's rows; OUT of scope returns zero rows (never an error leak)", async () => {
    const inScope = await tGet(`/api/admin/grading-queue?examId=${examAId}`);
    expect(inScope.statusCode).toBe(200);
    const inBody = inScope.json() as { items: unknown[]; total: number };
    expect(inBody.total).toBe(2);

    const outScope = await tGet(`/api/admin/grading-queue?examId=${examBId}`);
    expect(outScope.statusCode).toBe(200);
    const outBody = outScope.json() as { items: unknown[]; total: number };
    expect(outBody.items).toHaveLength(0);
    expect(outBody.total).toBe(0);
  });

  it("bare Grader (zero assignments) sees an EMPTY queue with total 0 (never org-wide)", async () => {
    const res = await tGet("/api/admin/grading-queue", unassignedGraderToken);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; total: number };
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it("Admin queue is org-wide (all 4 pending attempts)", async () => {
    const res = await tGet("/api/admin/grading-queue", ctx.adminToken);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; total: number };
    expect(body.total).toBe(4);
  });

  it("Admin+Grader multi-role → org-wide queue (Admin short-circuit wins)", async () => {
    const res = await tGet("/api/admin/grading-queue", adminGraderToken);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number };
    expect(body.total).toBe(4);
  });

  it("Teacher+Grader multi-role: the Teacher course assignment grants NO grading scope (empty queue)", async () => {
    const res = await tGet("/api/admin/grading-queue", teacherGraderToken);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; total: number };
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  // ── Grading detail / write (attempt→exam chain; 404 anti-enumeration) ──

  it("GET grading-details — in-scope Exam A attempt readable", async () => {
    const res = await tGet(
      `/api/admin/attempts/${attemptIds[0]}/grading-details`,
    );
    expect(res.statusCode).toBe(200);
  });

  it("GET grading-details — out-of-scope Exam B attempt folds into 404 (anti-enumeration)", async () => {
    const res = await tGet(
      `/api/admin/attempts/${attemptIds[2]}/grading-details`,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("POST grade-question — in-scope Exam A attempt accepted", async () => {
    const details = await tGet(
      `/api/admin/attempts/${attemptIds[0]}/grading-details`,
    );
    const questionId = (
      details.json() as { questions: Array<{ questionId: string }> }
    ).questions[0]!.questionId;
    const res = await tPost(
      `/api/admin/attempts/${attemptIds[0]}/grade-question`,
      { questionId, score: 80, comment: "G矩阵评分" },
    );
    expect(res.statusCode, res.body).toBe(200);
  });

  it("POST grade-question — out-of-scope Exam B attempt folds into 404 (anti-enumeration)", async () => {
    const res = await tPost(
      `/api/admin/attempts/${attemptIds[2]}/grade-question`,
      { questionId: examBQuestionId, score: 50 },
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("Admin parity: grading detail + write on the out-of-scope-for-Grader attempt succeed", async () => {
    const details = await tGet(
      `/api/admin/attempts/${attemptIds[2]}/grading-details`,
      ctx.adminToken,
    );
    expect(details.statusCode).toBe(200);
    const questionId = (
      details.json() as { questions: Array<{ questionId: string }> }
    ).questions[0]!.questionId;
    const res = await tPost(
      `/api/admin/attempts/${attemptIds[2]}/grade-question`,
      { questionId, score: 90 },
      ctx.adminToken,
    );
    expect(res.statusCode, res.body).toBe(200);
  });

  it("Teacher (course A assigned, grading preset absent) → grading queue 403 unchanged", async () => {
    // Teacher preset does NOT include GradingQueueView — the capability
    // denial (403) must be untouched by #296's scoping work.
    const teacher = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "gmatrix-teacher-pure",
    );
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/grading-queue",
      cookies: { "auth-token": teacher.token },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Grader exam assignment grants NO course/question authority (GET /courses/:courseA → 403)", async () => {
    const res = await tGet(`/api/courses/${courseAId}`);
    expect(res.statusCode).toBe(403);
  });

  it("Grader exam assignment grants NO score route authority (GET /scores/attempts/:id → 403)", async () => {
    const res = await tGet(`/api/scores/attempts/${attemptIds[0]}`);
    expect(res.statusCode).toBe(403);
  });

  // ── Revocation (effective NEXT request) ──

  it("revoking the Exam A assignment empties the queue and 404s the detail on the NEXT request", async () => {
    await revokeExam(graderUserId, examAId);

    const queue = await tGet("/api/admin/grading-queue");
    expect(queue.statusCode).toBe(200);
    const queueBody = queue.json() as { items: unknown[]; total: number };
    expect(queueBody.items).toHaveLength(0);
    expect(queueBody.total).toBe(0);

    const details = await tGet(
      `/api/admin/attempts/${attemptIds[1]}/grading-details`,
    );
    expect(details.statusCode).toBe(404);
    expect(details.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("revoking a non-active assignment folds into 404 (deterministic contract)", async () => {
    const res = await tPost(
      `/api/admin/users/${graderUserId}/exam-assignments/${examAId}/revoke`,
      {},
      ctx.adminToken,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  // ── Assignment API contracts ──

  it("assign to a non-Grader user → 400 VALIDATION_ERROR TARGET_NOT_GRADER", async () => {
    const teacher = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "gmatrix-notgrader",
    );
    const res = await tPost(
      `/api/admin/users/${teacher.user.id}/exam-assignments`,
      { examId: examBId },
      ctx.adminToken,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("assign an unknown exam → 404", async () => {
    const res = await tPost(
      `/api/admin/users/${graderUserId}/exam-assignments`,
      { examId: randomUUID() },
      ctx.adminToken,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("duplicate assign is idempotent (outcome=no_change), then grading works on the newly granted exam", async () => {
    // G currently holds nothing (Exam A revoked above). Grant Exam B: the
    // pending B queue is exactly B#2 (B#1 was graded by the Admin-parity
    // test), proving the granted scope counts ONLY pending work.
    const first = await grantExam(graderUserId, examBId);
    expect(first.outcome).toBe("applied");
    const second = await grantExam(graderUserId, examBId);
    expect(second.outcome).toBe("no_change");

    const queue = await tGet("/api/admin/grading-queue");
    const queueBody = queue.json() as { total: number };
    expect(queueBody.total).toBe(1);
    const details = await tGet(
      `/api/admin/attempts/${attemptIds[3]}/grading-details`,
    );
    expect(details.statusCode).toBe(200);

    await revokeExam(graderUserId, examBId);
  });

  it("Teacher+Grader: assigning Exam B to the hybrid widens ONLY grading to B — course authority unchanged", async () => {
    await grantExam(teacherGraderUserId, examBId);
    try {
      // Grading scope = {B}: the queue shows ONLY the pending B attempt,
      // never Exam A rows (the teacher course assignment grants no grading).
      const queue = await tGet("/api/admin/grading-queue", teacherGraderToken);
      const body = queue.json() as {
        items: Array<{ examId: string }>;
        total: number;
      };
      expect(body.total).toBe(1);
      expect(body.items[0]!.examId).toBe(examBId);

      // Teacher authority still exactly {Course A}: B course folds into 404.
      const courseB = await tGet(
        `/api/courses/${courseBId}`,
        teacherGraderToken,
      );
      expect(courseB.statusCode).toBe(404);
    } finally {
      await revokeExam(teacherGraderUserId, examBId);
    }
  });

  it("assignment audit records are written for assign and revoke", async () => {
    const user = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Grader",
      "gmatrix-audit",
    );
    await grantExam(user.user.id, examAId);
    await revokeExam(user.user.id, examAId);

    const assigns = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.organizationId, ctx.org.id),
          eq(schema.auditLogs.action, "exam.grader_assigned"),
        ),
      );
    const revokes = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.organizationId, ctx.org.id),
          eq(schema.auditLogs.action, "exam.grader_revoked"),
        ),
      );
    expect(
      assigns.some((r) => r.targetId === examAId),
      "assign audit present",
    ).toBe(true);
    expect(
      revokes.some((r) => r.targetId === examAId),
      "revoke audit present",
    ).toBe(true);
  });
});
