import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginResearch586Submit,
  countResearch586TxInvocation,
  endResearch586Submit,
  isResearch586TimingEnabled,
  markResearch586,
  parseResearch586PoolMax,
  RESEARCH_586_POOL_ENV,
  RESEARCH_586_TIMING_ENV,
  setResearch586AttemptId,
} from "./research586.js";

describe("EXAM-586 research pool seam parsing (NON_CANONICAL)", () => {
  it("treats unset / empty / whitespace as the canonical implicit mode", () => {
    expect(parseResearch586PoolMax(undefined)).toBeNull();
    expect(parseResearch586PoolMax("")).toBeNull();
    expect(parseResearch586PoolMax("   ")).toBeNull();
  });

  it("accepts exactly 10 / 20 / 30 (protocol §8 allowed values)", () => {
    expect(parseResearch586PoolMax("10")).toBe(10);
    expect(parseResearch586PoolMax("20")).toBe(20);
    expect(parseResearch586PoolMax("30")).toBe(30);
    expect(parseResearch586PoolMax(" 20 ")).toBe(20);
  });

  it("fails fast on any other value instead of silently going canonical", () => {
    for (const bad of ["0", "1", "15", "40", "-10", "ten", "10.5", "null"]) {
      expect(() => parseResearch586PoolMax(bad)).toThrowError(
        RESEARCH_586_POOL_ENV,
      );
    }
  });
});

describe("EXAM-586 neutral timing instrumentation", () => {
  beforeEach(() => {
    delete process.env[RESEARCH_586_TIMING_ENV];
  });
  afterEach(() => {
    delete process.env[RESEARCH_586_TIMING_ENV];
    vi.restoreAllMocks();
  });

  it("is disabled unless EXAM_586_TIMING=1", () => {
    expect(isResearch586TimingEnabled()).toBe(false);
    process.env[RESEARCH_586_TIMING_ENV] = "1";
    expect(isResearch586TimingEnabled()).toBe(true);
    process.env[RESEARCH_586_TIMING_ENV] = "0";
    expect(isResearch586TimingEnabled()).toBe(false);
  });

  it("emits nothing and stores nothing when the research mode is off", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    beginResearch586Submit();
    markResearch586("beforeTx");
    countResearch586TxInvocation();
    setResearch586AttemptId("a1");
    endResearch586Submit({ reqId: "r1", httpStatus: 200 });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("emits exactly one EXAM586_TIMING line with derived phases and retries", async () => {
    process.env[RESEARCH_586_TIMING_ENV] = "1";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    beginResearch586Submit();
    markResearch586("beforeTx");
    await delay(2);
    countResearch586TxInvocation();
    markResearch586("txEnter");
    await delay(2);
    countResearch586TxInvocation(); // retry witness
    markResearch586("beforeLock");
    await delay(2);
    markResearch586("afterLock");
    markResearch586("txExit");
    markResearch586("txResolved");
    setResearch586AttemptId("attempt-1");
    endResearch586Submit({ reqId: "req-1", httpStatus: 200 });
    // Second end must not re-emit (emit-once discipline).
    endResearch586Submit({ reqId: "req-1", httpStatus: 200 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [line] = logSpy.mock.calls[0] as unknown as [string];
    expect(line.startsWith("EXAM586_TIMING ")).toBe(true);
    const parsed = JSON.parse(line.slice("EXAM586_TIMING ".length)) as {
      reqId: string;
      attemptId: string | null;
      httpStatus: number | null;
      txAcquireProxyMs: number;
      lockPhaseMs: number;
      txHoldMs: number;
      txTotalMs: number;
      txInvocations: number;
      retries: number;
    };
    expect(parsed.reqId).toBe("req-1");
    expect(parsed.attemptId).toBe("attempt-1");
    expect(parsed.httpStatus).toBe(200);
    expect(parsed.txAcquireProxyMs).toBeGreaterThanOrEqual(1.5);
    expect(parsed.lockPhaseMs).toBeGreaterThanOrEqual(1.5);
    expect(parsed.txHoldMs).toBeGreaterThanOrEqual(parsed.lockPhaseMs - 0.001);
    expect(parsed.txTotalMs).toBeGreaterThanOrEqual(parsed.txHoldMs - 0.001);
    expect(parsed.txInvocations).toBe(2);
    expect(parsed.retries).toBe(1);
  });

  it("derives null for phases that did not run (branch-shortcircuited tx)", () => {
    process.env[RESEARCH_586_TIMING_ENV] = "1";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    beginResearch586Submit();
    markResearch586("beforeTx");
    countResearch586TxInvocation();
    markResearch586("txEnter");
    markResearch586("txExit");
    markResearch586("txResolved");
    endResearch586Submit({ reqId: "req-2", httpStatus: 200 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(
      (logSpy.mock.calls[0] as unknown as [string])[0].slice(
        "EXAM586_TIMING ".length,
      ),
    ) as { lockPhaseMs: number | null; reconciliationPhaseMs: number | null };
    expect(parsed.lockPhaseMs).toBeNull();
    expect(parsed.reconciliationPhaseMs).toBeNull();
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
