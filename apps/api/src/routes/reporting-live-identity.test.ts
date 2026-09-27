import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  buildTestApp,
  uniquePrefix,
  createCandidateViaApi,
  createExamViaApi,
  publishExamViaApi,
  submitExamAsCandidate,
  exportResultsCsvAsAdmin,
} from "./testHelpers.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import scoreRoutes from "./scores.js";
import { exportRoutes } from "./export.js";
import candidateRoutes from "./candidate.js";
import candidateFieldRoutes from "./candidateField.js";
import { schema } from "@exam/db/src/schema/pg.js";

/**
 * Live-identity conformance (EXSEM-015 / ADR-021 D4,
 * REPORTING_IDENTITY_POLICY = LIVE_PROFILE_AND_LIVE_FIELD_DEFINITIONS_AT_READ
 * _OR_EXPORT_TIME): historical attempt ownership stays the same candidateId
 * while ordinary result/reporting surfaces compose the candidate's CURRENT
 * profile (and CURRENT field definitions) at read time. No identity snapshot
 * exists to assert against — the test pins that reporting follows live data.
 */
describe("reporting reflects live candidate identity (EXSEM-015)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let candidateProfileId: string;
  let fieldId: string;
  let fieldName: string;
  const username = `liveid-${uniquePrefix()}`;
  const renamed = "重命名后的考生";

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(scoreRoutes);
      await fastify.register(exportRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(candidateFieldRoutes);
    });

    // The single unique identity field (candidate create requires exactly
    // one when any field is configured) so the live-fields legs have data.
    const fieldRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidate-fields",
      payload: {
        name: `department-${uniquePrefix()}`,
        label: "原始部门标签",
        fieldType: "text",
        required: true,
        unique: true,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(fieldRes.statusCode).toBe(201);
    fieldId = fieldRes.json().id as string;
    fieldName = fieldRes.json().name as string;

    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Live Identity Exam",
      courseCode: "LIVEID",
      courseName: "Live Identity Course",
      questionContent: "1+1=2?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examId);

    // Full cycle: candidate → enroll → start → answer → submit → graded.
    const submitted = await submitExamAsCandidate(
      ctx.app,
      ctx.adminToken,
      ctx.org.id,
      examId,
      username,
    );
    expect(submitted.status).toBe("graded");
    candidateProfileId = submitted.candidateId as string;

    // The score-list/export surfaces serve finished exams only — close the
    // window via the exam close command so the reporting legs can read.
    const closeRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/close`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(closeRes.statusCode).toBe(200);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("score list and CSV export compose the candidate's renamed profile at read time", async () => {
    const originalName = `Candidate ${username}`;
    const before = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/scores`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().items[0].candidateName).toBe(originalName);

    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/candidates/${candidateProfileId}`,
      payload: {
        name: renamed,
        fields: { [fieldName]: "改后部门值" },
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(patchRes.statusCode).toBe(200);

    const after = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/scores`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(after.statusCode).toBe(200);
    const item = after.json().items[0];
    // Live name and live field value at read time …
    expect(item.candidateName).toBe(renamed);
    expect(item.candidateFields[fieldName]).toBe("改后部门值");
    // … while the historical attempt ownership fact is unchanged.
    expect(item.attemptId).toBe(before.json().items[0].attemptId);

    const csv = await exportResultsCsvAsAdmin(ctx.app, ctx.adminToken, examId);
    expect(csv.body).toContain(renamed);
    expect(csv.body).toContain("改后部门值");
    expect(csv.body).not.toContain(originalName);
  });

  it("exports use the CURRENT field definition label over stored field names", async () => {
    const csvBefore = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      examId,
    );
    expect(csvBefore.body).toContain("原始部门标签");

    const labelRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/candidate-fields/${fieldId}`,
      payload: { label: "改后部门标签" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(labelRes.statusCode).toBe(200);

    const csvAfter = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      examId,
    );
    expect(csvAfter.body).toContain("改后部门标签");
    expect(csvAfter.body).not.toContain("原始部门标签");
  });
});
