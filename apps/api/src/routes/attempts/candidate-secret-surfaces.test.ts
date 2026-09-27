import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";
import {
  buildExamPayload,
  buildSharedAttemptFixture,
  disruptAttempt,
  enrollCandidateForExam,
} from "./__tests__/attempts.testHelpers.js";

/**
 * EXSEM-017 / ADR-021 D3a conformance: administrative secrets must never
 * reach candidate-facing responses through the real serialization paths.
 *
 * The attempt row is populated with a realistic non-null misconduct
 * projection (distinctive marker in the admin notes), and every candidate
 * attempt surface that can observe the attempt — load, submit, restore, and
 * the take snapshot — is asserted on the SERIALIZED response body (raw JSON
 * included), not on pre-serialization objects. The question snapshot's raw
 * gradingRule (D3b) is pinned on the same surfaces. Each test uses its own
 * exam so attempt state cannot leak between cases (`start` is idempotent per
 * candidate+exam and would otherwise return the shared attempt).
 */

const MISCONDUCT_NOTES_MARKER = "SECRET-misconduct-notes-9f3a";

describe("candidate attempt surfaces exclude administrative secrets (EXSEM-017)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;
  let candidateProfileId: string;
  let examCounter = 0;

  beforeAll(async () => {
    const fixture = await buildSharedAttemptFixture();
    ctx = fixture.ctx;
    courseId = fixture.courseId;
    questionId = fixture.questionId;
    candidateProfileId = fixture.candidateProfileId;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /** Creates a fresh published+enrolled exam and starts its attempt (201). */
  async function startFreshAttempt(): Promise<{
    examId: string;
    attemptId: string;
  }> {
    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title: `SecretSurface-${uniquePrefix()}-${++examCounter}`,
        courseId,
        questionIds: [questionId],
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(examRes.statusCode).toBe(201);
    const examId = examRes.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    await enrollCandidateForExam(ctx, candidateProfileId, examId);

    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(startRes.statusCode).toBe(201);
    return { examId, attemptId: startRes.json().id as string };
  }

  /** Populates a realistic non-null misconduct projection on the attempt row. */
  async function setMisconduct(attemptId: string): Promise<void> {
    await ctx.db
      .update(schema.examAttempts)
      .set({
        misconduct: {
          flaggedAt: new Date(),
          flaggedBy: "admin",
          notes: MISCONDUCT_NOTES_MARKER,
          severity: "serious",
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.examAttempts.id, attemptId));
  }

  /** Asserts the serialized candidate surface carries no administrative secrets. */
  function expectSecretFreeSurface(rawBody: string): void {
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const envelope = (body.attempt ?? body) as Record<string, unknown>;
    expect(envelope).not.toHaveProperty("misconduct");
    const questions = (envelope.questionSnapshot ?? []) as Record<
      string,
      unknown
    >[];
    for (const q of questions) {
      expect(q).not.toHaveProperty("gradingRule");
      expect(q).not.toHaveProperty("standardAnswer");
      expect(q).not.toHaveProperty("rubric");
    }
    // Raw-wire guards: the marker string and secret key names never appear,
    // even nested (e.g. inside a restore envelope).
    expect(rawBody).not.toContain(MISCONDUCT_NOTES_MARKER);
    expect(rawBody).not.toContain('"flaggedBy"');
    expect(rawBody).not.toContain('"gradingRule"');
  }

  it("GET /attempts/:id hides misconduct and gradingRule from the candidate", async () => {
    const { attemptId } = await startFreshAttempt();
    await setMisconduct(attemptId);

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(200);
    expectSecretFreeSurface(res.body);
  });

  it("POST /attempts/:attemptId/submit hides misconduct and gradingRule", async () => {
    const { attemptId } = await startFreshAttempt();
    await setMisconduct(attemptId);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(200);
    expectSecretFreeSurface(res.body);
  });

  it("POST /attempts/:attemptId/restore hides misconduct and gradingRule in the nested attempt", async () => {
    const { attemptId } = await startFreshAttempt();
    await disruptAttempt(ctx.db, ctx.org.id, attemptId);
    await setMisconduct(attemptId);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/restore`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(200);
    expectSecretFreeSurface(res.body);
  });

  it("GET /candidate/attempts/:attemptId/take hides the misconduct projection and gradingRule", async () => {
    const { attemptId } = await startFreshAttempt();
    await setMisconduct(attemptId);

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${attemptId}/take`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(MISCONDUCT_NOTES_MARKER);
    expect(res.body).not.toContain('"gradingRule"');
    expect(res.body).not.toContain('"flaggedBy"');
  });

  it("authorized admin surfaces still expose the misconduct projection", async () => {
    const { examId, attemptId } = await startFreshAttempt();
    await setMisconduct(attemptId);

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/exams/${examId}/candidates/status`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(MISCONDUCT_NOTES_MARKER);
  });
});
