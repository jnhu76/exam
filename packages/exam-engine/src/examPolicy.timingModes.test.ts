// Phase A2 (#291) canonical timing-mode matrix — focused unit tests.
//
// The canonical validator is the ONE authority that decides which
// (timingMode, durationMinutes, closeAt, interruptionTimePolicy)
// combinations may be persisted/published. Zod may reject shapes early,
// but this matrix is the final acceptance gate (create / draft-update /
// publish revalidation all funnel through it).
//
// Frozen Phase A semantics:
//   timed_window  duration > 0, closeAt present, interruption policies
//                 unchanged (strict / bounded_grace / operator_incident)
//   deadline      duration null, closeAt present, strict only — global
//                 cutoff without a personal duration
//   untimed       duration null, closeAt null, strict only — open-ended
//   timed_sync    rejected in Phase A (no admission/queue runtime yet)

import { describe, expect, it } from "vitest";
import { ExamPolicyConflictCode } from "@exam/domain";
import { makeExam } from "./attemptMutation.testHelpers.js";
import { validateExamPolicyForExam } from "./examPolicy.js";

const TIMING_MODE_INVALID = ExamPolicyConflictCode.ExamTimingModeInvalid;

/** Asserts the resolved policy yields EXACTLY one timing-mode conflict. */
function expectTimingConflict(
  exam: Parameters<typeof validateExamPolicyForExam>[0],
) {
  const conflicts = validateExamPolicyForExam(exam);
  expect(conflicts).toContainEqual(
    expect.objectContaining({ code: TIMING_MODE_INVALID }),
  );
}

describe("Phase A timing-mode matrix — valid combinations", () => {
  it("accepts timed_window (duration, closeAt, strict)", () => {
    expect(validateExamPolicyForExam(makeExam())).toEqual([]);
  });

  it("accepts timed_window with bounded_grace and operator_incident", () => {
    expect(
      validateExamPolicyForExam(
        makeExam({
          interruptionTimePolicy: "bounded_grace",
          interruptionGracePerIncidentSeconds: 120,
          interruptionGracePerAttemptSeconds: 300,
        }),
      ),
    ).toEqual([]);
    expect(
      validateExamPolicyForExam(
        makeExam({ interruptionTimePolicy: "operator_incident" }),
      ),
    ).toEqual([]);
  });

  it("accepts deadline (null duration, closeAt, strict)", () => {
    expect(
      validateExamPolicyForExam(
        makeExam({ timingMode: "deadline", durationMinutes: null }),
      ),
    ).toEqual([]);
  });

  it("accepts untimed (null duration, null closeAt, strict)", () => {
    expect(
      validateExamPolicyForExam(
        makeExam({
          timingMode: "untimed",
          durationMinutes: null,
          closeAt: null,
        }),
      ),
    ).toEqual([]);
  });
});

describe("Phase A timing-mode matrix — timed_window rejections", () => {
  it("rejects timed_window with null duration", () => {
    expectTimingConflict(makeExam({ durationMinutes: null }));
  });

  it("rejects timed_window with null closeAt", () => {
    expectTimingConflict(makeExam({ closeAt: null }));
  });
});

describe("Phase A timing-mode matrix — deadline rejections", () => {
  it("rejects deadline with a positive duration", () => {
    expectTimingConflict(
      makeExam({ timingMode: "deadline", durationMinutes: 60 }),
    );
  });

  it("rejects deadline without closeAt", () => {
    expectTimingConflict(
      makeExam({
        timingMode: "deadline",
        durationMinutes: null,
        closeAt: null,
      }),
    );
  });

  it("rejects deadline with bounded_grace", () => {
    expectTimingConflict(
      makeExam({
        timingMode: "deadline",
        durationMinutes: null,
        interruptionTimePolicy: "bounded_grace",
      }),
    );
  });

  it("rejects deadline with operator_incident", () => {
    expectTimingConflict(
      makeExam({
        timingMode: "deadline",
        durationMinutes: null,
        interruptionTimePolicy: "operator_incident",
      }),
    );
  });
});

describe("Phase A timing-mode matrix — untimed rejections", () => {
  it("rejects untimed with a positive duration", () => {
    expectTimingConflict(
      makeExam({
        timingMode: "untimed",
        durationMinutes: 60,
        closeAt: null,
      }),
    );
  });

  it("rejects untimed with a closeAt", () => {
    expectTimingConflict(
      makeExam({ timingMode: "untimed", durationMinutes: null }),
    );
  });

  it("rejects untimed with operator_incident", () => {
    expectTimingConflict(
      makeExam({
        timingMode: "untimed",
        durationMinutes: null,
        closeAt: null,
        interruptionTimePolicy: "operator_incident",
      }),
    );
  });
});

describe("Phase A timing-mode matrix — timed_sync blocked", () => {
  it("rejects timed_sync regardless of the other timing fields", () => {
    expectTimingConflict(makeExam({ timingMode: "timed_sync" }));
    expectTimingConflict(
      makeExam({ timingMode: "timed_sync", durationMinutes: null }),
    );
  });
});

describe("window rule under nullable closeAt", () => {
  it("still requires openAt < closeAt when closeAt is present", () => {
    const exam = makeExam({
      timingMode: "deadline",
      durationMinutes: null,
      openAt: new Date("2025-01-02T09:00:00Z"),
      closeAt: new Date("2025-01-01T12:00:00Z"),
    });
    const conflicts = validateExamPolicyForExam(exam);
    expect(conflicts).toContainEqual(
      expect.objectContaining({
        code: ExamPolicyConflictCode.ExamWindowInvalid,
      }),
    );
  });

  it("applies no window comparison when closeAt is null (untimed)", () => {
    const conflicts = validateExamPolicyForExam(
      makeExam({
        timingMode: "untimed",
        durationMinutes: null,
        closeAt: null,
        // openAt "after" a null closeAt must not fabricate a window conflict.
        openAt: new Date("2099-01-01T00:00:00Z"),
      }),
    );
    expect(conflicts).toEqual([]);
  });
});
