import { describe, expect, it } from "vitest";
import type { ExamAttempt } from "@exam/domain";
import { saveAnswer } from "./answerProtocol.js";
import {
  makeExam,
  makeAttempt,
  makeEnrollment,
  makeManualSnapshot,
  prepare,
  type PreparedHarness,
} from "./attemptMutation.testHelpers.js";

// EXAM-ANSWER-CLOSURE-0 + EXAM-ANSWER-PRECONDITION-CORRECTIVE-0 — composite-action
// regression tests for the canonical engine-owned Save Answer action. These
// prove the protocol action is CLOSED and now consumes opaque mutation
// evidence: load → P1 validate membership → reconstruct → decide (pure
// processSaveAnswer, using the canonical effective deadline from the context)
// → apply → persist all live inside `saveAnswer`, and the API route no longer
// owns reconstruction, membership, or the attempt.answers write. Pure-decision
// coverage stays in answerProtocol.test.ts; this file covers persistence
// behavior and rejection no-mutation against the corrected context-based API.

/**
 * Helper that builds the canonical preparation harness (EA lock + reconciliation
 * + context mint) for an in-progress attempt and returns it ready to drive
 * `saveAnswer`. The exam window is wide so `now` (10:05) is well within the
 * canonical effective deadline (min(closeAt=12:00, deadlineAt=11:00) = 11:00).
 */
async function harness(
  attemptOverrides: Partial<ExamAttempt> = {},
  now = new Date("2025-01-01T10:05:00Z"),
): Promise<PreparedHarness> {
  return prepare(
    makeExam(),
    makeAttempt(attemptOverrides),
    makeEnrollment(),
    now,
  );
}

describe("saveAnswer composite action (EXAM-ANSWER-CLOSURE-0)", () => {
  it("1. accepted save persists the new answer with the correct next version", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    const h = await harness({}, now);
    const before = h.attemptRepo.get("attempt-1");
    expect(before.answers).toHaveLength(0);

    const result = await saveAnswer(h.attemptRepo, h.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "b",
      clientSeq: 1,
      clientSavedAt: now.toISOString(),
      baseVersion: 0,
    });

    expect(result.accepted).toBe(true);
    expect(result.serverVersion).toBe(1);
    expect(h.attemptRepo.updateCalls).toHaveLength(1);
    const after = h.attemptRepo.get("attempt-1");
    expect(after.answers).toHaveLength(1);
    expect(after.answers[0]).toMatchObject({
      questionId: "q1",
      answer: "b",
      version: 1,
    });
    // lastActivityAt is stamped by the action from the context checkedAt.
    expect(after.lastActivityAt).toEqual(now);
  });

  it("2. stale version returns a semantic rejection and leaves persisted answers unchanged", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
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
    const h = await harness({ answers: [existing] }, now);
    const beforeAnswers = h.attemptRepo.get("attempt-1").answers;

    const result = await saveAnswer(h.attemptRepo, h.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "x",
      clientSeq: 3,
      clientSavedAt: now.toISOString(),
      baseVersion: 1, // behind current version 2
    });

    expect(result.accepted).toBe(false);
    expect(result.conflict?.reason).toBe("STALE_VERSION");
    expect(result.serverVersion).toBe(2);
    expect(h.attemptRepo.updateCalls).toHaveLength(0);
    expect(h.attemptRepo.get("attempt-1").answers).toEqual(beforeAnswers);
  });

  it("3. idempotent replay performs no write and preserves the original savedAt", async () => {
    const originalSavedAt = new Date("2025-01-01T10:04:00Z");
    const now = new Date("2025-01-01T10:05:00Z");
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
    const h = await harness({ answers: [existing] }, now);
    const before = h.attemptRepo.get("attempt-1").answers;

    const result = await saveAnswer(h.attemptRepo, h.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "b", // identical payload
      clientSeq: 1, // same seq
      clientSavedAt: now.toISOString(),
      baseVersion: 0,
    });

    expect(result.accepted).toBe(true);
    expect(result.savedAt).toBe(originalSavedAt.toISOString());
    expect(result.serverVersion).toBe(1);
    expect(h.attemptRepo.updateCalls).toHaveLength(0);
    const after = h.attemptRepo.get("attempt-1").answers;
    expect(after).toBe(before);
    expect(after[0]).toMatchObject({
      questionId: "q1",
      answer: "b",
      version: 1,
    });
  });

  it("4. conflicting payload returns a semantic rejection and leaves persisted answers unchanged", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    const originalSavedAt = new Date("2025-01-01T10:04:00Z");
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
    const h = await harness({ answers: [existing] }, now);
    const beforeAnswers = h.attemptRepo.get("attempt-1").answers;

    const result = await saveAnswer(h.attemptRepo, h.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "DIFFERENT", // different payload, same clientSeq
      clientSeq: 1,
      clientSavedAt: now.toISOString(),
      baseVersion: 0,
    });

    expect(result.accepted).toBe(false);
    expect(result.conflict?.reason).toBe("CONFLICTING_PAYLOAD");
    expect(result.conflict?.latestAnswer).toBe("b");
    expect(h.attemptRepo.updateCalls).toHaveLength(0);
    expect(h.attemptRepo.get("attempt-1").answers).toEqual(beforeAnswers);
  });

  it("5. submitted/terminal attempt is rejected with no draft mutation", async () => {
    const now = new Date("2025-01-01T10:05:00Z");
    for (const terminal of ["submitted", "grading", "graded"] as const) {
      const h = await harness({ status: terminal }, now);
      const beforeAnswers = h.attemptRepo.get("attempt-1").answers;

      const result = await saveAnswer(h.attemptRepo, h.mutationContext, {
        attemptId: "attempt-1",
        questionId: "q1",
        answer: "b",
        clientSeq: 1,
        clientSavedAt: now.toISOString(),
        baseVersion: 0,
      });

      expect(result.accepted).toBe(false);
      expect(result.conflict?.reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
      expect(h.attemptRepo.updateCalls).toHaveLength(0);
      expect(h.attemptRepo.get("attempt-1").answers).toEqual(beforeAnswers);
    }
  });

  it("6. deadline exceeded (now >= canonical effective deadline) closes mutation safety with no draft write", async () => {
    // The canonical effective deadline comes from the context
    // (computeEffectiveDeadline = min(exam.closeAt, attempt.deadlineAt)).
    // Build an attempt whose effective deadline is in the past relative to the
    // preparation `now`: attempt.deadlineAt = 10:00 < now = 10:00:01. A manual
    // snapshot lets the reconciliation seam freeze cleanly to pending_manual.
    const now = new Date("2025-01-01T10:00:01Z");
    const h = await prepare(
      makeExam(),
      makeAttempt({
        questionSnapshot: makeManualSnapshot(),
        deadlineAt: new Date("2025-01-01T10:00:00Z"),
      }),
      makeEnrollment(),
      now,
    );
    const beforeAnswers = h.attemptRepo.get("attempt-1").answers;

    const result = await saveAnswer(h.attemptRepo, h.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "b",
      clientSeq: 1,
      clientSavedAt: now.toISOString(),
      baseVersion: 0,
    });

    // The preparation seam froze the attempt at the canonical effective
    // deadline (a lifecycle status write, not a draft `answers` write);
    // saveAnswer sees the frozen status and refuses the draft mutation.
    expect(result.accepted).toBe(false);
    expect(h.attemptRepo.draftAnswerWriteCount()).toBe(0);
    expect(h.attemptRepo.get("attempt-1").answers).toEqual(beforeAnswers);
  });

  it("7. answer version increments correctly across sequential accepted saves", async () => {
    const t0 = new Date("2025-01-01T10:05:00Z");
    const t1 = new Date("2025-01-01T10:06:00Z");
    const t2 = new Date("2025-01-01T10:07:00Z");

    const h0 = await harness({}, t0);
    const r1 = await saveAnswer(h0.attemptRepo, h0.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "a",
      clientSeq: 1,
      clientSavedAt: t0.toISOString(),
      baseVersion: 0,
    });
    expect(r1.serverVersion).toBe(1);

    // Fresh context (new tx) for the second save against the persisted state.
    const h1 = await prepare(
      makeExam(),
      h0.attemptRepo.get("attempt-1"),
      makeEnrollment(),
      t1,
    );
    const r2 = await saveAnswer(h1.attemptRepo, h1.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "b",
      clientSeq: 2,
      clientSavedAt: t1.toISOString(),
      baseVersion: 1,
    });
    expect(r2.serverVersion).toBe(2);

    const h2 = await prepare(
      makeExam(),
      h1.attemptRepo.get("attempt-1"),
      makeEnrollment(),
      t2,
    );
    const r3 = await saveAnswer(h2.attemptRepo, h2.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "c",
      clientSeq: 3,
      clientSavedAt: t2.toISOString(),
      baseVersion: 2,
    });
    expect(r3.serverVersion).toBe(3);

    const after = h2.attemptRepo.get("attempt-1");
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

    const h0 = await harness({}, t0);
    await saveAnswer(h0.attemptRepo, h0.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "a",
      clientSeq: 1,
      clientSavedAt: t0.toISOString(),
      baseVersion: 0,
    });

    const h1 = await prepare(
      makeExam(),
      h0.attemptRepo.get("attempt-1"),
      makeEnrollment(),
      t1,
    );
    await saveAnswer(h1.attemptRepo, h1.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "b",
      clientSeq: 2,
      clientSavedAt: t1.toISOString(),
      baseVersion: 1,
    });

    // Replay the FIRST clientSeq=1 with the SAME payload "a" — must be accepted
    // as idempotent (NOT treated as a conflicting payload), proving the prior
    // clientSeq=1 history was preserved by the second save's reconstruction.
    const replay = await saveAnswer(h1.attemptRepo, h1.mutationContext, {
      attemptId: "attempt-1",
      questionId: "q1",
      answer: "a",
      clientSeq: 1,
      clientSavedAt: t0.toISOString(),
      baseVersion: 0,
    });

    expect(replay.accepted).toBe(true);
    expect(replay.conflict).toBeUndefined();
    // h1's repo recorded exactly one write (the second accepted save at t1);
    // the replay against h1's context performs no additional write.
    expect(h1.attemptRepo.updateCalls).toHaveLength(1);
    const after = h1.attemptRepo.get("attempt-1");
    expect(after.answers[0]).toMatchObject({
      questionId: "q1",
      answer: "b",
      version: 2,
    });
  });
});
