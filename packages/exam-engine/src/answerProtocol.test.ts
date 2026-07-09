import { describe, expect, it } from "vitest";
import { processSaveAnswer, type AnswerState } from "./answerProtocol.js";
import type {
  AnswerRecord,
  SaveAnswerRequest,
  AttemptStatus,
} from "@exam/domain";

function makeAnswerRecord(overrides: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    questionId: "q1",
    answer: "a",
    version: 1,
    savedAt: new Date("2025-01-01T10:00:00Z"),
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<SaveAnswerRequest> = {},
): SaveAnswerRequest {
  return {
    attemptId: "attempt-1",
    questionId: "q1",
    answer: "b",
    clientSeq: 2,
    clientSavedAt: "2025-01-01T10:01:00Z",
    baseVersion: 1,
    ...overrides,
  };
}

function makeState(overrides: Partial<AnswerState> = {}): AnswerState {
  return {
    attemptStatus: "in_progress" as AttemptStatus,
    answers: [],
    clientSeqMap: new Map(),
    ...overrides,
  };
}

describe("answerProtocol", () => {
  describe("processSaveAnswer", () => {
    it("accepts new answer when no existing answer for question", () => {
      const state = makeState({ attemptStatus: "in_progress" });
      const request = makeRequest({ baseVersion: 0 });

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(true);
      expect(result.serverVersion).toBe(1);
      expect(result.conflict).toBeUndefined();
    });

    it("accepts answer when baseVersion matches current version", () => {
      const existing = makeAnswerRecord({ version: 1 });
      const state = makeState({
        answers: [existing],
        clientSeqMap: new Map([["q1:1", existing]]),
      });
      const request = makeRequest({ baseVersion: 1 });

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(true);
      expect(result.serverVersion).toBe(2);
    });

    it("rejects save with STALE_VERSION when baseVersion is behind", () => {
      const existing = makeAnswerRecord({ version: 3 });
      const state = makeState({
        answers: [existing],
        clientSeqMap: new Map([["q1:2", existing]]),
      });
      const request = makeRequest({ clientSeq: 3, baseVersion: 1 });

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(false);
      expect(result.conflict?.reason).toBe("STALE_VERSION");
      expect(result.conflict?.latestAnswer).toBe("a");
    });

    it("returns idempotent result for same clientSeq replay", () => {
      const existing = makeAnswerRecord({
        answer: "b",
        version: 2,
        savedAt: new Date("2025-01-01T10:01:00Z"),
      });
      const state = makeState({
        answers: [existing],
        clientSeqMap: new Map([["q1:2", existing]]),
      });
      const request = makeRequest({ clientSeq: 2, baseVersion: 1 });

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(true);
      expect(result.serverVersion).toBe(2);
      expect(result.savedAt).toBe("2025-01-01T10:01:00.000Z");
    });

    it("rejects save when attempt is submitted", () => {
      const state = makeState({ attemptStatus: "submitted" });
      const request = makeRequest();

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(false);
      expect(result.conflict?.reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
    });

    it("rejects save when attempt is graded", () => {
      const state = makeState({ attemptStatus: "graded" });
      const request = makeRequest();

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(false);
      expect(result.conflict?.reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
    });

    it("rejects save when attempt is voided", () => {
      const state = makeState({ attemptStatus: "voided" });
      const request = makeRequest();

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(false);
      expect(result.conflict?.reason).toBe("ATTEMPT_CLOSED");
    });

    it("rejects save when deadline is exceeded", () => {
      const state = makeState({
        attemptStatus: "in_progress",
        deadlineAt: new Date("2025-01-01T10:00:00Z"),
        now: new Date("2025-01-01T10:00:01Z"),
      });
      const request = makeRequest();

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(false);
      expect(result.conflict?.reason).toBe("DEADLINE_EXCEEDED");
    });

    it("rejects save when now equals deadline exactly (canonical >= boundary)", () => {
      // EXAM-ANSWER-PRECONDITION-CORRECTIVE-0 §11 — the canonical expiry
      // predicate is `now >= effectiveDeadline`, aligned with
      // `isAttemptDeadlineExpired`. Equality at the deadline is expired.
      const deadline = new Date("2025-01-01T10:00:00Z");
      const state = makeState({
        attemptStatus: "in_progress",
        deadlineAt: deadline,
        now: deadline,
      });
      const request = makeRequest({ baseVersion: 0 });

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(false);
      expect(result.conflict?.reason).toBe("DEADLINE_EXCEEDED");
    });

    it("allows save when deadline guards are not provided", () => {
      const state = makeState({ attemptStatus: "in_progress" });
      const request = makeRequest({ baseVersion: 0 });

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(true);
    });

    it("stores new answer record on accepted result", () => {
      const state = makeState();
      const request = makeRequest({ baseVersion: 0 });

      const result = processSaveAnswer(state, request);

      expect(result.newAnswer).toBeDefined();
      expect(result.newAnswer?.questionId).toBe("q1");
      expect(result.newAnswer?.answer).toBe("b");
      expect(result.newAnswer?.version).toBe(1);
    });

    it("updates clientSeqMap on accepted result", () => {
      const state = makeState();
      const request = makeRequest({ baseVersion: 0 });

      const result = processSaveAnswer(state, request);

      expect(result.newClientSeqMap).toBeDefined();
      expect(result.newClientSeqMap?.get("q1:2")).toBeDefined();
      expect(result.newClientSeqMap?.get("q1:2")?.answer).toBe("b");
    });

    it("rejects same clientSeq with different answer as CONFLICTING_PAYLOAD", () => {
      // Existing saved answer for q1 at clientSeq=2 has answer="b".
      const existing = makeAnswerRecord({
        answer: "b",
        version: 2,
        savedAt: new Date("2025-01-01T10:01:00Z"),
      });
      const state = makeState({
        answers: [existing],
        clientSeqMap: new Map([["q1:2", existing]]),
      });
      // Request reuses clientSeq=2 but sends a DIFFERENT answer.
      const request = makeRequest({
        clientSeq: 2,
        answer: "c",
        baseVersion: 1,
      });

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(false);
      expect(result.conflict?.reason).toBe("CONFLICTING_PAYLOAD");
      expect(result.conflict?.latestAnswer).toBe("b");
      expect(result.serverVersion).toBe(2);
    });

    it("accepts identical array answer replay (structural equality)", () => {
      const existing = makeAnswerRecord({
        answer: ["a", "b", "c"],
        version: 2,
        savedAt: new Date("2025-01-01T10:01:00Z"),
      });
      const state = makeState({
        answers: [existing],
        clientSeqMap: new Map([["q1:2", existing]]),
      });
      const request = makeRequest({
        clientSeq: 2,
        answer: ["a", "b", "c"],
        baseVersion: 1,
      });

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(true);
      expect(result.serverVersion).toBe(2);
    });

    it("rejects different array answer as CONFLICTING_PAYLOAD", () => {
      const existing = makeAnswerRecord({
        answer: ["a", "b", "c"],
        version: 2,
        savedAt: new Date("2025-01-01T10:01:00Z"),
      });
      const state = makeState({
        answers: [existing],
        clientSeqMap: new Map([["q1:2", existing]]),
      });
      const request = makeRequest({
        clientSeq: 2,
        answer: ["a", "b", "d"],
        baseVersion: 1,
      });

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(false);
      expect(result.conflict?.reason).toBe("CONFLICTING_PAYLOAD");
      expect(result.serverVersion).toBe(2);
    });

    it("accepts identical object answer replay (structural equality)", () => {
      const objAnswer = { optionId: "opt1", value: "custom" };
      const existing = makeAnswerRecord({
        answer: objAnswer,
        version: 2,
        savedAt: new Date("2025-01-01T10:01:00Z"),
      });
      const state = makeState({
        answers: [existing],
        clientSeqMap: new Map([["q1:2", existing]]),
      });
      const request = makeRequest({
        clientSeq: 2,
        answer: { optionId: "opt1", value: "custom" },
        baseVersion: 1,
      });

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(true);
      expect(result.serverVersion).toBe(2);
    });

    it("rejects different object answer as CONFLICTING_PAYLOAD", () => {
      const existing = makeAnswerRecord({
        answer: { optionId: "opt1", value: "old" },
        version: 2,
        savedAt: new Date("2025-01-01T10:01:00Z"),
      });
      const state = makeState({
        answers: [existing],
        clientSeqMap: new Map([["q1:2", existing]]),
      });
      const request = makeRequest({
        clientSeq: 2,
        answer: { optionId: "opt1", value: "new" },
        baseVersion: 1,
      });

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(false);
      expect(result.conflict?.reason).toBe("CONFLICTING_PAYLOAD");
      expect(result.serverVersion).toBe(2);
    });
  });

  describe("buildSubmittedAnswersSnapshot (P3-L0-2)", () => {
    it("normalizes draft AnswerRecords into a clean SubmittedAnswersSnapshot", async () => {
      const { buildSubmittedAnswersSnapshot } =
        await import("./answerProtocol.js");
      const snapshot = [
        {
          originalQuestionId: "q1",
          type: "single_choice" as const,
          content: "Q1",
          attachments: [],
          options: [],
          standardAnswer: "a",
          score: 10,
          gradingRule: {
            multiSelectScoring: "all_correct_full" as const,
            fillBlankMatchMode: "exact" as const,
          },
          order: 0,
          rubric: null,
        },
      ];
      const draft = [
        makeAnswerRecord({
          questionId: "q1",
          answer: "a",
          version: 3,
          savedAt: new Date("2025-01-01T10:00:00Z"),
        }),
      ];

      const result = buildSubmittedAnswersSnapshot(draft, snapshot);

      expect(result.schemaVersion).toBe(1);
      expect(result.answers).toEqual([{ questionId: "q1", value: "a" }]);
    });

    it("strips protocol metadata (no version/savedAt/clientSeq/baseVersion)", async () => {
      const { buildSubmittedAnswersSnapshot } =
        await import("./answerProtocol.js");
      const snapshot = [
        {
          originalQuestionId: "q1",
          type: "true_false" as const,
          content: "Q1",
          attachments: [],
          options: [],
          standardAnswer: true,
          score: 5,
          gradingRule: {
            multiSelectScoring: "all_correct_full" as const,
            fillBlankMatchMode: "exact" as const,
          },
          order: 0,
          rubric: null,
        },
      ];
      const draft = [
        makeAnswerRecord({
          questionId: "q1",
          answer: true,
          version: 7,
          savedAt: new Date("2025-06-01T12:00:00Z"),
        }),
      ];

      const result = buildSubmittedAnswersSnapshot(draft, snapshot);
      const entry = result.answers[0];

      expect(entry).toBeDefined();
      expect(entry).not.toHaveProperty("version");
      expect(entry).not.toHaveProperty("savedAt");
      expect(entry).not.toHaveProperty("clientSeq");
      expect(entry).not.toHaveProperty("baseVersion");
      expect(Object.keys(entry ?? {}).sort()).toEqual(
        ["questionId", "value"].sort(),
      );
    });

    it("includes all snapshot questions, even unanswered ones (value: null)", async () => {
      const { buildSubmittedAnswersSnapshot } =
        await import("./answerProtocol.js");
      const snapshot = [
        {
          originalQuestionId: "q1",
          type: "single_choice" as const,
          content: "Q1",
          attachments: [],
          options: [],
          standardAnswer: "a",
          score: 10,
          gradingRule: {
            multiSelectScoring: "all_correct_full" as const,
            fillBlankMatchMode: "exact" as const,
          },
          order: 0,
          rubric: null,
        },
        {
          originalQuestionId: "q2",
          type: "true_false" as const,
          content: "Q2",
          attachments: [],
          options: [],
          standardAnswer: true,
          score: 5,
          gradingRule: {
            multiSelectScoring: "all_correct_full" as const,
            fillBlankMatchMode: "exact" as const,
          },
          order: 1,
          rubric: null,
        },
      ];
      // Only q1 was answered; q2 left blank.
      const draft = [makeAnswerRecord({ questionId: "q1", answer: "a" })];

      const result = buildSubmittedAnswersSnapshot(draft, snapshot);

      expect(result.answers).toEqual([
        { questionId: "q1", value: "a" },
        { questionId: "q2", value: null },
      ]);
    });

    it("orders output by question snapshot order, not answer record order", async () => {
      const { buildSubmittedAnswersSnapshot } =
        await import("./answerProtocol.js");
      const snapshot = [
        {
          originalQuestionId: "q-first",
          type: "single_choice" as const,
          content: "A",
          attachments: [],
          options: [],
          standardAnswer: "a",
          score: 10,
          gradingRule: {
            multiSelectScoring: "all_correct_full" as const,
            fillBlankMatchMode: "exact" as const,
          },
          order: 0,
          rubric: null,
        },
        {
          originalQuestionId: "q-second",
          type: "single_choice" as const,
          content: "B",
          attachments: [],
          options: [],
          standardAnswer: "b",
          score: 10,
          gradingRule: {
            multiSelectScoring: "all_correct_full" as const,
            fillBlankMatchMode: "exact" as const,
          },
          order: 1,
          rubric: null,
        },
      ];
      // Draft answers arrive in reverse order.
      const draft = [
        makeAnswerRecord({ questionId: "q-second", answer: "b" }),
        makeAnswerRecord({ questionId: "q-first", answer: "a" }),
      ];

      const result = buildSubmittedAnswersSnapshot(draft, snapshot);

      expect(result.answers.map((a) => a.questionId)).toEqual([
        "q-first",
        "q-second",
      ]);
    });
  });
});
