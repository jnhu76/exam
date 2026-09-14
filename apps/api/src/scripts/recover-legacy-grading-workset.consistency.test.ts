import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import type { RequestContext } from "@exam/domain";
import { recoverLegacyGradingWorkset } from "./recover-legacy-grading-workset.js";
import {
  draftAnswer,
  getAttemptRow,
  getEntryRows,
  gradeManualViaGradingSurface,
  manualSnapshot,
  objectiveSnapshot,
  restorePostMigrationShape,
  seedReadyResidue,
  setGradingStatus,
  setupRecoveryTestEnvironment,
  teardownRecoveryTestEnvironment,
  type RecoveryTestEnvironment,
} from "./__tests__/recover-legacy-grading-workset.test-support.js";

describe("recover-legacy-grading-workset — non-zero consistency guards", () => {
  let env: RecoveryTestEnvironment;
  let db: Database;
  let orgId: string;
  let ctx: RequestContext;

  beforeAll(async () => {
    env = await setupRecoveryTestEnvironment(
      "script-recover-workset-c5",
      "Recovery Org C5",
      "rw5",
    );
    ({ db, orgId, ctx } = env);
  }, 30_000);

  afterAll(async () => {
    await teardownRecoveryTestEnvironment(env);
  }, 30_000);

  it("T17: complete-looking objective workset with drifted candidateAnswer FAILS CLOSED — no validated_no_op, no writes", async () => {
    const id = await seedReadyResidue(
      db,
      orgId,
      objectiveSnapshot("q1", "b"),
      draftAnswer("q1", "b"),
    );

    await db.insert(schema.attemptGradingEntries).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      attemptId: id,
      questionId: "q1",
      gradingMode: "auto",
      status: "completed_auto",
      maxScore: 100,
      earnedScore: 100,
      candidateAnswer: "drifted",
      standardAnswer: "b",
      correct: true,
    });

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /candidateAnswer.*frozen submitted truth/s,
    );
    const entries = await getEntryRows(db, id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.candidateAnswer).toBe("drifted");
    expect((await getAttemptRow(db, id)).gradingStatus).toBe("auto_graded");

    await restorePostMigrationShape(db);
  });

  it("T18: complete-looking objective workset with drifted standardAnswer FAILS CLOSED", async () => {
    const id = await seedReadyResidue(
      db,
      orgId,
      objectiveSnapshot("q1", "b"),
      draftAnswer("q1", "b"),
    );

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
      standardAnswer: "drifted",
      correct: true,
    });

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /standardAnswer.*frozen questionSnapshot truth/s,
    );
    const entries = await getEntryRows(db, id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.standardAnswer).toBe("drifted");

    await restorePostMigrationShape(db);
  });

  it("T19: complete-looking objective workset with canonical earnedScore but drifted correct FAILS CLOSED", async () => {
    const id = await seedReadyResidue(
      db,
      orgId,
      objectiveSnapshot("q1", "b"),
      draftAnswer("q1", "b"),
    );

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
      correct: false,
    });

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /correct.*!=.*expected/s,
    );
    const entries = await getEntryRows(db, id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.correct).toBe(false);

    await restorePostMigrationShape(db);
  });

  it("T20: manual canonical workset + grading_status='auto_graded' FAILS CLOSED — no validated_no_op, no mutation", async () => {
    const id = await seedReadyResidue(
      db,
      orgId,
      manualSnapshot("m1"),
      draftAnswer("m1", "考生作答"),
    );

    await recoverLegacyGradingWorkset(db, id);
    await setGradingStatus(db, id, "auto_graded");

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /structurally valid but grading_status does not match the canonical frozen classification/s,
    );
    const attempt = await getAttemptRow(db, id);
    expect(attempt.status).toBe("submitted");
    expect(attempt.gradingStatus).toBe("auto_graded");
    const entries = await getEntryRows(db, id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("pending_manual");
    expect(entries[0]!.earnedScore).toBeNull();

    await restorePostMigrationShape(db);
  });

  it("T20b: the real manual grading command refuses that drifted label — a validated_no_op would be a false success", async () => {
    const id = await seedReadyResidue(
      db,
      orgId,
      manualSnapshot("m1"),
      draftAnswer("m1", "考生作答"),
    );
    await recoverLegacyGradingWorkset(db, id);
    await setGradingStatus(db, id, "auto_graded");

    await expect(
      gradeManualViaGradingSurface(db, ctx, id, "m1", 80),
    ).rejects.toThrow(/gradingStatus is auto_graded, expected pending_manual/s);

    await restorePostMigrationShape(db);
  });

  it("T21: objective canonical workset + grading_status='pending_manual' FAILS CLOSED — no mutation", async () => {
    const id = await seedReadyResidue(
      db,
      orgId,
      objectiveSnapshot("q1", "b"),
      draftAnswer("q1", "b"),
    );

    await recoverLegacyGradingWorkset(db, id);
    await setGradingStatus(db, id, "pending_manual");

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /structurally valid but grading_status does not match the canonical frozen classification/s,
    );
    const attempt = await getAttemptRow(db, id);
    expect(attempt.status).toBe("submitted");
    expect(attempt.gradingStatus).toBe("pending_manual");
    const entries = await getEntryRows(db, id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("completed_auto");

    await restorePostMigrationShape(db);
  });

  it("dry-run also refuses the mismatched-label non-zero workset without writing", async () => {
    const id = await seedReadyResidue(
      db,
      orgId,
      manualSnapshot("m1"),
      draftAnswer("m1", "考生作答"),
    );
    await recoverLegacyGradingWorkset(db, id);
    await setGradingStatus(db, id, "auto_graded");

    await expect(
      recoverLegacyGradingWorkset(db, id, { dryRun: true }),
    ).rejects.toThrow(
      /structurally valid but grading_status does not match the canonical frozen classification/s,
    );
    const attempt = await getAttemptRow(db, id);
    expect(attempt.gradingStatus).toBe("auto_graded");
    expect(await getEntryRows(db, id)).toHaveLength(1);

    await restorePostMigrationShape(db);
  });

  it("non-zero exact manual workset with the matching canonical label still validates as a no-op", async () => {
    const id = await seedReadyResidue(
      db,
      orgId,
      manualSnapshot("m1"),
      draftAnswer("m1", "考生作答"),
    );

    await recoverLegacyGradingWorkset(db, id);
    const second = await recoverLegacyGradingWorkset(db, id);
    expect(second.action).toBe("validated_no_op");
    expect(second.gradingStatusAlignment).toBeNull();
    expect(await getEntryRows(db, id)).toHaveLength(1);

    await restorePostMigrationShape(db);
  });
});
