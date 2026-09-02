// Phase A2 (#291) — Save Answer semantics per timing mode.
//
// The mutation context's effectiveDeadline is legitimately null for untimed
// attempts (null != expired: the pure decision accepts saves without a
// deadline). deadline-mode attempts save before the global closeAt and are
// frozen by the canonical reconciliation at/after it. There is exactly ONE
// saveAnswer path for all modes — no per-mode branch.

import { describe, expect, it } from "vitest";
import type { Exam, ExamAttempt } from "@exam/domain";
import { saveAnswer } from "./answerProtocol.js";
import {
  makeAttempt,
  makeEnrollment,
  makeExam,
  makeManualSnapshot,
  prepare,
} from "./attemptMutation.testHelpers.js";

const withinWindow = new Date("2025-01-01T10:05:00Z");

const deadlineExam = (): Exam =>
  makeExam({ timingMode: "deadline", durationMinutes: null });

const untimedExam = (): Exam =>
  makeExam({ timingMode: "untimed", durationMinutes: null, closeAt: null });

function saveRequest(now: Date) {
  return {
    attemptId: "attempt-1",
    questionId: "q1",
    answer: "b",
    clientSeq: 1,
    clientSavedAt: now.toISOString(),
    baseVersion: 0,
  };
}

describe("saveAnswer — Phase A timing modes", () => {
  it("untimed attempt can save (effectiveDeadline null != expired)", async () => {
    const h = await prepare(
      untimedExam(),
      makeAttempt({ deadlineAt: null }),
      makeEnrollment(),
      withinWindow,
    );
    expect(h.mutationContext.effectiveDeadline).toBeNull();

    const result = await saveAnswer(
      h.attemptRepo,
      h.mutationContext,
      saveRequest(withinWindow),
    );
    expect(result.accepted).toBe(true);
    expect(result.serverVersion).toBe(1);
    expect(h.attemptRepo.draftAnswerWriteCount()).toBe(1);
  });

  it("deadline attempt saves before the global closeAt", async () => {
    const h = await prepare(
      deadlineExam(),
      makeAttempt({ deadlineAt: null }),
      makeEnrollment(),
      withinWindow,
    );
    // No personal deadline — the effective deadline is the exam closeAt.
    expect(h.mutationContext.effectiveDeadline).toEqual(
      new Date("2025-01-01T12:00:00Z"),
    );

    const result = await saveAnswer(
      h.attemptRepo,
      h.mutationContext,
      saveRequest(withinWindow),
    );
    expect(result.accepted).toBe(true);
  });

  it("deadline attempt at/after closeAt is frozen by reconciliation, save refused", async () => {
    const atClose = new Date("2025-01-01T12:00:00Z");
    const h = await prepare(
      deadlineExam(),
      // Manual snapshot: the freeze lands on pending_manual, skipping the
      // auto-grading aggregation (which the in-memory workset cannot serve).
      makeAttempt({
        questionSnapshot: makeManualSnapshot(),
        deadlineAt: null,
      }),
      makeEnrollment(),
      atClose,
    );
    // The preparation seam auto-submitted the attempt at the effective
    // deadline (business time = closeAt), not the wall-clock instant.
    expect(h.attempt.status).toBe("submitted");
    expect(h.attempt.submittedAt).toEqual(new Date("2025-01-01T12:00:00Z"));

    const result = await saveAnswer(
      h.attemptRepo,
      h.mutationContext,
      saveRequest(atClose),
    );
    expect(result.accepted).toBe(false);
    expect(h.attemptRepo.draftAnswerWriteCount()).toBe(0);
  });

  it("untimed attempt is never frozen by reconciliation, however late", async () => {
    const farFuture = new Date("2099-01-01T00:00:00Z");
    const attempt: ExamAttempt = makeAttempt({ deadlineAt: null });
    const h = await prepare(
      untimedExam(),
      attempt,
      makeEnrollment(),
      farFuture,
    );
    expect(h.attempt.status).toBe("in_progress");
    expect(h.attempt.submittedAt ?? null).toBeNull();
  });
});
