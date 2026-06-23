import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  buildTestApp,
  createCandidateViaApi,
  createExamViaApi,
  publishExamViaApi,
  submitExamAsCandidate,
  exportResultsCsvAsAdmin,
  uniquePrefix,
} from "./testHelpers.js";
import { signJWT } from "@exam/auth/src/session.js";
import authRoutes from "./auth.js";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import candidateFieldRoutes from "./candidateField.js";
import attemptRoutes from "./attempts.js";
import { exportRoutes } from "./export.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { eq } from "drizzle-orm";

describe("CSV export integration", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(candidateFieldRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(exportRoutes);
    });

    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Export Test Exam",
      courseCode: "EXP101",
      courseName: "Export Test Course",
      questionContent: "1+1=2?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examId);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("returns 400 VALIDATION_ERROR for a malformed (non-uuid) exam id", async () => {
    // P2.0-J1 contract hardening: path params are validated by the route
    // schema, so a non-uuid id is now a 400 before the handler runs.
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exams/nonexistent/export/scores",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 ErrorResponse with RESOURCE_NOT_FOUND for a valid uuid that does not exist", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${crypto.randomUUID()}/export/scores`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(body.error.message).toEqual(expect.any(String));
    expect(body.error.requestId).toEqual(expect.any(String));
  });

  it("returns CSV with correct headers for empty results", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/export/scores`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const body = typeof res.body === "string" ? res.body : res.body.toString();
    expect(body).toContain("考生姓名");
    expect(body).toContain("成绩");
    expect(body).toContain("及格状态");
  });

  it("returns 401 ErrorResponse v0 with AUTH_REQUIRED and requestId when unauthenticated", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/export/scores`,
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(body.error.message).toEqual(expect.any(String));
    expect(body.error.requestId).toEqual(expect.any(String));
  });

  it("returns 403 ErrorResponse v0 with PERMISSION_DENIED and requestId for candidate role", async () => {
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `export-cand-${uniquePrefix()}`,
      ctx.org.id,
    );
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/export/scores`,
      cookies: { "auth-token": candidate.token },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe("PERMISSION_DENIED");
    expect(body.error.message).toEqual(expect.any(String));
    expect(body.error.requestId).toEqual(expect.any(String));
  });

  it("Content-Disposition header contains attachment and examId", async () => {
    const res = await exportResultsCsvAsAdmin(ctx.app, ctx.adminToken, examId);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain(examId);
  });

  it("CSV with graded data contains score fields", async () => {
    const gradedExamId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Graded Export Exam",
      courseCode: "GRD102",
      courseName: "Graded Export Course",
      questionContent: "Is water wet?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, gradedExamId);
    const gradedUsername = `graded-export-cand-${uniquePrefix()}`;
    await submitExamAsCandidate(
      ctx.app,
      ctx.adminToken,
      ctx.org.id,
      gradedExamId,
      gradedUsername,
    );
    const { body } = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      gradedExamId,
    );
    expect(body).toContain("100");
    expect(body).toContain("及格");
    expect(body).toContain(`Candidate ${gradedUsername}`);
  });

  it("CSV escaping handles commas and quotes in candidate name", async () => {
    const candidateRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `csv-escape-user-${uniquePrefix()}`,
        password: "password123",
        name: 'Zhang, "San"',
        fields: {},
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(candidateRes.statusCode).toBe(201);
    const candidateBody = candidateRes.json();
    const candidateToken = signJWT({
      actorId: candidateBody.userId,
      role: "Candidate",
      organizationId: ctx.org.id,
    });

    const escapeExamId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "CSV Escape Exam",
      courseCode: "ESC102",
      courseName: "Escape Course",
      questionContent: "Is CSV escaping important?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, escapeExamId);

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${escapeExamId}/enrollments`,
      payload: { candidateIds: [candidateBody.id] },
      cookies: { "auth-token": ctx.adminToken },
    });

    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${escapeExamId}/start`,
      cookies: { "auth-token": candidateToken },
    });
    expect(startRes.statusCode).toBe(201);
    const attempt = startRes.json();

    const examDetailRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${escapeExamId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const questionId = examDetailRes.json().questionIds[0];

    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attempt.id}/answers/${questionId}`,
      payload: {
        attemptId: attempt.id,
        questionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": candidateToken },
    });

    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attempt.id}/submit`,
      cookies: { "auth-token": candidateToken },
    });
    expect(submitRes.statusCode).toBe(200);

    const { body } = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      escapeExamId,
    );
    expect(body).toContain('"Zhang, ""San"""');
  });

  it("CSV escaping prefixes dangerous-prefix candidate names to mitigate CSV injection", async () => {
    const candidateRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `csv-injection-${uniquePrefix()}`,
        password: "password123",
        name: "=cmd|' /C calc'!A0",
        fields: {},
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(candidateRes.statusCode).toBe(201);
    const candidateBody = candidateRes.json();
    const candidateToken = signJWT({
      actorId: candidateBody.userId,
      role: "Candidate",
      organizationId: ctx.org.id,
    });

    const injExamId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "CSV Injection Exam",
      courseCode: "INJ102",
      courseName: "Injection Course",
      questionContent: "Is CSV injection mitigated?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, injExamId);

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${injExamId}/enrollments`,
      payload: { candidateIds: [candidateBody.id] },
      cookies: { "auth-token": ctx.adminToken },
    });

    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${injExamId}/start`,
      cookies: { "auth-token": candidateToken },
    });
    expect(startRes.statusCode).toBe(201);
    const attempt = startRes.json();

    const examDetailRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${injExamId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const questionId = examDetailRes.json().questionIds[0];

    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attempt.id}/answers/${questionId}`,
      payload: {
        attemptId: attempt.id,
        questionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": candidateToken },
    });

    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attempt.id}/submit`,
      cookies: { "auth-token": candidateToken },
    });
    expect(submitRes.statusCode).toBe(200);

    const { body } = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      injExamId,
    );
    // Dangerous-prefix value ('=' here) must be escaped with a leading single quote
    // before any quote-wrapping that the CSV format requires. The negative
    // assertions cover both row-start and mid-row cell-start positions, so an
    // unescaped formula anywhere in the CSV would fail this test.
    expect(body).toContain("'=cmd");
    expect(body).not.toMatch(/(^|\n)=cmd/);
    expect(body).not.toMatch(/,=cmd/);
    expect(body).not.toMatch(/,"=cmd/);
  });

  it("export header uses CandidateField.label instead of field.name", async () => {
    const fieldName = `studentId-${uniquePrefix()}`;

    await ctx.db
      .delete(schema.candidateFields)
      .where(eq(schema.candidateFields.organizationId, ctx.org.id));

    await ctx.db.insert(schema.candidateFields).values({
      id: crypto.randomUUID(),
      organizationId: ctx.org.id,
      name: fieldName,
      label: "学号",
      fieldType: "text",
      required: false,
      unique: true,
      sortOrder: 0,
      createdAt: new Date(),
    });

    const candUsername = `label-cand-${uniquePrefix()}`;
    const candRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: candUsername,
        password: "password123",
        name: `Label Test Candidate`,
        fields: { [fieldName]: "STU001" },
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(candRes.statusCode).toBe(201);
    const candidateBody = candRes.json();
    const candidateToken = signJWT({
      actorId: candidateBody.userId,
      role: "Candidate",
      organizationId: ctx.org.id,
    });

    const labelExamId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Label Export Exam",
      courseCode: "LBL101",
      courseName: "Label Export Course",
      questionContent: "Label test?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, labelExamId);

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${labelExamId}/enrollments`,
      payload: { candidateIds: [candidateBody.id] },
      cookies: { "auth-token": ctx.adminToken },
    });

    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${labelExamId}/start`,
      cookies: { "auth-token": candidateToken },
    });
    expect(startRes.statusCode).toBe(201);
    const attempt = startRes.json();

    const examDetailRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${labelExamId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const questionId = examDetailRes.json().questionIds[0];

    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attempt.id}/answers/${questionId}`,
      payload: {
        attemptId: attempt.id,
        questionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": candidateToken },
    });

    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attempt.id}/submit`,
      cookies: { "auth-token": candidateToken },
    });

    const { body } = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      labelExamId,
    );
    expect(body).toContain("学号");
    expect(body).toContain("STU001");
    expect(body).not.toContain("studentId");
  });

  it("export header falls back to field.name when label is absent", async () => {
    const fieldName = `dep-${uniquePrefix()}`;

    await ctx.db
      .delete(schema.candidateFields)
      .where(eq(schema.candidateFields.organizationId, ctx.org.id));

    await ctx.db.insert(schema.candidateFields).values({
      id: crypto.randomUUID(),
      organizationId: ctx.org.id,
      name: fieldName,
      label: "",
      fieldType: "text",
      required: false,
      unique: true,
      sortOrder: 0,
      createdAt: new Date(),
    });

    const candUsername = `fallback-cand-${uniquePrefix()}`;
    const candRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: candUsername,
        password: "password123",
        name: "Fallback Test Candidate",
        fields: { [fieldName]: "DEPT001" },
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(candRes.statusCode).toBe(201);
    const candidateBody = candRes.json();
    const candidateToken = signJWT({
      actorId: candidateBody.userId,
      role: "Candidate",
      organizationId: ctx.org.id,
    });

    const fallbackExamId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Fallback Export Exam",
      courseCode: "FBK101",
      courseName: "Fallback Export Course",
      questionContent: "Fallback test?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, fallbackExamId);

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${fallbackExamId}/enrollments`,
      payload: { candidateIds: [candidateBody.id] },
      cookies: { "auth-token": ctx.adminToken },
    });

    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${fallbackExamId}/start`,
      cookies: { "auth-token": candidateToken },
    });
    expect(startRes.statusCode).toBe(201);
    const attempt = startRes.json();

    const examDetailRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${fallbackExamId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const questionId = examDetailRes.json().questionIds[0];

    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attempt.id}/answers/${questionId}`,
      payload: {
        attemptId: attempt.id,
        questionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": candidateToken },
    });

    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attempt.id}/submit`,
      cookies: { "auth-token": candidateToken },
    });

    const { body } = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      fallbackExamId,
    );
    expect(body).toContain(fieldName);
    expect(body).toContain("DEPT001");
  });

  it("CSV output starts with UTF-8 BOM for Excel compatibility", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/export/scores`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = typeof res.body === "string" ? res.body : res.body.toString();
    expect(body.charCodeAt(0)).toBe(0xfeff);
  });

  it("examId filtering — export only returns data for specified exam", async () => {
    const examAId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Filter Exam A",
      courseCode: "FLTA102",
      courseName: "Filter Course A",
      questionContent: "Is A true?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    const examBId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Filter Exam B",
      courseCode: "FLTB102",
      courseName: "Filter Course B",
      questionContent: "Is B true?",
      questionAnswer: false,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examAId);
    await publishExamViaApi(ctx.app, ctx.adminToken, examBId);

    const filterUsername = `filter-exam-a-cand-${uniquePrefix()}`;
    await submitExamAsCandidate(
      ctx.app,
      ctx.adminToken,
      ctx.org.id,
      examAId,
      filterUsername,
    );

    const exportB = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      examBId,
    );
    const linesB = exportB.body.split("\n");
    expect(linesB.length).toBe(1);

    const exportA = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      examAId,
    );
    const linesA = exportA.body.split("\n");
    expect(linesA.length).toBeGreaterThan(1);
    expect(exportA.body).toContain(`Candidate ${filterUsername}`);
  });

  it("handles large dataset (1000+ records) without error", async () => {
    const largeExamId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Large Dataset Export Exam",
      courseCode: "LGE101",
      courseName: "Large Dataset Course",
      questionContent: "Large test?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, largeExamId);

    const RECORD_COUNT = 1001;
    const now = new Date();
    const passwordHash = "$argon2id$v=19$m=65536,t=3,p=4$test$test";

    const userIds: string[] = [];
    const profileIds: string[] = [];
    const enrollmentIds: string[] = [];

    const userRows = Array.from({ length: RECORD_COUNT }, (_, i) => {
      const userId = randomUUID();
      userIds.push(userId);
      return {
        id: userId,
        organizationId: ctx.org.id,
        username: `lg-cand-${i}-${uniquePrefix()}`,
        passwordHash,
        name: `LargeCandidate${i}`,
        role: "Candidate" as const,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
    });

    await ctx.db.insert(schema.users).values(userRows);

    const profileRows = userIds.map((userId) => {
      const profileId = randomUUID();
      profileIds.push(profileId);
      return {
        id: profileId,
        organizationId: ctx.org.id,
        userId,
        fields: {} as Record<string, unknown>,
        createdAt: now,
        updatedAt: now,
      };
    });

    await ctx.db.insert(schema.candidateProfiles).values(profileRows);

    const enrollmentRows = profileIds.map((candidateId) => {
      const enrollmentId = randomUUID();
      enrollmentIds.push(enrollmentId);
      return {
        id: enrollmentId,
        organizationId: ctx.org.id,
        examId: largeExamId,
        candidateId,
        status: "active" as const,
        attemptCount: 1,
        createdAt: now,
        updatedAt: now,
      };
    });

    await ctx.db.insert(schema.examEnrollments).values(enrollmentRows);

    const examRows = await ctx.db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.id, largeExamId));
    const examRow = examRows[0]!;
    const questionId = examRow.questionIds[0]!;
    const questionSnapshot = examRow.questionSnapshot;

    const attemptRows = enrollmentIds.map((enrollmentId, i) => ({
      id: randomUUID(),
      organizationId: ctx.org.id,
      examId: largeExamId,
      enrollmentId,
      candidateId: profileIds[i]!,
      attemptNo: 1,
      status: "graded" as const,
      questionSnapshot,
      answers: [],
      gradingResult: [
        {
          questionId,
          score: 100,
          maxScore: 100,
          correct: true,
          candidateAnswer: true,
          standardAnswer: true,
        },
      ],
      score: 100,
      passed: true,
      startedAt: now,
      submittedAt: now,
      gradedAt: now,
      createdAt: now,
      updatedAt: now,
    }));

    await ctx.db.insert(schema.examAttempts).values(attemptRows);

    const start = Date.now();
    const { body } = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      largeExamId,
    );
    const elapsed = Date.now() - start;

    const lines = body.split("\n").filter((l: string) => l.length > 0);
    expect(lines.length).toBe(RECORD_COUNT + 1);
    expect(body).toContain("考生姓名");
    expect(body).toContain("LargeCandidate0");
    expect(body).toContain(`LargeCandidate${RECORD_COUNT - 1}`);
    expect(elapsed).toBeLessThan(30000);
  });
});
