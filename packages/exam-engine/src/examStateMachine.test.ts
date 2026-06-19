import { describe, it, expect } from "vitest";
import { ExamStatus } from "@exam/domain";
import {
  canTransition,
  assertTransition,
  EXAM_VALID_TRANSITIONS,
} from "./examStateMachine.js";
import { InvalidStateTransitionError } from "@exam/domain";

describe("examStateMachine", () => {
  describe("canTransition — Phase 1 真实转移表", () => {
    it("draft → published 允许", () => {
      expect(canTransition(ExamStatus.Draft, ExamStatus.Published)).toBe(true);
    });

    it("draft → archived 不允许（Phase 1：必须先 published）", () => {
      expect(canTransition(ExamStatus.Draft, ExamStatus.Archived)).toBe(false);
    });

    it("draft → open 不允许（不可跳过 published）", () => {
      expect(canTransition(ExamStatus.Draft, ExamStatus.Open)).toBe(false);
    });

    it("published → open 允许", () => {
      expect(canTransition(ExamStatus.Published, ExamStatus.Open)).toBe(true);
    });

    it("published → archived 允许", () => {
      expect(canTransition(ExamStatus.Published, ExamStatus.Archived)).toBe(
        true,
      );
    });

    it("published → draft 允许（ADR-005 Slice 2: unpublish）", () => {
      expect(canTransition(ExamStatus.Published, ExamStatus.Draft)).toBe(true);
    });

    it("published → canceled 允许", () => {
      expect(canTransition(ExamStatus.Published, ExamStatus.Canceled)).toBe(
        true,
      );
    });

    it("open → canceled 允许", () => {
      expect(canTransition(ExamStatus.Open, ExamStatus.Canceled)).toBe(true);
    });

    it("canceled → archived 允许", () => {
      expect(canTransition(ExamStatus.Canceled, ExamStatus.Archived)).toBe(
        true,
      );
    });

    it("open → closed 允许", () => {
      expect(canTransition(ExamStatus.Open, ExamStatus.Closed)).toBe(true);
    });

    it("open → archived 不允许（必须先 closed）", () => {
      expect(canTransition(ExamStatus.Open, ExamStatus.Archived)).toBe(false);
    });

    it("closed → archived 允许", () => {
      expect(canTransition(ExamStatus.Closed, ExamStatus.Archived)).toBe(true);
    });

    it("closed → open 不允许（不可重新开放）", () => {
      expect(canTransition(ExamStatus.Closed, ExamStatus.Open)).toBe(false);
    });

    it("archived 是终态", () => {
      expect(EXAM_VALID_TRANSITIONS[ExamStatus.Archived]).toHaveLength(0);
    });
  });

  describe("assertTransition", () => {
    it("合法转移不抛异常", () => {
      expect(() =>
        assertTransition(ExamStatus.Draft, ExamStatus.Published),
      ).not.toThrow();
    });

    it("非法转移抛 InvalidStateTransitionError", () => {
      expect(() => assertTransition(ExamStatus.Draft, ExamStatus.Open)).toThrow(
        InvalidStateTransitionError,
      );
    });
  });
});
