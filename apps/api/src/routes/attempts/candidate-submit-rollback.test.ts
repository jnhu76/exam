import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import questionRoutes from "../question.js";
import courseRoutes from "../course.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import {
  buildExamPayload,
  enrollCandidateForExam,
  ensureCandidateProfile,
} from "./__tests__/attempts.testHelpers.js";

/**
 * F11c — deterministic rollback witness for the candidate submit+grade
 * composition (`submitAndGradeAttempt`), EXSEM-008/009 conformance.
 *
 * The submit route's `attempt.submit` audit write happens INSIDE the
 * orchestrator's single transaction: after the freeze mutation + grading
 * workset materialization, before finalizeGrading's enrollment projection.
 * A failing BEFORE INSERT trigger on that audit row is a deterministic
 * mid-transaction fault — no sleeps, no races. The injected exception must
 * roll back ALL of: the attempt mutation, the submittedAnswers freeze, the
 * grading workset, and leave the enrollment projection untouched.
 *
 * The retry leg (trigger removed) proves no residue blocks recovery: the same
 * candidate submit succeeds and all four fact families (attempt, submitted
 * answers, grading entries, enrollment finals) commit mutually consistent.
 */
async function installSubmitAuditFailure(
  db: Awaited<ReturnType<typeof buildTestApp>>["db"],
): Promise<() => Promise<void>> {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const functionName = `fail_attempt_submit_audit_${suffix}`;
  const triggerName = `fail_attempt_submit_audit_trigger_${suffix}`;
  await db.execute(
    sql.raw(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected attempt submit audit failure';
      END;
      $$ LANGUAGE plpgsql
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON audit_logs
      FOR EACH ROW
      WHEN (NEW.action = 'attempt.submit')
      EXECUTE FUNCTION ${functionName}()
    `),
  );
  return async () => {
    await db.execute(
      sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_logs`),
    );
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`));
  };
}

describe("candidate submit rollback consistency (EXSEM-008/009, F11c)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes, { prefix: "" });
      await fastify.register(questionRoutes, { prefix: "" });
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Submit Rollback Course",
        code: `SRC-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;

    const questionRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: "What is 1+1?",
        options: [
          { id: "a", content: "2" },
          { id: "b", content: "3" },
        ],
        standardAnswer: "a",
        attachments: [],
        score: 100,
        difficulty: 1,
        tags: [],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(questionRes.statusCode).toBe(201);
    questionId = questionRes.json().id;

    candidateProfileId = await ensureCandidateProfile(ctx);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /** Creates + publishes + enrolls an exam and starts one attempt. */
  async function createStartedAttempt(
    title: string,
  ): Promise<{ examId: string; attemptId: string }> {
    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title,
        courseId,
        questionIds: [questionId],
        durationMinutes: 60,
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
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

  async function saveAnswer(attemptId: string): Promise<void> {
    const saveRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer: "a",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(saveRes.statusCode).toBe(200);
  }

  async function loadAttemptRow(attemptId: string) {
    const rows = await ctx.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    return rows[0]!;
  }

  async function loadEnrollmentRow(examId: string) {
    const rows = await ctx.db
      .select()
      .from(schema.examEnrollments)
      .where(
        and(
          eq(schema.examEnrollments.examId, examId),
          eq(schema.examEnrollments.candidateId, candidateProfileId),
        ),
      );
    return rows[0]!;
  }

  async function loadGradingEntries(attemptId: string) {
    return ctx.db
      .select()
      .from(schema.attemptGradingEntries)
      .where(eq(schema.attemptGradingEntries.attemptId, attemptId));
  }

  async function countSubmitAudits(attemptId: string): Promise<number> {
    await ctx.drainAuditWrites();
    const rows = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.targetId, attemptId),
          eq(schema.auditLogs.action, "attempt.submit"),
        ),
      );
    return rows.length;
  }

  it("faulted submit rolls back attempt mutation, workset and enrollment projection; retry then commits mutually consistent facts", async () => {
    const { examId, attemptId } = await createStartedAttempt(
      `Rollback Witness ${uniquePrefix()}`,
    );
    await saveAnswer(attemptId);

    const attemptBefore = await loadAttemptRow(attemptId);
    expect(attemptBefore.status).toBe("in_progress");
    // gradingStatus is pre-classified at start from the question types
    // (single_choice → auto_graded); the rollback must restore exactly it.
    expect(attemptBefore.gradingStatus).toBe("auto_graded");

    const removeFailure = await installSubmitAuditFailure(ctx.db);
    let submitStatus = 0;
    try {
      const faulted = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      submitStatus = faulted.statusCode;
      expect(faulted.statusCode).toBe(500);
    } finally {
      await removeFailure();
    }
    expect(submitStatus).toBe(500);

    // ── ROLLED BACK: every mutated fact family is at its pre-submit state. ──
    const attemptAfterFault = await loadAttemptRow(attemptId);
    expect(attemptAfterFault.status).toBe("in_progress");
    expect(attemptAfterFault.submittedAt).toBeNull();
    expect(attemptAfterFault.submittedAnswers).toBeNull();
    expect(attemptAfterFault.gradedAt).toBeNull();
    expect(attemptAfterFault.gradingResult).toBeNull();
    expect(attemptAfterFault.gradingStatus).toBe("auto_graded");

    // The grading workset (materialized by the freeze barrier inside the same
    // tx) left no residue.
    expect(await loadGradingEntries(attemptId)).toHaveLength(0);

    // The enrollment projection was never written: still exactly the
    // post-start facts (attemptCount consumed, no final facts).
    const enrollmentAfterFault = await loadEnrollmentRow(examId);
    expect(enrollmentAfterFault.status).toBe("started");
    expect(enrollmentAfterFault.attemptCount).toBe(1);
    expect(enrollmentAfterFault.finalAttemptId).toBeNull();
    expect(enrollmentAfterFault.finalScore).toBeNull();
    expect(enrollmentAfterFault.finalPassed).toBeNull();

    // No attempt.submit audit survived the rollback.
    expect(await countSubmitAudits(attemptId)).toBe(0);

    // ── RETRY: no residue blocks recovery; the same submit commits all four
    // fact families mutually consistent. ──
    const retry = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(retry.statusCode).toBe(200);

    const attemptFinal = await loadAttemptRow(attemptId);
    expect(attemptFinal.status).toBe("graded");
    expect(attemptFinal.gradingStatus).toBe("auto_graded");
    expect(attemptFinal.submittedAt).not.toBeNull();
    expect(attemptFinal.gradedAt).not.toBeNull();
    expect(attemptFinal.submissionReason).toBe("manual");
    // The frozen submitted answers cover the exam's questions.
    const submitted = attemptFinal.submittedAnswers as {
      answers: { questionId: string; value: unknown }[];
      schemaVersion: number;
    };
    expect(submitted.answers).toEqual([{ questionId, value: "a" }]);

    const entries = await loadGradingEntries(attemptId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("completed_auto");
    expect(entries[0]!.candidateAnswer).toBe("a");
    expect(entries[0]!.earnedScore).toBe(100);

    // The aggregate of the durable entries IS the attempt score (one grading
    // semantic, EXSEM-009).
    const earnedSum = entries.reduce((sum, e) => sum + (e.earnedScore ?? 0), 0);
    expect(attemptFinal.score).toBe(earnedSum);

    // The enrollment projection carries the durable final facts. Status
    // stays "started": with an unlimited retake policy and an open window the
    // enrollment is not complete yet — the finals ride along regardless.
    const enrollmentFinal = await loadEnrollmentRow(examId);
    expect(enrollmentFinal.status).toBe("started");
    expect(enrollmentFinal.finalAttemptId).toBe(attemptId);
    expect(enrollmentFinal.finalScore).toBe(100);
    expect(enrollmentFinal.finalPassed).toBe(true);

    expect(await countSubmitAudits(attemptId)).toBe(1);
  }, 30_000);
});
