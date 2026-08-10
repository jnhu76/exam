// P7-M1 canonical exam-policy validator — focused unit tests.
// Covers: valid baselines, each supported cross-field conflict, boundary
// values, determinism, non-mutation of input, and the assertExamPolicyValid
// throw contract. Authority: docs/audits/P7-M1-EXAM-POLICY-AUTHORITY-AND-VALIDATION.md §9.

import { describe, expect, it } from "vitest";
import type { Exam } from "@exam/domain";
import { ExamPolicyConflictCode, ValidationError } from "@exam/domain";
import { makeExam } from "./attemptMutation.testHelpers.js";
import {
  assertExamPolicyInputValid,
  assertExamPolicyValid,
  resolveExamPolicy,
  validateExamPolicy,
  validateExamPolicyInput,
  validateExamPolicyForExam,
} from "./examPolicy.js";

const CONFLICT = ExamPolicyConflictCode;

describe("resolveExamPolicy", () => {
  it("projects all policy groups from the exam row", () => {
    const exam = makeExam();
    const policy = resolveExamPolicy(exam);
    expect(policy.timing.timingMode).toBe("timed_window");
    expect(policy.timing.durationMinutes).toBe(60);
    expect(policy.attempt.retakePolicy).toBe("unlimited");
    expect(policy.grading.passingScore).toBe(60);
    expect(policy.results.resultPublicationMode).toBe("immediate");
    expect(policy.interruption.interruptionTimePolicy).toBe("strict");
    expect(policy.interruption.interruptionGracePerIncidentSeconds).toBeNull();
  });

  it("defaults optional interruption fields to strict/null (undefined on Exam)", () => {
    // exactOptionalPropertyTypes forbids passing `undefined` explicitly, so
    // build an exam that omits the optional interruption fields entirely.
    const {
      interruptionTimePolicy,
      interruptionGracePerIncidentSeconds,
      interruptionGracePerAttemptSeconds,
      ...examWithoutInterruption
    } = makeExam();
    void interruptionTimePolicy;
    void interruptionGracePerIncidentSeconds;
    void interruptionGracePerAttemptSeconds;
    const policy = resolveExamPolicy(examWithoutInterruption);
    expect(policy.interruption.interruptionTimePolicy).toBe("strict");
    expect(policy.interruption.interruptionGracePerIncidentSeconds).toBeNull();
    expect(policy.interruption.interruptionGracePerAttemptSeconds).toBeNull();
  });
});

describe("validateExamPolicy — valid baselines", () => {
  it("accepts a default makeExam policy", () => {
    expect(validateExamPolicyForExam(makeExam())).toEqual([]);
  });

  it("accepts bounded_grace with valid ordered caps", () => {
    expect(
      validateExamPolicyForExam(
        makeExam({
          interruptionTimePolicy: "bounded_grace",
          interruptionGracePerIncidentSeconds: 120,
          interruptionGracePerAttemptSeconds: 300,
        }),
      ),
    ).toEqual([]);
  });

  it("accepts operator_incident with null caps", () => {
    expect(
      validateExamPolicyForExam(
        makeExam({
          interruptionTimePolicy: "operator_incident",
          interruptionGracePerIncidentSeconds: null,
          interruptionGracePerAttemptSeconds: null,
        }),
      ),
    ).toEqual([]);
  });

  it("accepts max_attempts with maxAttempts >= 1", () => {
    expect(
      validateExamPolicyForExam(
        makeExam({ retakePolicy: "max_attempts", maxAttempts: 2 }),
      ),
    ).toEqual([]);
  });
});

describe("validateExamPolicy — supported conflicts", () => {
  it("flags openAt >= closeAt as EXAM_WINDOW_INVALID", () => {
    const same = new Date("2025-01-01T10:00:00Z");
    const conflicts = validateExamPolicyForExam(
      makeExam({ openAt: same, closeAt: same }),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.code).toBe(CONFLICT.ExamWindowInvalid);
    expect(conflicts[0]?.fields).toEqual(["openAt", "closeAt"]);
  });

  it("flags inverted window (openAt after closeAt)", () => {
    const conflicts = validateExamPolicyForExam(
      makeExam({
        openAt: new Date("2025-01-02T00:00:00Z"),
        closeAt: new Date("2025-01-01T00:00:00Z"),
      }),
    );
    expect(conflicts[0]?.code).toBe(CONFLICT.ExamWindowInvalid);
  });

  it("flags passingScore > totalScore as PASSING_SCORE_EXCEEDS_TOTAL", () => {
    const conflicts = validateExamPolicyForExam(
      makeExam({ passingScore: 150, totalScore: 100 }),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.code).toBe(CONFLICT.PassingScoreExceedsTotal);
    expect(conflicts[0]?.fields).toEqual(["passingScore", "totalScore"]);
  });

  it("accepts passingScore === totalScore (boundary)", () => {
    expect(
      validateExamPolicyForExam(
        makeExam({ passingScore: 100, totalScore: 100 }),
      ),
    ).toEqual([]);
  });

  it("flags max_attempts with maxAttempts < 1 as RETAKE_MAX_ATTEMPTS_INVALID", () => {
    const conflicts = validateExamPolicyForExam(
      makeExam({ retakePolicy: "max_attempts", maxAttempts: 0 }),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.code).toBe(CONFLICT.RetakeMaxAttemptsInvalid);
  });

  it("flags strict with a non-null cap as INVALID_INTERRUPTION_POLICY", () => {
    const conflicts = validateExamPolicyForExam(
      makeExam({
        interruptionTimePolicy: "strict",
        interruptionGracePerIncidentSeconds: 120,
        interruptionGracePerAttemptSeconds: null,
      }),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.code).toBe(CONFLICT.InterruptionPolicyCapsInvalid);
  });

  it("flags bounded_grace with a missing cap", () => {
    const conflicts = validateExamPolicyForExam(
      makeExam({
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 120,
        interruptionGracePerAttemptSeconds: null,
      }),
    );
    expect(conflicts[0]?.code).toBe(CONFLICT.InterruptionPolicyCapsInvalid);
  });

  it("flags bounded_grace with per-incident > per-attempt", () => {
    const conflicts = validateExamPolicyForExam(
      makeExam({
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 400,
        interruptionGracePerAttemptSeconds: 300,
      }),
    );
    expect(conflicts[0]?.code).toBe(CONFLICT.InterruptionPolicyCapsInvalid);
    expect(conflicts[0]?.fields).toEqual([
      "interruptionGracePerIncidentSeconds",
    ]);
  });

  it("flags bounded_grace with non-positive cap", () => {
    const conflicts = validateExamPolicyForExam(
      makeExam({
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 0,
        interruptionGracePerAttemptSeconds: 300,
      }),
    );
    expect(conflicts[0]?.code).toBe(CONFLICT.InterruptionPolicyCapsInvalid);
  });

  it("can return MULTIPLE independent conflicts at once", () => {
    const same = new Date("2025-01-01T10:00:00Z");
    const conflicts = validateExamPolicyForExam(
      makeExam({
        openAt: same,
        closeAt: same,
        passingScore: 150,
        totalScore: 100,
      }),
    );
    expect(conflicts.map((c) => c.code).sort()).toEqual([
      CONFLICT.ExamWindowInvalid,
      CONFLICT.PassingScoreExceedsTotal,
    ]);
  });
});

describe("validateExamPolicy — purity / determinism / non-mutation", () => {
  it("is deterministic (same input → same output)", () => {
    const exam = makeExam({
      interruptionTimePolicy: "bounded_grace",
      interruptionGracePerIncidentSeconds: 120,
      interruptionGracePerAttemptSeconds: 100,
    });
    const a = validateExamPolicyForExam(exam);
    const b = validateExamPolicyForExam(exam);
    expect(a).toEqual(b);
  });

  it("does not mutate the input policy", () => {
    const policy = resolveExamPolicy(makeExam());
    const snapshot = JSON.parse(JSON.stringify(policy)) as unknown;
    validateExamPolicy(policy);
    expect(JSON.parse(JSON.stringify(policy)) as unknown).toEqual(snapshot);
  });
});

describe("assertExamPolicyValid", () => {
  it("throws ValidationError with structured fields on conflict", () => {
    const exam = makeExam({ passingScore: 150, totalScore: 100 });
    try {
      assertExamPolicyValid(exam);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const details = (err as ValidationError).details as {
        fields: { field: string; code: string; message: string }[];
      };
      expect(details.fields[0]?.code).toBe(CONFLICT.PassingScoreExceedsTotal);
      expect(details.fields[0]?.field).toBe("passingScore");
    }
  });

  it("is a no-op when valid", () => {
    expect(() => assertExamPolicyValid(makeExam())).not.toThrow();
  });
});

describe("validateExamPolicyInput (route-layer merged input)", () => {
  it("matches validateExamPolicyForExam for the same logical policy", () => {
    const exam = makeExam({
      interruptionTimePolicy: "bounded_grace",
      interruptionGracePerIncidentSeconds: 120,
      interruptionGracePerAttemptSeconds: 300,
    });
    const viaExam = validateExamPolicyForExam(exam);
    const viaInput = validateExamPolicyInput({
      timingMode: exam.timingMode,
      durationMinutes: exam.durationMinutes,
      openAt: exam.openAt,
      closeAt: exam.closeAt,
      latestStartOffsetMinutes: exam.latestStartOffsetMinutes,
      minSubmitAfterStartMinutes: exam.minSubmitAfterStartMinutes,
      questionSelectionMode: exam.questionSelectionMode,
      retakePolicy: exam.retakePolicy,
      maxAttempts: exam.maxAttempts,
      scoreStrategy: exam.scoreStrategy,
      passingScore: exam.passingScore,
      totalScore: exam.totalScore,
      resultPublicationMode: exam.resultPublicationMode,
      interruptionTimePolicy: "bounded_grace",
      interruptionGracePerIncidentSeconds: 120,
      interruptionGracePerAttemptSeconds: 300,
    });
    expect(viaInput).toEqual(viaExam);
  });

  it("assertExamPolicyInputValid rejects inverted window", () => {
    expect(() =>
      assertExamPolicyInputValid({
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date("2025-01-02T00:00:00Z"),
        closeAt: new Date("2025-01-01T00:00:00Z"),
        latestStartOffsetMinutes: null,
        minSubmitAfterStartMinutes: null,
        questionSelectionMode: "manual",
        retakePolicy: "unlimited",
        maxAttempts: 1,
        scoreStrategy: "highest",
        passingScore: 60,
        totalScore: 100,
        resultPublicationMode: "immediate",
        interruptionTimePolicy: "strict",
        interruptionGracePerIncidentSeconds: null,
        interruptionGracePerAttemptSeconds: null,
      }),
    ).toThrow(ValidationError);
  });
});

// Compile-time sanity: an Exam with a valid baseline is the type the validator
// expects (guards against accidental widening).
const _typeCheck: Exam = makeExam();
void _typeCheck;
