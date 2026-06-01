import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { scanForDisruptedAttempts } from "./heartbeat.js";

describe("heartbeat plugin", () => {
  describe("scanForDisruptedAttempts", () => {
    it("marks attempts as disrupted when heartbeat timeout exceeded", () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const markedIds: string[] = [];

      const scanResult = scanForDisruptedAttempts(
        [
          {
            id: "att-1",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:59:00Z"),
          },
          {
            id: "att-2",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:59:30Z"),
          },
          {
            id: "att-3",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:58:00Z"),
          },
        ],
        now,
        timeoutMs,
        (id) => {
          markedIds.push(id);
        },
      );

      expect(scanResult.markedCount).toBe(2);
      expect(markedIds).toContain("att-1");
      expect(markedIds).toContain("att-3");
      expect(markedIds).not.toContain("att-2");
    });

    it("returns 0 when no attempts need marking", () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;

      const scanResult = scanForDisruptedAttempts(
        [
          {
            id: "att-1",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:59:30Z"),
          },
        ],
        now,
        timeoutMs,
        () => {},
      );

      expect(scanResult.markedCount).toBe(0);
    });

    it("skips non in_progress attempts", () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const markedIds: string[] = [];

      const scanResult = scanForDisruptedAttempts(
        [
          {
            id: "att-1",
            status: "submitted",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
          {
            id: "att-2",
            status: "disrupted",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
        ],
        now,
        timeoutMs,
        (id) => {
          markedIds.push(id);
        },
      );

      expect(scanResult.markedCount).toBe(0);
    });
  });
});
