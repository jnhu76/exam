import { describe, expect, it } from "vitest";
import type { ExamAttempt, QuestionSnapshot } from "@exam/domain";
import type { AttemptRepository } from "./attemptCommands.js";
import { saveAnswer } from "./answerProtocol.js";

// EXAM-ANSWER-CLOSURE-0 — composite-action tests for the canonical engine-owned
// Save Answer action. These prove the protocol action is CLOSED: load →
// reconstruct → decide (pure processSaveAnswer) → apply → persist all live
// inside `saveAnswer`, so the API route no longer owns reconstruction or the
// attempt.answers write. Pure-decision coverage stays in answerProtocol.test.ts;
// this file covers persistence behavior and rejection no-mutation.

function makeSnapshot(): QuestionSnapshot[] {
  return [
    {
      originalQuestionId: "q1",
      type: "single_choice",
      content: "Q1",
      attachments: [],
      options: [{ id: "a", content: "A" }],
      standardAnswer: "a",
      score: 50,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
      rubric: null,
    },
  ];
}

function makeAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    organizationId: "org-1",
    examId: "exam-1",
    enrollmentId: "enr-1",
    candidateId: "cand-1",
    attemptNo: 1,
    status: "in_progress",
    questionSnapshot: makeSnapshot(),
    answers: [],
    startedAt: new Date("2025-01-01T10:00:00Z"),
    deadlineAt: new Date("2025-01-01T11:00:00Z"),
    lastActivityAt: new Date("2025-01-01T10:00:00Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** In-memory AttemptRepository fake. `updateCalls` records every update payload
 * so tests can assert "no write on rejection" and "single write on accept". */
function makeAttemptRepo(attempts: ExamAttempt[]): AttemptRepository & {
  updateCalls: Partial<ExamAttempt>[];
  get(id: string): ExamAttempt;
} {
  const store = [...attempts];
  const updateCalls: Partial<ExamAttempt>[] = [];
  return {
    findById(id) {
      return store.find((a) => a.id === id) ?? null;
    },
    findByIdForUpdate(id) {
      return store.find((a) => a.id === id) ?? null;
    },
    findActiveByEnrollment() {
      return null;
    },
    findByEnrollmentAndAttemptNo() {
      return null;
    },
    create() {
      throw new Error("not used");
    },
    update(id, data) {
      updateCalls.push(data);
      const idx = store.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      store[idx] = { ...store[idx]!, ...data };
      return store[idx]!;
    },
    updateCalls,
    // Typed-synchronous accessor so tests read durable state without awaiting
    // (the fake is synchronous; the engine interface allows async but the fake
    // never returns a Promise).
    get(id: string): ExamAttempt {
      const found = store.find((a) => a.id === id);
      if (!found) throw new Error(`attempt ${id} not found in fake store`);
      return found;
    },
  };
}

describe("saveAnswer composite action (EXAM-ANSWER-CLOSURE-0)", () => {
  it("1. accepted save persists the new answer with the correct next version", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    const repo = makeAttemptRepo([makeAttempt()]);
    const before = repo.get("attempt-1");
    expect(before.answers).toHaveLength(0);

    const result = await saveAnswer(
      repo,
      "attempt-1",
      {
        attemptId: "attempt-1",
        questionId: "q1",
        answer: "b",
        clientSeq: 1,
        clientSavedAt: now.toISOString(),
        baseVersion: 0,
      },
      now,
    );

    expect(result.accepted).toBe(true);
    expect(result.serverVersion).toBe(1);
    // Persistence: the canonical action performed the repo write.
    expect(repo.updateCalls).toHaveLength(1);
    const after = repo.get("attempt-1");
    expect(after.answers).toHaveLength(1);
    expect(after.answers[0]).toMatchObject({
      questionId: "q1",
      answer: "b",
      version: 1,
    });
    // lastActivityAt is stamped by the action (heartbeat bookkeeping).
    expect(after.lastActivityAt).toEqual(now);
  });

  it("2. stale version returns a semantic rejection and leaves persisted answers unchanged", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    // Existing q1 answer at version 2.
    const existing = {
      questionId: "q1",
      answer: "c",
      version: 2,
      savedAt: new Date("2025-01-01T10:04:00Z"),
      clientSeq: 2,
      clientSeqHistory: [
        {
          clientSeq: 2,
          answer: "c",
          version: 2,
          savedAt: new Date("2025-01-01T10:04:00Z"),
        },
      ],
    };
    const repo = makeAttemptRepo([makeAttempt({ answers: [existing] })]);
    const beforeAnswers = repo.get("attempt-1").answers;

    const result = await saveAnswer(
      repo,
      "attempt-1",
      {
        attemptId: "attempt-1",
        questionId: "q1",
        answer: "x",
        clientSeq: 3,
        clientSavedAt: now.toISOString(),
        baseVersion: 1, // behind current version 2
      },
      now,
    );

    expect(result.accepted).toBe(false);
    expect(result.conflict?.reason).toBe("STALE_VERSION");
    expect(result.serverVersion).toBe(2);
    // No protocol write on rejection.
    expect(repo.updateCalls).toHaveLength(0);
    expect(repo.get("attempt-1").answers).toEqual(beforeAnswers);
  });

  it("3. idempotent replay performs no write and preserves the original savedAt", async () => {
    const originalSavedAt = new Date("2025-01-01T10:04:00Z");
    const now = new Date("2025-01-01T10:05:00Z");
    // Existing q1 answer saved at clientSeq=1 with answer "b".
    const existing = {
      questionId: "q1",
      answer: "b",
      version: 1,
      savedAt: originalSavedAt,
      clientSeq: 1,
      clientSeqHistory: [
        {
          clientSeq: 1,
          answer: "b",
          version: 1,
          savedAt: originalSavedAt,
        },
      ],
    };
    const repo = makeAttemptRepo([makeAttempt({ answers: [existing] })]);
    const before = repo.get("attempt-1").answers;

    const result = await saveAnswer(
      repo,
      "attempt-1",
      {
        attemptId: "attempt-1",
        questionId: "q1",
        answer: "b", // identical payload
        clientSeq: 1, // same seq
        clientSavedAt: now.toISOString(),
        baseVersion: 0,
      },
      now,
    );

    expect(result.accepted).toBe(true);
    // Replay returns the ORIGINAL savedAt, not `now`.
    expect(result.savedAt).toBe(originalSavedAt.toISOString());
    expect(result.serverVersion).toBe(1);
    // No write performed — durable state is unchanged.
    expect(repo.updateCalls).toHaveLength(0);
    const after = repo.get("attempt-1").answers;
    expect(after).toBe(before); // same reference — no write touched the store
    expect(after[0]).toMatchObject({
      questionId: "q1",
      answer: "b",
      version: 1,
    });
  });

  it("4. conflicting payload returns a semantic rejection and leaves persisted answers unchanged", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    const originalSavedAt = new Date("2025-01-01T10:04:00Z");
    // Existing q1 answer at clientSeq=1 with answer "b".
    const existing = {
      questionId: "q1",
      answer: "b",
      version: 1,
      savedAt: originalSavedAt,
      clientSeq: 1,
      clientSeqHistory: [
        {
          clientSeq: 1,
          answer: "b",
          version: 1,
          savedAt: originalSavedAt,
        },
      ],
    };
    const repo = makeAttemptRepo([makeAttempt({ answers: [existing] })]);
    const beforeAnswers = repo.get("attempt-1").answers;

    const result = await saveAnswer(
      repo,
      "attempt-1",
      {
        attemptId: "attempt-1",
        questionId: "q1",
        answer: "DIFFERENT", // different payload, same clientSeq
        clientSeq: 1,
        clientSavedAt: now.toISOString(),
        baseVersion: 0,
      },
      now,
    );

    expect(result.accepted).toBe(false);
    expect(result.conflict?.reason).toBe("CONFLICTING_PAYLOAD");
    expect(result.conflict?.latestAnswer).toBe("b");
    expect(repo.updateCalls).toHaveLength(0);
    expect(repo.get("attempt-1").answers).toEqual(beforeAnswers);
  });

  it("5. submitted/terminal attempt is rejected with no draft mutation", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    for (const terminal of ["submitted", "grading", "graded"] as const) {
      const repo = makeAttemptRepo([makeAttempt({ status: terminal })]);
      const beforeAnswers = repo.get("attempt-1").answers;

      const result = await saveAnswer(
        repo,
        "attempt-1",
        {
          attemptId: "attempt-1",
          questionId: "q1",
          answer: "b",
          clientSeq: 1,
          clientSavedAt: now.toISOString(),
          baseVersion: 0,
        },
        now,
      );

      expect(result.accepted).toBe(false);
      expect(result.conflict?.reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
      expect(repo.updateCalls).toHaveLength(0);
      expect(repo.get("attempt-1").answers).toEqual(beforeAnswers);
    }
  });

  it("6. deadline exceeded is rejected with no draft mutation", async () => {
    // Attempt deadline already in the past relative to `now`.
    const deadline = new Date("2025-01-01T10:00:00Z");
    const now = new Date("2025-01-01T10:00:01Z");
    const repo = makeAttemptRepo([makeAttempt({ deadlineAt: deadline })]);
    const beforeAnswers = repo.get("attempt-1").answers;

    const result = await saveAnswer(
      repo,
      "attempt-1",
      {
        attemptId: "attempt-1",
        questionId: "q1",
        answer: "b",
        clientSeq: 1,
        clientSavedAt: now.toISOString(),
        baseVersion: 0,
      },
      now,
    );

    expect(result.accepted).toBe(false);
    expect(result.conflict?.reason).toBe("DEADLINE_EXCEEDED");
    expect(repo.updateCalls).toHaveLength(0);
    expect(repo.get("attempt-1").answers).toEqual(beforeAnswers);
  });

  it("7. answer version increments correctly across sequential accepted saves", async () => {
    const t0 = new Date("2025-01-01T10:05:00Z");
    const t1 = new Date("2025-01-01T10:06:00Z");
    const t2 = new Date("2025-01-01T10:07:00Z");
    const repo = makeAttemptRepo([makeAttempt()]);

    const r1 = await saveAnswer(
      repo,
      "attempt-1",
      {
        attemptId: "attempt-1",
        questionId: "q1",
        answer: "a",
        clientSeq: 1,
        clientSavedAt: t0.toISOString(),
        baseVersion: 0,
      },
      t0,
    );
    expect(r1.serverVersion).toBe(1);

    const r2 = await saveAnswer(
      repo,
      "attempt-1",
      {
        attemptId: "attempt-1",
        questionId: "q1",
        answer: "b",
        clientSeq: 2,
        clientSavedAt: t1.toISOString(),
        baseVersion: 1,
      },
      t1,
    );
    expect(r2.serverVersion).toBe(2);

    const r3 = await saveAnswer(
      repo,
      "attempt-1",
      {
        attemptId: "attempt-1",
        questionId: "q1",
        answer: "c",
        clientSeq: 3,
        clientSavedAt: t2.toISOString(),
        baseVersion: 2,
      },
      t2,
    );
    expect(r3.serverVersion).toBe(3);

    // Final persisted answer carries the latest version.
    const after = repo.get("attempt-1");
    expect(after.answers).toHaveLength(1);
    expect(after.answers[0]).toMatchObject({
      questionId: "q1",
      answer: "c",
      version: 3,
    });
  });

  it("8. clientSeq history is preserved across a subsequent action call (idempotency replay)", async () => {
    const t0 = new Date("2025-01-01T10:05:00Z");
    const t1 = new Date("2025-01-01T10:06:00Z");
    const repo = makeAttemptRepo([makeAttempt()]);

    // First save at clientSeq=1, answer "a".
    await saveAnswer(
      repo,
      "attempt-1",
      {
        attemptId: "attempt-1",
        questionId: "q1",
        answer: "a",
        clientSeq: 1,
        clientSavedAt: t0.toISOString(),
        baseVersion: 0,
      },
      t0,
    );
    // Second save at clientSeq=2, answer "b" (new version).
    await saveAnswer(
      repo,
      "attempt-1",
      {
        attemptId: "attempt-1",
        questionId: "q1",
        answer: "b",
        clientSeq: 2,
        clientSavedAt: t1.toISOString(),
        baseVersion: 1,
      },
      t1,
    );

    // Replay the FIRST clientSeq=1 with the SAME payload "a" — must be accepted
    // as idempotent (NOT treated as a conflicting payload), proving the prior
    // clientSeq=1 history was preserved by the second save's reconstruction.
    const replay = await saveAnswer(
      repo,
      "attempt-1",
      {
        attemptId: "attempt-1",
        questionId: "q1",
        answer: "a",
        clientSeq: 1,
        clientSavedAt: t0.toISOString(),
        baseVersion: 0,
      },
      t1,
    );

    expect(replay.accepted).toBe(true);
    expect(replay.conflict).toBeUndefined();
    // No new write on replay.
    // Two accepted saves => two writes; the replay must not add a third.
    expect(repo.updateCalls).toHaveLength(2);
    // Durable answer remains the latest ("b" at version 2).
    const after = repo.get("attempt-1");
    expect(after.answers[0]).toMatchObject({
      questionId: "q1",
      answer: "b",
      version: 2,
    });
  });
});
