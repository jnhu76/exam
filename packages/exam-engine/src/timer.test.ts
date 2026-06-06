import { describe, expect, it } from "vitest";
import { calculateDeadlineAt, getRemainingSeconds } from "./timer.js";

describe("timer", () => {
  describe("calculateDeadlineAt", () => {
    it("calculates deadline as startedAt + durationMinutes", () => {
      const startedAt = new Date("2025-01-01T10:00:00Z");
      const durationMinutes = 60;
      const deadline = calculateDeadlineAt(startedAt, durationMinutes);
      expect(deadline).toEqual(new Date("2025-01-01T11:00:00Z"));
    });

    it("handles zero duration", () => {
      const startedAt = new Date("2025-01-01T10:00:00Z");
      const deadline = calculateDeadlineAt(startedAt, 0);
      expect(deadline).toEqual(startedAt);
    });

    it("handles fractional minutes", () => {
      const startedAt = new Date("2025-01-01T10:00:00Z");
      const deadline = calculateDeadlineAt(startedAt, 90);
      expect(deadline).toEqual(new Date("2025-01-01T11:30:00Z"));
    });
  });

  describe("getRemainingSeconds", () => {
    it("returns remaining seconds when deadline is in the future", () => {
      const now = new Date("2025-01-01T10:30:00Z");
      const deadline = new Date("2025-01-01T11:00:00Z");
      const remaining = getRemainingSeconds(deadline, now);
      expect(remaining).toBe(1800);
    });

    it("returns 0 when deadline has passed", () => {
      const now = new Date("2025-01-01T12:00:00Z");
      const deadline = new Date("2025-01-01T11:00:00Z");
      const remaining = getRemainingSeconds(deadline, now);
      expect(remaining).toBe(0);
    });

    it("returns 0 when deadline equals now", () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const deadline = new Date("2025-01-01T11:00:00Z");
      const remaining = getRemainingSeconds(deadline, now);
      expect(remaining).toBe(0);
    });

    it("returns full duration when deadline equals now plus duration", () => {
      const now = new Date("2025-01-01T10:00:00Z");
      const deadline = new Date("2025-01-01T11:00:00Z");
      const remaining = getRemainingSeconds(deadline, now);
      expect(remaining).toBe(3600);
    });

    it("floors fractional seconds", () => {
      const now = new Date("2025-01-01T10:00:00.500Z");
      const deadline = new Date("2025-01-01T10:00:01.999Z");
      const remaining = getRemainingSeconds(deadline, now);
      expect(remaining).toBe(1);
    });
  });
});
