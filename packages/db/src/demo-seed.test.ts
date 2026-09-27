import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "./types.js";
import { getIsolatedTestDb } from "./testDb.js";
import {
  seedDemo,
  DEMO_GRADED_ATTEMPT_KEYS,
  type DemoSeedGrader,
} from "./demo-seed.js";
import { verifyDemoSeed } from "./demo-seed-verify.js";
import { schema } from "./schema/pg.js";
import { hashPassword, verifyPassword } from "@exam/auth/src/password.js";

// Pre-computed argon2id hashes for demo-seed passwords. Generated once with
// default parameters to avoid ~80ms/call hash computation during tests.
// 6 seed users × 80ms ≈ 480ms saved per seedDemo call (test calls it 9×).
const ADMIN_PW_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$C12Yp33+uAT+Ew3Fkbl5Bw$HkRUB4mhpHXaa7gWLtiDlJjFacO8R6YUDTpLrMwCZLs";
const CAND_PW_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$3dCWwSdVOt1y1PCOkxbQVQ$PlSw+GRS5dzJOaVzXjzqF4HoI0/msheYXyIYQRyOmzw";

const precomputedHash = async (password: string): Promise<string> => {
  return password === "admin123" ? ADMIN_PW_HASH : CAND_PW_HASH;
};

/**
 * Recording grader stub for the seed-machinery tests in this package. The
 * graded-attempt SEMANTIC conformance (durable workset, frozen answers,
 * projections) lives in @exam/api's demo-seed-grading tests, where the real
 * production submit+grade composition is importable; here the stub only
 * records the handoff contract.
 */
function makeRecordingGrader(): {
  grader: DemoSeedGrader;
  calls: Array<{
    attemptId: string;
    candidateProfileId: string;
    organizationId: string;
    now: Date;
  }>;
} {
  const calls: Array<{
    attemptId: string;
    candidateProfileId: string;
    organizationId: string;
    now: Date;
  }> = [];
  return {
    calls,
    grader: {
      async submitAndGrade(input) {
        calls.push(input);
      },
    },
  };
}

describe("demo seed", { timeout: 30_000 }, () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-demo-seed");
    db = result.db;
    cleanup = result.cleanup;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("verifyDemoSeed FAILS a recording-grader seed: handoff without real grading is not valid demo state", async () => {
    // Negative witness for verifier completeness (EXSEM-020): the recording
    // grader proves the seed REQUESTED grading (6 handoffs) but no terminal
    // facts exist, so the seeded database is NOT valid graded demo state.
    // verifyDemoSeed must detect exactly that — it may not pass vacuously on
    // zero graded rows.
    const { grader } = makeRecordingGrader();
    const ids = await seedDemo(db, precomputedHash, grader);
    const errors = await verifyDemoSeed(db, ids);
    expect(errors.length).toBeGreaterThan(0);
    for (const key of DEMO_GRADED_ATTEMPT_KEYS) {
      expect(
        errors.some((e) => e.includes(`'${key}'`)),
        `verifier must report the ungraded fixture '${key}'; got: ${JSON.stringify(errors)}`,
      ).toBe(true);
    }
  });

  it("is idempotent on second run (identical fixture identity)", async () => {
    // Mechanical idempotency of the seed's upsert machinery — same fixture
    // identity on re-run. Semantic grading-truth idempotency (frozen workset
    // preserved through a reseed) is proven with the real grader in
    // @exam/api's demo-seed-grading tests.
    const { grader } = makeRecordingGrader();
    const firstIds = await seedDemo(db, precomputedHash, grader);
    const secondIds = await seedDemo(db, precomputedHash, grader);
    expect(secondIds.attempts).toEqual(firstIds.attempts);
    expect(secondIds.exams).toEqual(firstIds.exams);
  });

  it("fails closed when a nullish grader slips past the type contract (EXSEM-020)", async () => {
    // The TS contract makes the grader REQUIRED; this pins the runtime guard
    // that still protects non-TS callers (the tsx seed entrypoints).
    const grader = undefined as unknown as DemoSeedGrader;
    await expect(seedDemo(db, precomputedHash, grader)).rejects.toThrow(
      /DemoSeedGrader.*EXSEM-020|EXSEM-020.*DemoSeedGrader/s,
    );
  });

  it("hands every graded attempt to the grader in pre-submit state, deadlines respected", async () => {
    const { grader, calls } = makeRecordingGrader();
    const ids = await seedDemo(db, precomputedHash, grader);

    // Six graded attempt specs, closed-c1 attempt1 before attempt2 so the
    // "highest" strategy folds in order.
    expect(calls).toHaveLength(6);
    const attemptOrder = calls.map((c) => c.attemptId);
    expect(
      attemptOrder.indexOf(ids.attempts["closed-c1-attempt1"]!),
    ).toBeLessThan(attemptOrder.indexOf(ids.attempts["closed-c1-attempt2"]!));

    for (const call of calls) {
      expect(call.organizationId).toBe(ids.orgId);
      const rows = await db
        .select()
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.id, call.attemptId));
      const attempt = rows[0]!;
      expect(attempt.candidateId).toBe(call.candidateProfileId);
      // Pre-submit handoff: the seed fabricated the draft state only — no
      // frozen answers, no terminal projection, and the fabricated submit
      // instant precedes the attempt deadline.
      expect(attempt.status).toBe("in_progress");
      expect(attempt.submittedAnswers).toBeNull();
      expect(attempt.gradingResult).toBeNull();
      expect(attempt.score).toBeNull();
      expect(call.now.getTime()).toBeLessThan(attempt.deadlineAt!.getTime());
    }
  });

  it("keeps question idempotency scoped by course", async () => {
    const { grader } = makeRecordingGrader();
    const ids = await seedDemo(db, precomputedHash, grader);
    const skillCourseId = ids.courses["SKILL-201"]!;

    await db.insert(schema.questions).values({
      id: randomUUID(),
      organizationId: ids.orgId,
      courseId: skillCourseId,
      type: "single_choice",
      content: "消防通道的宽度不得低于____米",
      options: [],
      standardAnswer: "1.2",
      attachments: [],
      score: 5,
      difficulty: 3,
      tags: ["safety", "regulation"],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
        fillBlankCaseSensitive: false,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const reseededIds = await seedDemo(db, precomputedHash, grader);
    const safetyCourseId = reseededIds.courses["SAFETY-101"]!;
    const safetyQuestions = await db
      .select()
      .from(schema.questions)
      .where(
        and(
          eq(schema.questions.organizationId, reseededIds.orgId),
          eq(schema.questions.courseId, safetyCourseId),
        ),
      );

    expect(safetyQuestions).toHaveLength(6);
    expect(reseededIds.questions["safety-fb2"]).toBeDefined();
    expect(
      safetyQuestions.some((q) => q.id === reseededIds.questions["safety-fb2"]),
    ).toBe(true);
  });

  it("creates all expected users with real argon2 hashes", async () => {
    const { grader } = makeRecordingGrader();
    await seedDemo(db, hashPassword, grader);
    const demoOrg = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, "default"));
    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.organizationId, demoOrg[0]!.id));
    const activeUsernames = users
      .filter((u) => u.isActive)
      .map((u) => u.username)
      .sort();
    expect(activeUsernames).toContain("admin");
    expect(activeUsernames).toContain("candidate1");
    expect(activeUsernames).toContain("candidate2");

    const admin = users.find((u) => u.username === "admin")!;
    expect(await verifyPassword("admin123", admin.passwordHash)).toBe(true);
  });
});
