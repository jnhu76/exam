import { describe, expect, it } from "vitest";
import { computeStatus, type SystemHealthMetrics } from "./systemMonitor.js";

describe("systemMonitor", () => {
  describe("computeStatus", () => {
    it("returns ok when all metrics are below 80%", () => {
      const metrics: SystemHealthMetrics = {
        cpu: 50,
        memory: 60,
        dbResponseMs: 100,
      };
      expect(computeStatus(metrics)).toBe("ok");
    });

    it("returns ok when cpu is exactly 80", () => {
      const metrics: SystemHealthMetrics = {
        cpu: 80,
        memory: 50,
        dbResponseMs: 100,
      };
      expect(computeStatus(metrics)).toBe("ok");
    });

    it("returns degraded when cpu is between 80 and 95 exclusive", () => {
      const metrics: SystemHealthMetrics = {
        cpu: 85,
        memory: 50,
        dbResponseMs: 100,
      };
      expect(computeStatus(metrics)).toBe("degraded");
    });

    it("returns degraded when memory is between 80 and 95 exclusive", () => {
      const metrics: SystemHealthMetrics = {
        cpu: 50,
        memory: 90,
        dbResponseMs: 100,
      };
      expect(computeStatus(metrics)).toBe("degraded");
    });

    it("returns critical when cpu exceeds 95", () => {
      const metrics: SystemHealthMetrics = {
        cpu: 96,
        memory: 50,
        dbResponseMs: 100,
      };
      expect(computeStatus(metrics)).toBe("critical");
    });

    it("returns critical when memory exceeds 95", () => {
      const metrics: SystemHealthMetrics = {
        cpu: 50,
        memory: 97,
        dbResponseMs: 100,
      };
      expect(computeStatus(metrics)).toBe("critical");
    });

    it("returns degraded when cpu is exactly 95", () => {
      const metrics: SystemHealthMetrics = {
        cpu: 95,
        memory: 50,
        dbResponseMs: 100,
      };
      expect(computeStatus(metrics)).toBe("degraded");
    });

    it("returns critical when both cpu and memory exceed 95", () => {
      const metrics: SystemHealthMetrics = {
        cpu: 99,
        memory: 98,
        dbResponseMs: 100,
      };
      expect(computeStatus(metrics)).toBe("critical");
    });
  });
});
