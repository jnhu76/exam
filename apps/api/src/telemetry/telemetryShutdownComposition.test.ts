import { describe, expect, it, vi } from "vitest";

import { composeSdkShutdown } from "./runtime.js";

/**
 * Unit contract for the composed SDK shutdown (ADR-028 D1, R4 review): the
 * trace face and the metric face are independent queues, so one face's
 * failure must never cancel the other face's shutdown — the metric face's
 * final periodic export only happens through its provider shutdown. Pure
 * function-level tests: no OTel global registration, no init decision, no
 * process state (see telemetryRuntime.test.ts for the process boundary).
 */

describe("composeSdkShutdown", () => {
  it("runs the metric face even when the trace face rejects, and re-surfaces the trace error", async () => {
    const traceError = new Error("trace face shutdown failed");
    const metricFace = vi.fn(async () => {});
    const composed = composeSdkShutdown([
      async () => {
        throw traceError;
      },
      metricFace,
    ]);
    await expect(composed()).rejects.toBe(traceError);
    expect(metricFace).toHaveBeenCalledTimes(1);
  });

  it("resolves only after every face settles, with no faces failing", async () => {
    const order: string[] = [];
    const composed = composeSdkShutdown([
      async () => {
        order.push("trace");
      },
      async () => {
        order.push("metric");
      },
    ]);
    await expect(composed()).resolves.toBeUndefined();
    expect(order).toEqual(["trace", "metric"]);
  });

  it("surfaces a metric-face rejection after the trace face settled", async () => {
    const metricError = new Error("metric face shutdown failed");
    const composed = composeSdkShutdown([
      async () => {},
      async () => {
        throw metricError;
      },
    ]);
    await expect(composed()).rejects.toBe(metricError);
  });

  it("re-surfaces the FIRST face's rejection when both fail", async () => {
    const traceError = new Error("trace boom");
    const metricError = new Error("metric boom");
    const composed = composeSdkShutdown([
      async () => {
        throw traceError;
      },
      async () => {
        throw metricError;
      },
    ]);
    await expect(composed()).rejects.toBe(traceError);
  });
});
