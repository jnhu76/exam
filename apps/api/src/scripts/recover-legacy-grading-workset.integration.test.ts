import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { eq, sql } from "drizzle-orm";
import type { AttemptStatus, RequestContext } from "@exam/domain";
import { runBackfill } from "./backfill-submitted-answers.js";
import { recoverLegacyGradingWorkset } from "./recover-legacy-grading-workset.js";
import {
  draftAnswer,
  getAttemptRow,
  getEntryRows,
  gradeManualViaGradingSurface,
  gradeViaCandidateResubmit,
  manualSnapshot,
  objectiveSnapshot,
  restorePostMigrationShape,
  rewindGradingToSubmitted,
  seedLegacyResidue,
  setupRecoveryTestEnvironment,
  teardownRecoveryTestEnvironment,
  type RecoveryTestEnvironment,
} from "./recover-legacy-grading-workset.test-support.js";

describe("recover-legacy-grading-workset — operator protocol integration", () => {
  let env: RecoveryTestEnvironment;
  let db: Database;
  let orgId: string;
  let ctx: RequestContext;

  beforeAll(async () => {
    env = await setupRecoveryTestEnvironment(
      "script-recover-workset",
      "Recovery Org",
      "rw",
    );
    ({ db, orgId, ctx } = env);
  }, 30_000);

  afterAll(async () => {
    await teardownRecoveryTestEnvironment(env);
  }, 30_000);

  it("T1: documented Option A alone does NOT reach the normal grading path — FAIL CLOSED on the missing workset", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });

    await rewindGradingToSubmitted(db, id);
    expect((await getAttemptRow(db, id)).status as AttemptStatus).toBe(
      "submitted",
    );

    const stats = await runBackfill(db);
    expect(stats.backfilled).toBeGreaterThanOrEqual(1);
    expect((await getAttemptRow(db, id)).submittedAnswers).toEqual({
      schemaVersion: 1,
      answers: [{ questionId: "q1", value: "b" }],
    });

    await expect(
      gradeViaCandidateResubmit(
        db,
        ctx,
        id,
        (await getAttemptRow(db, id)).candidateId,
      ),
    ).rejects.toThrow(
      /Grading aggregation inconsistency.*expected 1 entries.*found 0/s,
    );

    const after = await getAttemptRow(db, id);
    expect(after.status).toBe("submitted");
    expect(after.score).toBeNull();
    expect(after.passed).toBeNull();
    expect(after.gradingResult).toBeNull();
    expect(after.gradedAt).toBeNull();

    await restorePostMigrationShape(db);
  });

  it("T2: zero workset is materialized exactly once with canonical fields", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    const result = await recoverLegacyGradingWorkset(db, id);
    expect(result.action).toBe("materialized");
    expect(result.entryCount).toBe(1);
    expect(result.gradingStatusAlignment).toBeNull();

    const entries = await getEntryRows(db, id);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.questionId).toBe("q1");
    expect(e.gradingMode).toBe("auto");
    expect(e.status).toBe("completed_auto");
    expect(e.maxScore).toBe(100);
    expect(e.earnedScore).toBe(100);
    expect(e.candidateAnswer).toBe("b");
    expect(e.standardAnswer).toBe("b");
    expect(e.correct).toBe(true);
    expect(e.comment).toBe("");
    expect(e.gradedBy).toBeNull();
    expect(e.gradedAt).toBeNull();

    await restorePostMigrationShape(db);
  });

  it("T8: recovery fabricates NO terminal attempt or enrollment facts", async () => {
    const id = crypto.randomUUID();
    const { enrollmentId } = await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    await recoverLegacyGradingWorkset(db, id);

    const attempt = await getAttemptRow(db, id);
    expect(attempt.status).toBe("submitted");
    expect(attempt.score).toBeNull();
    expect(attempt.passed).toBeNull();
    expect(attempt.gradingResult).toBeNull();
    expect(attempt.gradedAt).toBeNull();

    const enrollment = (
      await db
        .select()
        .from(schema.examEnrollments)
        .where(eq(schema.examEnrollments.id, enrollmentId))
    )[0]!;
    expect(enrollment.finalScore).toBeNull();
    expect(enrollment.finalPassed).toBeNull();
    expect(enrollment.finalAttemptId).toBeNull();
    expect(enrollment.status).toBe("started");

    await restorePostMigrationShape(db);
  });

  it("T3: objective-only residue reaches canonical terminal closure through the normal grading path", async () => {
    const id = crypto.randomUUID();
    const { enrollmentId } = await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);
    await recoverLegacyGradingWorkset(db, id);

    const { attempt } = await gradeViaCandidateResubmit(
      db,
      ctx,
      id,
      (await getAttemptRow(db, id)).candidateId,
    );

    expect(attempt.status).toBe("graded");
    expect(attempt.score).toBe(100);
    expect(attempt.passed).toBe(true);
    expect(attempt.gradingStatus).toBe("auto_graded");
    expect(attempt.gradedAt).not.toBeNull();
    expect(attempt.gradingResult).toEqual([
      {
        questionId: "q1",
        score: 100,
        maxScore: 100,
        correct: true,
        candidateAnswer: "b",
        standardAnswer: "b",
      },
    ]);

    const enrollment = (
      await db
        .select()
        .from(schema.examEnrollments)
        .where(eq(schema.examEnrollments.id, enrollmentId))
    )[0]!;
    expect(enrollment.finalScore).toBe(100);
    expect(enrollment.finalPassed).toBe(true);
    expect(enrollment.finalAttemptId).toBe(id);

    await restorePostMigrationShape(db);
  });

  it("T4: manual residue recovers to pending_manual and closes only through normal manual grading", async () => {
    const id = crypto.randomUUID();
    const { enrollmentId } = await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: manualSnapshot("m1"),
      answers: draftAnswer("m1", "考生作答"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    const result = await recoverLegacyGradingWorkset(db, id);
    expect(result.action).toBe("materialized");
    expect(result.gradingStatusAlignment).toEqual({
      from: "auto_graded",
      to: "pending_manual",
    });

    const attempt = await getAttemptRow(db, id);
    expect(attempt.status).toBe("submitted");
    expect(attempt.gradingStatus).toBe("pending_manual");
    expect(attempt.score).toBeNull();
    expect(attempt.passed).toBeNull();
    expect(attempt.gradingResult).toBeNull();
    expect(attempt.gradedAt).toBeNull();

    const entries = await getEntryRows(db, id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.gradingMode).toBe("manual");
    expect(entries[0]!.status).toBe("pending_manual");
    expect(entries[0]!.earnedScore).toBeNull();
    expect(entries[0]!.candidateAnswer).toBe("考生作答");
    expect(entries[0]!.standardAnswer).toBe("参考答案");

    const held = await gradeViaCandidateResubmit(
      db,
      ctx,
      id,
      attempt.candidateId,
    );
    expect(held.alreadyGraded).toBe(false);
    expect(held.attempt.status).toBe("submitted");
    expect(held.attempt.score).toBeNull();
    expect(held.attempt.gradingStatus).toBe("pending_manual");

    const graded = await gradeManualViaGradingSurface(db, ctx, id, "m1", 80);
    expect(graded.fullyGraded).toBe(true);

    const closed = await getAttemptRow(db, id);
    expect(closed.status).toBe("graded");
    expect(closed.score).toBe(80);
    expect(closed.passed).toBe(true);
    expect(closed.gradingStatus).toBe("fully_graded");
    expect(closed.gradedAt).not.toBeNull();

    const enrollment = (
      await db
        .select()
        .from(schema.examEnrollments)
        .where(eq(schema.examEnrollments.id, enrollmentId))
    )[0]!;
    expect(enrollment.finalScore).toBe(80);
    expect(enrollment.finalPassed).toBe(true);
    expect(enrollment.finalAttemptId).toBe(id);

    await restorePostMigrationShape(db);
  });

  it("T5: partial workset FAILS CLOSED — no inserts, no gap filling", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: [
        ...objectiveSnapshot("q1", "b"),
        ...objectiveSnapshot("q2", "a").map((q) => ({ ...q, order: 1 })),
      ],
      answers: [...draftAnswer("q1", "b"), ...draftAnswer("q2", "a")],
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    await db.insert(schema.attemptGradingEntries).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      attemptId: id,
      questionId: "q1",
      gradingMode: "auto",
      status: "completed_auto",
      maxScore: 100,
      earnedScore: 100,
      candidateAnswer: "b",
      standardAnswer: "b",
      correct: true,
    });

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /Grading workset inconsistency.*expected 2 entries, found 1.*not repairable/s,
    );
    expect(await getEntryRows(db, id)).toHaveLength(1);

    await restorePostMigrationShape(db);
  });

  it("T6: mismatched full workset FAILS CLOSED — no overwrite", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    await db.insert(schema.attemptGradingEntries).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      attemptId: id,
      questionId: "q1",
      gradingMode: "auto",
      status: "completed_auto",
      maxScore: 100,
      earnedScore: 0,
      candidateAnswer: "b",
      standardAnswer: "b",
      correct: false,
    });

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /Grading workset inconsistency.*earnedScore 0 != expected 100/s,
    );
    const entries = await getEntryRows(db, id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.earnedScore).toBe(0);

    await restorePostMigrationShape(db);
  });

  it("T7: idempotency — a second run on a restored workset validates without writing", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    const first = await recoverLegacyGradingWorkset(db, id);
    expect(first.action).toBe("materialized");

    const second = await recoverLegacyGradingWorkset(db, id);
    expect(second.action).toBe("validated_no_op");
    expect(second.entryCount).toBe(1);
    expect(second.gradingStatusAlignment).toBeNull();
    expect(await getEntryRows(db, id)).toHaveLength(1);

    await restorePostMigrationShape(db);
  });

  it("T9: unresolved legacy grading is refused — the rewind disposition must come first", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /status='grading'.*only accepts the post-disposition shape\s*status='submitted'/s,
    );
    const row = await getAttemptRow(db, id);
    expect(row.status as string).toBe("grading");
    expect(await getEntryRows(db, id)).toHaveLength(0);

    await restorePostMigrationShape(db);
  });

  it("T10: the full documented operator sequence reaches canonical grading (canonical #542 recovery proof)", async () => {
    const id = crypto.randomUUID();
    const { enrollmentId } = await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });

    await expect(runBackfill(db)).rejects.toThrow(
      /legacy status='grading'.*0043_persisted_state_status_checks/s,
    );

    await rewindGradingToSubmitted(db, id);
    await restorePostMigrationShape(db);

    const stats = await runBackfill(db);
    expect(stats.backfilled).toBeGreaterThanOrEqual(1);

    const recovered = await recoverLegacyGradingWorkset(db, id);
    expect(recovered.action).toBe("materialized");

    const { attempt } = await gradeViaCandidateResubmit(
      db,
      ctx,
      id,
      (await getAttemptRow(db, id)).candidateId,
    );
    expect(attempt.status).toBe("graded");
    expect(attempt.score).toBe(100);
    expect(attempt.passed).toBe(true);
    expect(attempt.gradedAt).not.toBeNull();

    const enrollment = (
      await db
        .select()
        .from(schema.examEnrollments)
        .where(eq(schema.examEnrollments.id, enrollmentId))
    )[0]!;
    expect(enrollment.finalScore).toBe(100);
    expect(enrollment.finalPassed).toBe(true);
    expect(enrollment.finalAttemptId).toBe(id);
  });

  it("dry-run reports the materialization plan without writing", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    const result = await recoverLegacyGradingWorkset(db, id, { dryRun: true });
    expect(result.action).toBe("would_materialize");
    expect(result.entryCount).toBe(1);
    expect(await getEntryRows(db, id)).toHaveLength(0);
    const row = await getAttemptRow(db, id);
    expect(row.gradingStatus).toBe("auto_graded");
    expect(row.score).toBeNull();

    await restorePostMigrationShape(db);
  });

  it("dry-run reports an exact-complete workset as would_validate without writing", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);
    await recoverLegacyGradingWorkset(db, id);

    const result = await recoverLegacyGradingWorkset(db, id, { dryRun: true });
    expect(result.action).toBe("would_validate");
    expect(await getEntryRows(db, id)).toHaveLength(1);

    await restorePostMigrationShape(db);
  });

  it("refuses an attempt whose submitted_answers is still NULL (backfill must run first)", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /no frozen submitted_answers.*backfill:submitted-answers/s,
    );
    expect(await getEntryRows(db, id)).toHaveLength(0);

    await restorePostMigrationShape(db);
  });

  it("refuses a submitted row that already carries a terminal fact (contradictory data, not residue)", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);
    await db.execute(
      sql.raw(`UPDATE exam_attempts SET total_score = 100 WHERE id = '${id}'`),
    );

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /already carries terminal fact\(s\): score.*investigate its origin first/s,
    );
    expect(await getEntryRows(db, id)).toHaveLength(0);

    await restorePostMigrationShape(db);
  });

  it("refuses grading_status='fully_graded' on a non-graded attempt", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);
    await db.execute(
      sql.raw(
        `UPDATE exam_attempts SET grading_status = 'fully_graded' WHERE id = '${id}'`,
      ),
    );

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /grading_status='fully_graded'.*contradictory terminal grading lifecycle/s,
    );
    expect(await getEntryRows(db, id)).toHaveLength(0);

    await restorePostMigrationShape(db);
  });

  it("refuses an absent or empty questionSnapshot (canonical derivation has no question universe)", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: [],
      answers: [],
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /absent or empty questionSnapshot.*frozen question universe/s,
    );
    expect(await getEntryRows(db, id)).toHaveLength(0);

    await restorePostMigrationShape(db);
  });
});
