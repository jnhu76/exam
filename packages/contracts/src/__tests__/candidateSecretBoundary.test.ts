import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CandidateQuestionSnapshotSchema,
  LoadAttemptResponseSchema,
  RestoreAttemptResponseSchema,
  type LoadAttemptResponse,
  type RestoreAttemptResponse,
} from "../attempt.js";

/**
 * EXSEM-017 / ADR-021 D3a: server-managed candidate secrets (the misconduct
 * projection with flaggedBy/notes, the raw gradingRule) must be
 * UNREPRESENTABLE in candidate output contracts — a safe candidate-specific
 * contract, not merely a mapper that happens to omit the fields.
 *
 * Two layers are pinned:
 *  1. the inferred contract TYPE has no such property (unrepresentable);
 *  2. parsing strips the keys from any payload, so even mapper drift cannot
 *     carry a secret through the response contract.
 */

/** Minimal valid candidate question snapshot (no secret fields). */
const safeQuestion = {
  originalQuestionId: "4b9f58a7-6c87-4d52-9a6b-1f3a2c8d9e01",
  type: "single_choice",
  content: "Question text",
  contentDocument: null,
  answerMode: null,
  attachments: [],
  options: [{ id: "a", content: "Option A", contentDocument: null }],
  score: 10,
  order: 0,
} as const;

/** Minimal valid attempt envelope for LoadAttemptResponseSchema. */
const safeAttempt = {
  id: "0d0f8a11-9c92-4c73-8b1e-6f2a9d4c7b31",
  organizationId: "1a2b3c4d-0000-4000-8000-000000000001",
  examId: "1a2b3c4d-0000-4000-8000-000000000002",
  enrollmentId: "1a2b3c4d-0000-4000-8000-000000000003",
  candidateId: "1a2b3c4d-0000-4000-8000-000000000004",
  attemptNo: 1,
  status: "in_progress",
  questionSnapshot: [safeQuestion],
  answers: [],
  startedAt: "2026-01-01T00:00:00.000Z",
  deadlineAt: "2026-01-01T01:00:00.000Z",
  lastActivityAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  serverNow: "2026-01-01T00:00:00.000Z",
} as const;

const misconductSecret = {
  flaggedAt: "2026-01-01T00:10:00.000Z",
  flaggedBy: "admin",
  notes: "SECRET-misconduct-notes-marker",
  severity: "serious",
} as const;

const gradingRuleSecret = {
  multiSelectScoring: "all_correct_full",
  fillBlankMatchMode: "exact",
} as const;

describe("candidate attempt contracts structurally exclude secrets (EXSEM-017)", () => {
  it("accepts a safe candidate attempt payload (positive control)", () => {
    const parsed = LoadAttemptResponseSchema.safeParse(safeAttempt);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("misconduct" in parsed.data).toBe(false);
      for (const q of parsed.data.questionSnapshot) {
        expect("gradingRule" in q).toBe(false);
        expect("standardAnswer" in q).toBe(false);
        expect("rubric" in q).toBe(false);
      }
    }
  });

  it("strips a misconduct projection from the parse output", () => {
    const parsed = LoadAttemptResponseSchema.safeParse({
      ...safeAttempt,
      misconduct: misconductSecret,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("misconduct" in parsed.data).toBe(false);
      expect(parsed.data).not.toHaveProperty("misconduct");
    }
  });

  it("strips a gradingRule from the candidate question snapshot output", () => {
    const parsed = LoadAttemptResponseSchema.safeParse({
      ...safeAttempt,
      questionSnapshot: [{ ...safeQuestion, gradingRule: gradingRuleSecret }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.questionSnapshot[0]).not.toHaveProperty("gradingRule");
    }
  });

  it("strips standardAnswer and rubric from the candidate question snapshot output", () => {
    const parsed = LoadAttemptResponseSchema.safeParse({
      ...safeAttempt,
      questionSnapshot: [
        { ...safeQuestion, standardAnswer: "a", rubric: "SECRET-rubric" },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.questionSnapshot[0]).not.toHaveProperty(
        "standardAnswer",
      );
      expect(parsed.data.questionSnapshot[0]).not.toHaveProperty("rubric");
    }
  });

  it("CandidateQuestionSnapshotSchema strips gradingRule", () => {
    const parsed = CandidateQuestionSnapshotSchema.safeParse({
      ...safeQuestion,
      gradingRule: gradingRuleSecret,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("gradingRule");
    }
  });

  it("restore response parses with a safe payload and nests a secret-free attempt", () => {
    const parsed = RestoreAttemptResponseSchema.safeParse({
      lifecycle: "restored",
      compensation: { policy: "strict", addedSeconds: 0 },
      attempt: safeAttempt,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("misconduct" in parsed.data.attempt).toBe(false);
      for (const q of parsed.data.attempt.questionSnapshot) {
        expect("gradingRule" in q).toBe(false);
      }
    }
  });

  it("restore response strips a nested misconduct projection and gradingRule", () => {
    const parsed = RestoreAttemptResponseSchema.safeParse({
      lifecycle: "restored",
      compensation: { policy: "strict", addedSeconds: 0 },
      attempt: {
        ...safeAttempt,
        misconduct: misconductSecret,
        questionSnapshot: [{ ...safeQuestion, gradingRule: gradingRuleSecret }],
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.attempt).not.toHaveProperty("misconduct");
      expect(parsed.data.attempt.questionSnapshot[0]).not.toHaveProperty(
        "gradingRule",
      );
    }
  });

  describe("contract types are secret-free (unrepresentable)", () => {
    it("LoadAttemptResponse has no misconduct property", () => {
      expectTypeOf<LoadAttemptResponse>().not.toHaveProperty("misconduct");
    });

    it("candidate question snapshots have no gradingRule/standardAnswer/rubric", () => {
      expectTypeOf<
        LoadAttemptResponse["questionSnapshot"][number]
      >().not.toHaveProperty("gradingRule");
      expectTypeOf<
        LoadAttemptResponse["questionSnapshot"][number]
      >().not.toHaveProperty("standardAnswer");
      expectTypeOf<
        LoadAttemptResponse["questionSnapshot"][number]
      >().not.toHaveProperty("rubric");
    });

    it("restore attempt projection has no misconduct property", () => {
      expectTypeOf<RestoreAttemptResponse["attempt"]>().not.toHaveProperty(
        "misconduct",
      );
    });
  });
});
