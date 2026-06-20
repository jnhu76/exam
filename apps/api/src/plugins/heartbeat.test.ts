import { describe, expect, it, vi } from "vitest";
import { scanForDisruptedAttempts } from "./heartbeat.js";

describe("heartbeat plugin", () => {
  describe("scanForDisruptedAttempts", () => {
    it("marks attempts as disrupted when heartbeat timeout exceeded", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const markedIds: string[] = [];

      const scanResult = await scanForDisruptedAttempts(
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
        async (id) => {
          markedIds.push(id);
          return true;
        },
      );

      expect(scanResult.markedCount).toBe(2);
      expect(markedIds).toContain("att-1");
      expect(markedIds).toContain("att-3");
      expect(markedIds).not.toContain("att-2");
    });

    it("returns 0 markedCount when no attempts need marking", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;

      const scanResult = await scanForDisruptedAttempts(
        [
          {
            id: "att-1",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:59:30Z"),
          },
        ],
        now,
        timeoutMs,
        async () => true,
      );

      expect(scanResult.markedCount).toBe(0);
    });

    it("skips non in_progress attempts", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const markedIds: string[] = [];

      const scanResult = await scanForDisruptedAttempts(
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
        async (id) => {
          markedIds.push(id);
          return true;
        },
      );

      expect(scanResult.markedCount).toBe(0);
    });

    it("does not count a no-op race (onDisrupted returns false) in markedCount", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const onDisrupted = vi.fn(async () => false);

      const scanResult = await scanForDisruptedAttempts(
        [
          {
            id: "noop-1",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
        ],
        now,
        timeoutMs,
        onDisrupted,
      );

      expect(onDisrupted).toHaveBeenCalledTimes(1);
      expect(scanResult.markedCount).toBe(0);
    });

    it("counts a state change when onDisrupted returns true or void", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const onDisrupted = vi.fn(async (id: string) => {
        if (id === "ret-true") return true;
        if (id === "ret-void") return undefined;
        return false;
      });

      const scanResult = await scanForDisruptedAttempts(
        [
          {
            id: "ret-true",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
          {
            id: "ret-void",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
          {
            id: "ret-false",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
        ],
        now,
        timeoutMs,
        onDisrupted,
      );

      expect(scanResult.markedCount).toBe(2);
    });

    it("records failedCount and invokes onError when onDisrupted throws (retry next scan)", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const markedIds: string[] = [];
      const onDisrupted = vi.fn(async (id: string) => {
        if (id === "fail-1") {
          throw new Error("transient db error");
        }
        markedIds.push(id);
        return true;
      });
      const onError = vi.fn();

      const scanResult = await scanForDisruptedAttempts(
        [
          {
            id: "fail-1",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
          {
            id: "ok-1",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
        ],
        now,
        timeoutMs,
        onDisrupted,
        { onError },
      );

      expect(markedIds).toEqual(["ok-1"]);
      expect(scanResult.markedCount).toBe(1);
      expect(scanResult.failedCount).toBe(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0]).toBe("fail-1");
    });

    it("continues scanning remaining attempts when onError itself throws", async () => {
      const now = new Date("2025-01-01T11:00:00Z");
      const timeoutMs = 60_000;
      const visitedIds: string[] = [];
      const onDisrupted = vi.fn(async (id: string) => {
        visitedIds.push(id);
        throw new Error("transient db error");
      });
      // A misbehaving error callback that throws must NOT abort the scan loop.
      const throwingOnError = vi.fn(() => {
        throw new Error("buggy error reporter");
      });

      const scanResult = await scanForDisruptedAttempts(
        [
          {
            id: "att-1",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
          {
            id: "att-2",
            status: "in_progress",
            lastActivityAt: new Date("2025-01-01T10:00:00Z"),
          },
        ],
        now,
        timeoutMs,
        onDisrupted,
        { onError: throwingOnError },
      );

      // Both attempts were visited despite onError throwing for the first.
      expect(visitedIds).toEqual(["att-1", "att-2"]);
      expect(scanResult.failedCount).toBe(2);
      expect(scanResult.markedCount).toBe(0);
      expect(throwingOnError).toHaveBeenCalledTimes(2);
    });
  });
});
