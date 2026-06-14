import { describe, expect, it } from "vitest";
import {
  transition,
  isTransitionOk,
  type TransitionResult,
} from "./attemptStateMachine.js";

describe("attemptStateMachine", () => {
  describe("valid transitions", () => {
    it("in_progress → submitted via submit", () => {
      const result = transition("in_progress", "submit");
      expect(result).toEqual({ ok: true, next: "submitted" });
    });

    it("in_progress → disrupted via disrupt", () => {
      const result = transition("in_progress", "disrupt");
      expect(result).toEqual({ ok: true, next: "disrupted" });
    });

    it("disrupted → submitted via submit", () => {
      const result = transition("disrupted", "submit");
      expect(result).toEqual({ ok: true, next: "submitted" });
    });

    it("disrupted → in_progress via restore", () => {
      const result = transition("disrupted", "restore");
      expect(result).toEqual({ ok: true, next: "in_progress" });
    });

    it("submitted → grading via grade", () => {
      const result = transition("submitted", "grade");
      expect(result).toEqual({ ok: true, next: "grading" });
    });

    it("grading → graded via complete_grading", () => {
      const result = transition("grading", "complete_grading");
      expect(result).toEqual({ ok: true, next: "graded" });
    });
  });

  describe("invalid transitions", () => {
    it.each([
      ["not_started", "submit" as const],
      ["not_started", "disrupt" as const],
      ["not_started", "restore" as const],
      ["not_started", "grade" as const],
      ["queued", "submit" as const],
      ["queued", "disrupt" as const],
      ["queued", "restore" as const],
      ["submitted", "submit" as const],
      ["submitted", "disrupt" as const],
      ["submitted", "restore" as const],
      ["grading", "submit" as const],
      ["grading", "disrupt" as const],
      ["grading", "restore" as const],
      ["graded", "submit" as const],
      ["graded", "disrupt" as const],
      ["graded", "restore" as const],
      ["graded", "grade" as const],
      ["voided", "submit" as const],
      ["voided", "disrupt" as const],
      ["voided", "restore" as const],
      ["voided", "grade" as const],
    ] as const)(
      "rejects %s → %s with INVALID_SOURCE_STATUS",
      (status, command) => {
        const result = transition(status, command);
        expect(result).toEqual({ ok: false, reason: "INVALID_SOURCE_STATUS" });
      },
    );

    it("rejects in_progress → grade (cannot skip submit)", () => {
      const result = transition("in_progress", "grade");
      expect(result).toEqual({ ok: false, reason: "INVALID_SOURCE_STATUS" });
    });

    it("rejects disrupted → disrupt (already disrupted)", () => {
      const result = transition("disrupted", "disrupt");
      expect(result).toEqual({ ok: false, reason: "INVALID_SOURCE_STATUS" });
    });

    it("rejects in_progress → restore (not disrupted)", () => {
      const result = transition("in_progress", "restore");
      expect(result).toEqual({ ok: false, reason: "INVALID_SOURCE_STATUS" });
    });

    it("rejects in_progress → complete_grading (not grading)", () => {
      const result = transition("in_progress", "complete_grading");
      expect(result).toEqual({ ok: false, reason: "INVALID_SOURCE_STATUS" });
    });
  });

  describe("submit is not deadline-guarded", () => {
    it("allows in_progress → submit without deadline context", () => {
      const result = transition("in_progress", "submit");
      expect(result).toEqual({ ok: true, next: "submitted" });
    });

    it("allows disrupted → submit without deadline context", () => {
      const result = transition("disrupted", "submit");
      expect(result).toEqual({ ok: true, next: "submitted" });
    });

    it("allows disrupt command", () => {
      const result = transition("in_progress", "disrupt");
      expect(result).toEqual({ ok: true, next: "disrupted" });
    });
  });

  describe("isTransitionOk", () => {
    it("returns true for ok result", () => {
      const result: TransitionResult = { ok: true, next: "submitted" };
      expect(isTransitionOk(result)).toBe(true);
    });

    it("returns false for fail result", () => {
      const result: TransitionResult = {
        ok: false,
        reason: "INVALID_SOURCE_STATUS",
      };
      expect(isTransitionOk(result)).toBe(false);
    });
  });
});
