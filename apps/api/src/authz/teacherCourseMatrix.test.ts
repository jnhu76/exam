import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import courseRoutes from "../routes/course.js";
import questionRoutes from "../routes/question.js";
import examRoutes from "../routes/exam.js";
import candidateRoutes from "../routes/candidate.js";
import scoreRoutes from "../routes/scores.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  createCandidateViaApi,
  uniquePrefix,
  type TestContext,
} from "../routes/testHelpers.js";

/**
 * Issue #286 — Teacher@Course adversarial scope matrix (Course A / Course B;
 * Exam A / Exam B).
 *
 * One Teacher (T) holds an ACTIVE assignment to Course A ONLY. The matrix
 * proves, endpoint by endpoint, that:
 *   - every in-scope read/write succeeds (no over-narrowing);
 *   - every out-of-scope probe folds into the canonical 404 (anti-enumeration
 *     — never a 403 that leaks existence);
 *   - LIST totals reflect the scope BEFORE pagination;
 *   - a course MOVE cannot cross into unassigned territory;
 *   - a bare Teacher role WITHOUT an assignment sees nothing (role ≠
 *     resource assignment; the scope row alone grants nothing);
 *   - multi-role combinations stay correct (Admin+Teacher → org-wide via the
 *     Admin short-circuit; Teacher+Grader → grader role grants NO course
 *     authority);
 *   - revocation is effective on the NEXT request.
 */
describe("Teacher@Course scope matrix (issue #286)", () => {
  let ctx: TestContext;
  let courseAId: string;
  let courseBId: string;
  let questionAId: string;
  let questionBId: string;
  let examAId: string;
  let examBId: string;
  let candidateAProfileId: string;
  let candidateBProfileId: string;
  let teacherToken = "";
  let teacherUserId = "";
  let unassignedTeacherToken = "";
  let adminTeacherToken = "";
  let teacherGraderToken = "";

  const tGet = (url: string, token = teacherToken) =>
    ctx.app.inject({ method: "GET", url, cookies: { "auth-token": token } });
  const tPost = (url: string, payload: unknown, token = teacherToken) =>
    ctx.app.inject({
      method: "POST",
      url,
      cookies: { "auth-token": token },
      payload,
    });
  const tPatch = (url: string, payload: unknown, token = teacherToken) =>
    ctx.app.inject({
      method: "PATCH",
      url,
      cookies: { "auth-token": token },
      payload,
    });
  const tDelete = (url: string, token = teacherToken) =>
    ctx.app.inject({ method: "DELETE", url, cookies: { "auth-token": token } });

  const grantCourse = async (teacherId: string, courseId: string) => {
    const now = new Date();
    await ctx.db.insert(schema.teacherCourseAssignments).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      teacherUserId: teacherId,
      courseId,
      status: "active",
      assignedBy: ctx.admin.id,
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  };

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(scoreRoutes);
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
    courseAId = await createCourse("Matrix Course A", `MA-${uniquePrefix()}`);
    courseBId = await createCourse("Matrix Course B", `MB-${uniquePrefix()}`);

    const createQuestion = async (courseId: string, content: string) => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/questions",
        payload: {
          courseId,
          type: "true_false",
          content,
          standardAnswer: true,
          // Match the exam totalScore (100) so Exam A passes the publish
          // totalScore==sum(questions) invariant.
          score: 100,
          tags: [courseId === courseAId ? "matrix-tag-a" : "matrix-tag-b"],
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    };
    questionAId = await createQuestion(courseAId, "Matrix question A");
    questionBId = await createQuestion(courseBId, "Matrix question B");

    const createExamWithQuestions = (
      courseId: string,
      title: string,
      ...questionIds: string[]
    ) => {
      const now = new Date();
      return (async () => {
        const r = await ctx.app.inject({
          method: "POST",
          url: "/api/exams",
          payload: {
            title,
            courseId,
            durationMinutes: 60,
            openAt: now.toISOString(),
            closeAt: new Date(now.getTime() + 86_400_000).toISOString(),
            passingScore: 60,
            totalScore: 100,
            questionIds,
          },
          cookies: { "auth-token": ctx.adminToken },
        });
        expect(r.statusCode).toBe(201);
        return (r.json() as { id: string }).id;
      })();
    };
    examAId = await createExamWithQuestions(
      courseAId,
      "Matrix Exam A",
      questionAId,
    );
    examBId = await createExamWithQuestions(courseBId, "Matrix Exam B");

    // Candidates: cA enrolled in Exam A, cB enrolled ONLY in Exam B.
    const candidateA = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `matrix-cand-a-${uniquePrefix()}`,
      ctx.org.id,
    );
    candidateAProfileId = candidateA.candidateProfileId;
    const candidateB = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `matrix-cand-b-${uniquePrefix()}`,
      ctx.org.id,
    );
    candidateBProfileId = candidateB.candidateProfileId;
    const enroll = async (examId: string, candidateId: string) => {
      const res = await tPost(
        `/api/exams/${examId}/enrollments`,
        { candidateIds: [candidateId] },
        ctx.adminToken,
      );
      expect(res.statusCode).toBe(200);
    };
    await enroll(examAId, candidateAProfileId);
    await enroll(examBId, candidateBProfileId);

    // Teacher T: active assignment to Course A ONLY.
    const teacher = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "matrix-teacher",
    );
    teacherToken = teacher.token;
    teacherUserId = teacher.user.id;
    await grantCourse(teacherUserId, courseAId);

    // Bare Teacher role, ZERO course assignments (role ≠ resource
    // assignment): capabilities exist, but with no assignment every scoped
    // probe must fail closed.
    unassignedTeacherToken = (
      await createAssignedUserForTest(
        ctx.db,
        ctx.org.id,
        "Teacher",
        "matrix-teacher-noassign",
      )
    ).token;

    // Admin+Teacher: secondary Teacher assignment on the primary Admin.
    const adminTeacher = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Admin",
      "matrix-admin-teacher",
    );
    const now2 = new Date();
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      userId: adminTeacher.user.id,
      role: "Teacher",
      isPrimary: false,
      isActive: true,
      createdAt: now2,
      updatedAt: now2,
    });
    adminTeacherToken = adminTeacher.token;

    // Teacher+Grader: grader adds NO course authority.
    const teacherGrader = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "matrix-teacher-grader",
    );
    teacherGraderToken = teacherGrader.token;
    await grantCourse(teacherGrader.user.id, courseAId);
    const now3 = new Date();
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      userId: teacherGrader.user.id,
      role: "Grader",
      isPrimary: false,
      isActive: true,
      createdAt: now3,
      updatedAt: now3,
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── Courses ──

  it("LIST /courses — Teacher sees Course A, never Course B", async () => {
    const res = await tGet("/api/courses");
    expect(res.statusCode).toBe(200);
    const ids = (res.json().items as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(courseAId);
    expect(ids).not.toContain(courseBId);
  });

  it("GET /courses/:id — Course B folds into 404 (anti-enumeration)", async () => {
    const res = await tGet(`/api/courses/${courseBId}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  // ── Questions ──

  it("LIST /questions — only Course A questions; explicit Course B filter is empty", async () => {
    const all = await tGet("/api/questions");
    expect(all.statusCode).toBe(200);
    const contents = (all.json().items as Array<{ id: string }>).map(
      (q) => q.id,
    );
    expect(contents).toContain(questionAId);
    expect(contents).not.toContain(questionBId);

    const filtered = await tGet(`/api/questions?courseId=${courseBId}`);
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().items).toHaveLength(0);
    expect(filtered.json().total).toBe(0);
  });

  it("question detail/update/delete on Course B question → 404", async () => {
    expect((await tGet(`/api/questions/${questionBId}`)).statusCode).toBe(404);
    const patched = await tPatch(`/api/questions/${questionBId}`, {
      content: "hijack",
    });
    expect(patched.statusCode).toBe(404);
    expect((await tDelete(`/api/questions/${questionBId}`)).statusCode).toBe(
      404,
    );
  });

  it("create question — Course A 201; Course B 404", async () => {
    const ok = await tPost("/api/questions", {
      courseId: courseAId,
      type: "true_false",
      content: "Matrix in-scope create",
      standardAnswer: false,
      score: 5,
    });
    expect(ok.statusCode).toBe(201);

    const denied = await tPost("/api/questions", {
      courseId: courseBId,
      type: "true_false",
      content: "Matrix out-of-scope create",
      standardAnswer: false,
      score: 5,
    });
    expect(denied.statusCode).toBe(404);
  });

  it("course MOVE — moving question A into Course B → 400 (destination unassigned)", async () => {
    const res = await tPatch(`/api/questions/${questionAId}`, {
      courseId: courseBId,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    // The question was NOT moved.
    const readback = await tGet(`/api/questions/${questionAId}`);
    expect(readback.json().courseId).toBe(courseAId);
  });

  it("import into Course B → 404", async () => {
    const res = await tPost("/api/questions/import", {
      courseId: courseBId,
      confirm: false,
      rows: [
        {
          type: "true_false",
          content: "import probe",
          standardAnswer: "true",
          score: 5,
          difficulty: 1,
        },
      ],
    });
    expect(res.statusCode).toBe(404);
  });

  it("tags vocabulary — Course B tags never leak", async () => {
    const res = await tGet("/api/questions/tags");
    expect(res.statusCode).toBe(200);
    const tags = res.json().tags as string[];
    expect(tags).toContain("matrix-tag-a");
    expect(tags).not.toContain("matrix-tag-b");
  });

  // ── Exams ──

  it("LIST /exams — Exam A visible, Exam B hidden", async () => {
    const res = await tGet("/api/exams");
    expect(res.statusCode).toBe(200);
    const ids = (res.json().items as Array<{ id: string }>).map((e) => e.id);
    expect(ids).toContain(examAId);
    expect(ids).not.toContain(examBId);
  });

  it("exam detail — Exam A 200, Exam B 404", async () => {
    expect((await tGet(`/api/exams/${examAId}`)).statusCode).toBe(200);
    const denied = await tGet(`/api/exams/${examBId}`);
    expect(denied.statusCode).toBe(404);
    expect(denied.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("create exam — Course A 201; Course B 404", async () => {
    const now = new Date();
    const ok = await tPost("/api/exams", {
      title: `Matrix in-scope exam ${uniquePrefix()}`,
      courseId: courseAId,
      durationMinutes: 30,
      openAt: now.toISOString(),
      closeAt: new Date(now.getTime() + 3_600_000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionIds: [],
    });
    expect(ok.statusCode).toBe(201);

    const denied = await tPost("/api/exams", {
      title: `Matrix out-of-scope exam ${uniquePrefix()}`,
      courseId: courseBId,
      durationMinutes: 30,
      openAt: now.toISOString(),
      closeAt: new Date(now.getTime() + 3_600_000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionIds: [],
    });
    expect(denied.statusCode).toBe(404);
  });

  it("lifecycle writes on Exam B → 404 (publish / close / publish-results)", async () => {
    expect((await tPost(`/api/exams/${examBId}/publish`, {})).statusCode).toBe(
      404,
    );
    expect((await tPost(`/api/exams/${examBId}/close`, {})).statusCode).toBe(
      404,
    );
    expect(
      (await tPost(`/api/exams/${examBId}/publish-results`, {})).statusCode,
    ).toBe(404);
  });

  it("Teacher publishes in-scope Exam A (capability holds within scope)", async () => {
    const res = await tPost(`/api/exams/${examAId}/publish`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("published");
  });

  it("enrollment manage on Exam B → 404 (list / add / remove)", async () => {
    expect((await tGet(`/api/exams/${examBId}/enrollments`)).statusCode).toBe(
      404,
    );
    expect(
      (
        await tPost(`/api/exams/${examBId}/enrollments`, {
          candidateIds: [candidateAProfileId],
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await tDelete(`/api/exams/${examBId}/enrollments/${randomUUID()}`))
        .statusCode,
    ).toBe(404);
  });

  it("candidates/status for Exam B → 404; Exam A 200", async () => {
    const denied = await tGet(`/api/admin/exams/${examBId}/candidates/status`);
    expect(denied.statusCode).toBe(404);
    const ok = await tGet(`/api/admin/exams/${examAId}/candidates/status`);
    expect(ok.statusCode).toBe(200);
  });

  it("score list for Exam B → 404", async () => {
    const res = await tGet(`/api/exams/${examBId}/scores`);
    expect(res.statusCode).toBe(404);
  });

  // ── Candidates ──

  it("LIST /candidates — Exam-A-enrolled candidate visible; Exam-B-only candidate hidden", async () => {
    const res = await tGet("/api/candidates");
    expect(res.statusCode).toBe(200);
    const ids = (res.json().items as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(candidateAProfileId);
    expect(ids).not.toContain(candidateBProfileId);
  });

  // ── Multi-role / role-vs-assignment semantics ──

  it("Teacher role WITHOUT any course assignment sees nothing (role ≠ resource assignment)", async () => {
    const list = await tGet("/api/courses", unassignedTeacherToken);
    expect(list.statusCode).toBe(200);
    expect(list.json().items as Array<{ id: string }>).toHaveLength(0);
    const detail = await tGet(
      `/api/courses/${courseAId}`,
      unassignedTeacherToken,
    );
    expect(detail.statusCode).toBe(404);
  });

  it("Admin+Teacher multi-role → org-wide (Admin short-circuit wins)", async () => {
    const list = await tGet("/api/courses", adminTeacherToken);
    expect(list.statusCode).toBe(200);
    const ids = (list.json().items as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(courseAId);
    expect(ids).toContain(courseBId);
    const detailB = await tGet(`/api/courses/${courseBId}`, adminTeacherToken);
    expect(detailB.statusCode).toBe(200);
  });

  it("Teacher+Grader multi-role → the Grader role grants NO course authority (Course B still 404)", async () => {
    const detail = await tGet(`/api/courses/${courseBId}`, teacherGraderToken);
    expect(detail.statusCode).toBe(404);
  });

  // ── Revocation ──

  it("revoking the assignment revokes authority on the NEXT request", async () => {
    const revokedAt = new Date();
    await ctx.db
      .update(schema.teacherCourseAssignments)
      .set({
        status: "revoked",
        revokedBy: ctx.admin.id,
        revokedAt,
        updatedAt: revokedAt,
      })
      .where(
        and(
          eq(schema.teacherCourseAssignments.organizationId, ctx.org.id),
          eq(schema.teacherCourseAssignments.teacherUserId, teacherUserId),
          eq(schema.teacherCourseAssignments.courseId, courseAId),
          eq(schema.teacherCourseAssignments.status, "active"),
        ),
      );

    const detail = await tGet(`/api/courses/${courseAId}`);
    expect(detail.statusCode).toBe(404);
    const examDetail = await tGet(`/api/exams/${examAId}`);
    expect(examDetail.statusCode).toBe(404);
    const list = await tGet("/api/courses");
    expect(list.json().items as Array<{ id: string }>).toHaveLength(0);
  });
});
