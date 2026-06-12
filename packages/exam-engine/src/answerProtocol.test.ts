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

    it("allows save when now equals deadline exactly", () => {
      const deadline = new Date("2025-01-01T10:00:00Z");
      const state = makeState({
        attemptStatus: "in_progress",
        deadlineAt: deadline,
        now: deadline,
      });
      const request = makeRequest({ baseVersion: 0 });

      const result = processSaveAnswer(state, request);

      expect(result.accepted).toBe(true);
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
  });
});
