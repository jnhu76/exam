import { describe, expect, it } from "vitest";
import { ProctorExamListResponseSchema } from "./proctorMonitoring.js";

describe("ProctorExamListResponseSchema", () => {
  const valid = {
    items: [
      {
        examId: "00000000-0000-4000-8000-000000000001",
        title: "正式考试",
        status: "open",
        openAt: "2026-07-17T01:00:00.000Z",
        closeAt: "2026-07-17T03:00:00.000Z",
      },
    ],
    total: 1,
  };

  it("accepts only the minimal discovery projection", () => {
    expect(ProctorExamListResponseSchema.parse(valid)).toEqual(valid);
  });

  it.each(["draft", "canceled", "archived"])(
    "rejects unsupported %s exams",
    (status) => {
      expect(() =>
        ProctorExamListResponseSchema.parse({
          ...valid,
          items: [{ ...valid.items[0], status }],
        }),
      ).toThrow();
    },
  );

  it("rejects authoring and grading fields", () => {
    expect(() =>
      ProctorExamListResponseSchema.parse({
        ...valid,
        items: [
          {
            ...valid.items[0],
            questionSnapshot: [],
            standardAnswer: true,
            rubric: null,
            candidateAnswer: "secret",
            gradingResult: [],
          },
        ],
      }),
    ).toThrow();
  });
});
