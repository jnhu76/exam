import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AttemptResultResponseSchema,
  CandidateAttemptResultResponseSchema,
  type AttemptResultResponse,
  type CandidateAttemptResultResponse,
} from "../score.js";

/**
 * EXSEM-017 / ADR-021 for the attempt-result surfaces: the candidate result
 * contract must be structurally UNABLE to represent the frozen reference
 * answer (`standardAnswer`), while the authorized all-view contract keeps it
 * representable (admin/teacher surfaces legitimately need it).
 *
 * Two layers are pinned (same convention as candidateSecretBoundary.test.ts):
 *  1. the inferred contract TYPE has no such property (unrepresentable);
 *  2. parsing strips the keys from any payload, so even mapper drift cannot
 *     carry a secret through the candidate response contract.
 */

const VISIBLE_BASE = {
  attemptId: "0d0f8a11-9c92-4c73-8b1e-6f2a9d4c7b31",
  status: "graded",
  showResultImmediately: true,
  examTitle: "Demo exam",
  passingScore: 60,
  totalScore: 90,
  passed: true,
  gradedAt: "2026-01-01T00:00:00.000Z",
} as const;

const SECRET_STANDARD_ANSWER = "SECRET-standard-answer-marker";

/** Full per-question result payload as the admin all-view surface emits it. */
const fullQuestion = {
  questionId: "4b9f58a7-6c87-4d52-9a6b-1f3a2c8d9e01",
  score: 10,
  maxScore: 10,
  correct: true,
  candidateAnswer: "a",
  standardAnswer: SECRET_STANDARD_ANSWER,
  manualGraded: false,
  type: "single_choice",
  content: "Question text",
  contentDocument: null,
  answerMode: null,
  order: 0,
} as const;

const fullVisible = {
  ...VISIBLE_BASE,
  questionResults: [fullQuestion],
};

const HIDDEN_BASE = {
  attemptId: "0d0f8a11-9c92-4c73-8b1e-6f2a9d4c7b31",
  status: "in_progress",
  showResultImmediately: false,
  examTitle: "Demo exam",
} as const;

describe("candidate attempt-result contract excludes standardAnswer (EXSEM-017)", () => {
  it("accepts the full visible payload on the ADMIN contract, keeping the secret", () => {
    // Positive control: the authorized all-view representation stays intact —
    // the fix is a contract SPLIT, not a global field deletion.
    const parsed = AttemptResultResponseSchema.safeParse(fullVisible);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.showResultImmediately === true) {
      expect(parsed.data.questionResults[0]).toHaveProperty(
        "standardAnswer",
        SECRET_STANDARD_ANSWER,
      );
    }
  });

  it("candidate contract strips standardAnswer from a payload that carries it", () => {
    // Even if upstream projection drift re-adds the secret, the candidate
    // parse cannot emit it (SAFE_CONTRACT_AND_MINIMAL_PROJECTION).
    const parsed = CandidateAttemptResultResponseSchema.safeParse(fullVisible);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.showResultImmediately === true) {
      expect(parsed.data.questionResults[0]).not.toHaveProperty(
        "standardAnswer",
      );
      expect(JSON.stringify(parsed.data)).not.toContain(SECRET_STANDARD_ANSWER);
    }
  });

  it("candidate contract accepts a clean visible payload (positive control)", () => {
    const { standardAnswer: _omitted, ...candidateQuestion } = fullQuestion;
    const parsed = CandidateAttemptResultResponseSchema.safeParse({
      ...VISIBLE_BASE,
      questionResults: [candidateQuestion],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.showResultImmediately === true) {
      expect(parsed.data.questionResults[0]).not.toHaveProperty(
        "standardAnswer",
      );
    }
  });

  it("hidden variant parses on both contracts without score fields", () => {
    for (const schema of [
      CandidateAttemptResultResponseSchema,
      AttemptResultResponseSchema,
    ]) {
      const parsed = schema.safeParse(HIDDEN_BASE);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect("questionResults" in parsed.data).toBe(false);
      }
    }
  });

  describe("contract types are secret-free (unrepresentable)", () => {
    it("candidate visible result has no standardAnswer on question results", () => {
      type CandidateVisible = Extract<
        CandidateAttemptResultResponse,
        { showResultImmediately: true }
      >;
      expectTypeOf<
        CandidateVisible["questionResults"][number]
      >().not.toHaveProperty("standardAnswer");
    });

    it("admin visible result still carries standardAnswer (authorized surface)", () => {
      type FullVisible = Extract<
        AttemptResultResponse,
        { showResultImmediately: true }
      >;
      expectTypeOf<FullVisible["questionResults"][number]>().toHaveProperty(
        "standardAnswer",
      );
    });
  });
});
