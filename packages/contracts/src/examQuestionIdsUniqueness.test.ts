// #1039 (R-T2-1): duplicate questionIds must be rejected at the request-shape
// boundary. The frozen question snapshot derives one grading-workset entry per
// questionIds element keyed by (attemptId, questionId); a duplicated id would
// freeze a duplicated snapshot item and collide with the
// attempt_grading_entries UNIQUE constraint at submit time.

import { describe, expect, it } from "vitest";
import {
  CreateExamRequestBaseSchema,
  CreateExamRequestSchema,
  UpdateExamRequestBaseSchema,
} from "./exam.js";

const Q1 = "00000000-0000-4000-8000-000000000001";
const Q2 = "00000000-0000-4000-8000-000000000002";

const createBase = {
  title: "T",
  courseId: "00000000-0000-4000-8000-000000000010",
  openAt: "2026-01-01T00:00:00.000Z",
  closeAt: "2026-01-02T00:00:00.000Z",
  passingScore: 60,
  totalScore: 100,
};

describe("questionIds uniqueness — CreateExamRequestBaseSchema (#1039)", () => {
  it("rejects a duplicate id in the raw authoring shape", () => {
    const result = CreateExamRequestBaseSchema.safeParse({
      ...createBase,
      durationMinutes: 60,
      questionIds: [Q1, Q1],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === "questionIds"),
      ).toBe(true);
    }
  });

  it("accepts distinct ids in the raw authoring shape", () => {
    const result = CreateExamRequestBaseSchema.safeParse({
      ...createBase,
      durationMinutes: 60,
      questionIds: [Q1, Q2],
    });
    expect(result.success).toBe(true);
  });
});

describe("questionIds uniqueness — CreateExamRequestSchema (#1039)", () => {
  it("rejects a duplicate id in the canonical create schema", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...createBase,
      durationMinutes: 60,
      questionIds: [Q1, Q1],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === "questionIds"),
      ).toBe(true);
    }
  });

  it("still defaults questionIds to [] when omitted", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...createBase,
      durationMinutes: 60,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.questionIds).toEqual([]);
    }
  });

  it("accepts distinct ids in the canonical create schema", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...createBase,
      durationMinutes: 60,
      questionIds: [Q1, Q2],
    });
    expect(result.success).toBe(true);
  });
});

describe("questionIds uniqueness — UpdateExamRequestBaseSchema (#1039)", () => {
  it("rejects a duplicate id on update", () => {
    const result = UpdateExamRequestBaseSchema.safeParse({
      questionIds: [Q1, Q1],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === "questionIds"),
      ).toBe(true);
    }
  });

  it("accepts distinct ids on update", () => {
    const result = UpdateExamRequestBaseSchema.safeParse({
      questionIds: [Q1, Q2],
    });
    expect(result.success).toBe(true);
  });
});
