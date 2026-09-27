import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "@exam/db/src/types.js";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import { seedDemo } from "@exam/db/src/demo-seed.js";
import { verifyDemoSeed } from "@exam/db/src/demo-seed-verify.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { aggregateGradingEntries } from "@exam/exam-engine";
import { createDemoSeedGrader } from "./demo-seed-grader.js";

// Pre-computed argon2id hashes (same rationale as packages/db demo-seed tests).
const ADMIN_PW_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$C12Yp33+uAT+Ew3Fkbl5Bw$HkRUB4mhpHXaa7gWLtiDlJjFacO8R6YUDTpLrMwCZLs";
const CAND_PW_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$3dCWwSdVOt1y1PCOkxbQVQ$PlSw+GRS5dzJOaVzXjzqF4HoI0/msheYXyIYQRyOmzw";

const precomputedHash = async (password: string): Promise<string> =>
  password === "admin123" ? ADMIN_PW_HASH : CAND_PW_HASH;

/**
 * EXSEM-008/009/010/020 conformance for the demo seed (closure finding F7):
 * demo "valid data" graded attempts must satisfy the SAME fact relationships
 * as production-submitted attempts — frozen SubmittedAnswers + durable
 * attempt_grading_entries + gradingStatus + terminal projection + enrollment
 * projection — built by the production submit+grade composition, not by a
 * second demo grading semantic.
 */
describe("demo seed grading semantics (EXSEM-020)", { timeout: 60_000 }, () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let ids: Awaited<ReturnType<typeof seedDemo>>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("api-demo-seed-grading");
    db = result.db;
    cleanup = result.cleanup;
    ids = await seedDemo(db, precomputedHash, createDemoSeedGrader(db));
  }, 60_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  const GRADED_KEYS = [
    "open-c4-graded",
    "closed-c1-attempt1",
    "closed-c1-attempt2",
    "closed-c2-graded",
    "closed-c3-graded",
    "closed-c4-graded",
  ] as const;

  it("verifyDemoSeed accepts the seeded state", async () => {
    const errors = await verifyDemoSeed(db, ids);
    expect(errors).toEqual([]);
  });

  it("graded attempts carry the durable grading truth", async () => {
    const attemptIds = GRADED_KEYS.map((k) => ids.attempts[k]!);
    const attempts = await db
      .select()
      .from(schema.examAttempts)
      .where(inArray(schema.examAttempts.id, attemptIds));

    expect(attempts).toHaveLength(6);
    for (const attempt of attempts) {
      expect(attempt.status).toBe("graded");
      expect(attempt.submittedAnswers).not.toBeNull();
      expect(attempt.submissionReason).toBe("manual");
      expect(attempt.gradingStatus).toBe("auto_graded");
      expect(attempt.score).not.toBeNull();
      expect(attempt.gradingResult).not.toBeNull();

      const entries = await db
        .select()
        .from(schema.attemptGradingEntries)
        .where(eq(schema.attemptGradingEntries.attemptId, attempt.id));
      const snapshotIds = (
        attempt.questionSnapshot as Array<{ originalQuestionId: string }>
      ).map((q) => q.originalQuestionId);
      expect(entries).toHaveLength(snapshotIds.length);
      expect(new Set(entries.map((e) => e.questionId))).toEqual(
        new Set(snapshotIds),
      );
      for (const entry of entries) {
        expect(entry.status).toBe("completed_auto");
        expect(entry.gradingMode).toBe("auto");
      }
    }
  });

  it("entry candidate answers equal the frozen submitted answers, and aggregation matches the projection", async () => {
    for (const key of GRADED_KEYS) {
      const attemptId = ids.attempts[key]!;
      const rows = await db
        .select()
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.id, attemptId));
      const attempt = rows[0]!;
      const entries = await db
        .select()
        .from(schema.attemptGradingEntries)
        .where(eq(schema.attemptGradingEntries.attemptId, attemptId));
      const submitted = (
        attempt.submittedAnswers as {
          answers: Array<{ questionId: string; value: unknown }>;
        }
      ).answers;

      for (const entry of entries) {
        const frozen = submitted.find((a) => a.questionId === entry.questionId);
        expect(frozen).toBeDefined();
        expect(JSON.stringify(entry.candidateAnswer)).toBe(
          JSON.stringify(frozen!.value),
        );
      }

      // The production aggregation authority accepts the row and reproduces
      // the stored terminal projection from the entries alone.
      const examRows = await db
        .select()
        .from(schema.exams)
        .where(eq(schema.exams.id, attempt.examId));
      const aggregated = aggregateGradingEntries(
        attempt as never,
        entries as never,
        examRows[0]!.passingScore,
      );
      expect(aggregated.totalScore).toBe(attempt.score);
      expect(aggregated.passed).toBe(attempt.passed);
    }
  });

  it("enrollment projections follow the frozen exam policy", async () => {
    // closed exam, candidate1, two graded attempts, scoreStrategy highest:
    // finalScore must be the maximum attempt score and finalAttemptId must
    // reference a graded attempt.
    const closedExamId = ids.exams["closed"]!;
    const c1ProfileId = (
      await db
        .select()
        .from(schema.candidateProfiles)
        .where(
          eq(schema.candidateProfiles.userId, ids.users["candidate1"] ?? ""),
        )
    )[0]!.id;
    const enrollment = (
      await db
        .select()
        .from(schema.examEnrollments)
        .where(inArray(schema.examEnrollments.candidateId, [c1ProfileId]))
    ).find((e) => e.examId === closedExamId)!;

    const graded = await db
      .select()
      .from(schema.examAttempts)
      .where(
        inArray(schema.examAttempts.id, [
          ids.attempts["closed-c1-attempt1"]!,
          ids.attempts["closed-c1-attempt2"]!,
        ]),
      );
    const highest = Math.max(...graded.map((a) => a.score ?? 0));
    expect(enrollment.finalScore).toBe(highest);
    expect(graded.some((a) => a.id === enrollment.finalAttemptId)).toBe(true);
    expect(enrollment.attemptCount).toBe(2);
  });

  it("re-seeding neither duplicates nor contradicts the frozen workset", async () => {
    const before = await db.select().from(schema.attemptGradingEntries);
    const reseededIds = await seedDemo(
      db,
      precomputedHash,
      createDemoSeedGrader(db),
    );

    const after = await db.select().from(schema.attemptGradingEntries);
    expect(after).toHaveLength(before.length);

    for (const key of GRADED_KEYS) {
      const attemptId = reseededIds.attempts[key]!;
      expect(attemptId).toBe(ids.attempts[key]!);
      const rows = await db
        .select()
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.id, attemptId));
      expect(rows[0]!.status).toBe("graded");
    }

    const errors = await verifyDemoSeed(db, reseededIds);
    expect(errors).toEqual([]);
  });

  it("the production submit path is idempotent on already-graded seeded attempts", async () => {
    // Re-invoking the production composition on a graded seeded attempt must
    // be a no-op (already-graded branch), leaving the frozen facts intact.
    const attemptId = ids.attempts["closed-c1-attempt1"]!;
    const before = (
      await db
        .select()
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.id, attemptId))
    )[0]!;

    await createDemoSeedGrader(db).submitAndGrade({
      attemptId,
      candidateProfileId: before.candidateId,
      organizationId: ids.orgId,
      now: new Date(),
    });

    const after = (
      await db
        .select()
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.id, attemptId))
    )[0]!;
    expect(after.status).toBe("graded");
    expect(after.submittedAt?.getTime()).toBe(before.submittedAt?.getTime());
    expect(after.score).toBe(before.score);
  });
});
