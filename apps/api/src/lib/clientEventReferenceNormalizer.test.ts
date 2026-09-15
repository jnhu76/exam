import { describe, expect, it } from "vitest";
import {
  resolveEventReferences,
  type ReferenceEvidence,
} from "./clientEventReferenceNormalizer.js";

/**
 * Pure-invariant tests for the client-event reference trust boundary (#544).
 * The DB-backed producer paths (ownership/enrollment/frozen question set) are
 * covered by the route-level trust tests; these pin the atomic-consistency
 * and no-mixed-association invariant without fixtures.
 */
function evidence(
  overrides: Partial<ReferenceEvidence> = {},
): ReferenceEvidence {
  return {
    ownedAttemptExamIds: new Map([["att-owned", "exam-canonical"]]),
    eligibleExamIds: new Set(["exam-enrolled"]),
    examQuestionIds: new Map([
      ["exam-canonical", new Set(["q-1", "q-2"])],
      ["exam-enrolled", new Set(["q-1"])],
    ]),
    ...overrides,
  };
}

describe("resolveEventReferences (atomic-consistency invariant)", () => {
  it("keeps an owned attempt and derives the canonical exam over the client claim", () => {
    const out = resolveEventReferences(
      { attemptId: "att-owned", examId: "exam-forged", questionId: null },
      evidence(),
    );
    expect(out).toEqual({
      attemptId: "att-owned",
      examId: "exam-canonical",
      questionId: null,
    });
  });

  it("never leaves a mixed association: unproven attempt falls back to exam-only anchoring", () => {
    const out = resolveEventReferences(
      {
        attemptId: "att-victim",
        examId: "exam-enrolled",
        questionId: "q-1",
      },
      evidence(),
    );
    expect(out).toEqual({
      attemptId: null,
      examId: "exam-enrolled",
      questionId: "q-1",
    });
  });

  it("drops the questionId that is outside the anchor exam's frozen set", () => {
    const out = resolveEventReferences(
      {
        attemptId: "att-owned",
        examId: "exam-canonical",
        questionId: "q-foreign",
      },
      evidence(),
    );
    expect(out).toEqual({
      attemptId: "att-owned",
      examId: "exam-canonical",
      questionId: null,
    });
  });

  it("drops everything when nothing is provable", () => {
    const out = resolveEventReferences(
      {
        attemptId: "att-victim",
        examId: "exam-foreign",
        questionId: "q-x",
      },
      evidence(),
    );
    expect(out).toEqual({ attemptId: null, examId: null, questionId: null });
  });

  it("keeps a questionId on the exam-only path only inside that exam's frozen set", () => {
    const kept = resolveEventReferences(
      { attemptId: null, examId: "exam-enrolled", questionId: "q-1" },
      evidence(),
    );
    expect(kept.questionId).toBe("q-1");
    const dropped = resolveEventReferences(
      { attemptId: null, examId: "exam-enrolled", questionId: "q-2" },
      evidence(),
    );
    expect(dropped.questionId).toBeNull();
  });

  it("questionId never survives without an anchor exam", () => {
    const out = resolveEventReferences(
      { attemptId: null, examId: null, questionId: "q-1" },
      evidence(),
    );
    expect(out).toEqual({ attemptId: null, examId: null, questionId: null });
  });
});
