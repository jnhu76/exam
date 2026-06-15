import { describe, it, expect } from "vitest";
import { EnrollmentStatus, InvalidStateTransitionError } from "@exam/domain";
import {
  canTransition,
  assertTransition,
  ENROLLMENT_VALID_TRANSITIONS,
} from "./enrollmentStateMachine.js";

describe("enrollmentStateMachine", () => {
  describe("canTransition — Phase 1 转移表", () => {
    it("assigned → started 允许", () => {
      expect(
        canTransition(EnrollmentStatus.Assigned, EnrollmentStatus.Started),
      ).toBe(true);
    });

    it("assigned → blocked 允许", () => {
      expect(
        canTransition(EnrollmentStatus.Assigned, EnrollmentStatus.Blocked),
      ).toBe(true);
    });

    it("assigned → completed 不允许（必须先 started）", () => {
      expect(
        canTransition(EnrollmentStatus.Assigned, EnrollmentStatus.Completed),
      ).toBe(false);
    });

    it("started → completed 允许", () => {
      expect(
        canTransition(EnrollmentStatus.Started, EnrollmentStatus.Completed),
      ).toBe(true);
    });

    it("started → blocked 允许", () => {
      expect(
        canTransition(EnrollmentStatus.Started, EnrollmentStatus.Blocked),
      ).toBe(true);
    });

    it("started → assigned 不允许（不可回退）", () => {
      expect(
        canTransition(EnrollmentStatus.Started, EnrollmentStatus.Assigned),
      ).toBe(false);
    });

    it("blocked → started 允许（管理员解锁）", () => {
      expect(
        canTransition(EnrollmentStatus.Blocked, EnrollmentStatus.Started),
      ).toBe(true);
    });

    it("blocked → completed 不允许（必须先 started）", () => {
      expect(
        canTransition(EnrollmentStatus.Blocked, EnrollmentStatus.Completed),
      ).toBe(false);
    });

    it("completed 是终态", () => {
      expect(
        ENROLLMENT_VALID_TRANSITIONS[EnrollmentStatus.Completed],
      ).toHaveLength(0);
    });
  });

  describe("assertTransition", () => {
    it("合法转移不抛异常", () => {
      expect(() =>
        assertTransition(EnrollmentStatus.Assigned, EnrollmentStatus.Started),
      ).not.toThrow();
    });

    it("非法转移抛 InvalidStateTransitionError", () => {
      expect(() =>
        assertTransition(EnrollmentStatus.Assigned, EnrollmentStatus.Completed),
      ).toThrow(InvalidStateTransitionError);
    });

    it("completed → 任何 状态都抛异常", () => {
      expect(() =>
        assertTransition(EnrollmentStatus.Completed, EnrollmentStatus.Started),
      ).toThrow(InvalidStateTransitionError);
    });
  });
});
