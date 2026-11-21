import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOOP_SHUTDOWN_BUDGET_MS,
  raceLoopShutdown,
  remainingLoopShutdownBudgetMs,
} from "./loopShutdown.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("remainingLoopShutdownBudgetMs", () => {
  it("anchors ONE window per app instance and never extends it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const app = Fastify({ logger: false });

    expect(remainingLoopShutdownBudgetMs(app)).toBe(LOOP_SHUTDOWN_BUDGET_MS);
    vi.setSystemTime(3_000);
    // Later hooks see the SAME window, not a fresh one — this is what keeps
    // the serial onClose chain inside the #351 budget.
    expect(remainingLoopShutdownBudgetMs(app)).toBe(
      LOOP_SHUTDOWN_BUDGET_MS - 3_000,
    );
    vi.setSystemTime(LOOP_SHUTDOWN_BUDGET_MS + 1);
    expect(remainingLoopShutdownBudgetMs(app)).toBe(0);
  });

  it("keeps app instances isolated", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const first = Fastify({ logger: false });
    const second = Fastify({ logger: false });

    expect(remainingLoopShutdownBudgetMs(first)).toBe(LOOP_SHUTDOWN_BUDGET_MS);
    vi.setSystemTime(LOOP_SHUTDOWN_BUDGET_MS);
    expect(remainingLoopShutdownBudgetMs(first)).toBe(0);
    // The second instance anchors its own window at first use.
    expect(remainingLoopShutdownBudgetMs(second)).toBe(LOOP_SHUTDOWN_BUDGET_MS);
  });
});

describe("raceLoopShutdown", () => {
  const messages = {
    clean: "loop stopped cleanly",
    failed: "loop failed during shutdown",
    abandoned: "loop shutdown timeout; in-flight tick abandoned",
  };

  it("logs a clean settle and clears the unref'd budget timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const app = Fastify({ logger: false });
    const info = vi.spyOn(app.log, "info");
    const warn = vi.spyOn(app.log, "warn");

    await raceLoopShutdown({
      fastify: app,
      inFlight: Promise.resolve(),
      messages,
    });

    expect(info).toHaveBeenCalledWith(messages.clean);
    expect(warn).not.toHaveBeenCalled();
    // #351: a cleared-less loser timer would hold the event loop open for the
    // whole budget after a clean settle.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("abandons a hung tick at the shared budget, names it, and clears the timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const app = Fastify({ logger: false });
    const info = vi.spyOn(app.log, "info");
    const warn = vi.spyOn(app.log, "warn");
    const hung = new Promise<void>(() => {});

    const race = raceLoopShutdown({
      fastify: app,
      inFlight: hung,
      messages,
      abandonedFields: { tickId: "tick-1" },
    });
    await vi.advanceTimersByTimeAsync(LOOP_SHUTDOWN_BUDGET_MS);
    await race;

    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      { tickId: "tick-1", budgetMs: LOOP_SHUTDOWN_BUDGET_MS },
      messages.abandoned,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a tick that rejected during shutdown as settled (handled, not unhandled)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const app = Fastify({ logger: false });
    const info = vi.spyOn(app.log, "info");
    const error = vi.spyOn(app.log, "error");

    await raceLoopShutdown({
      fastify: app,
      inFlight: Promise.reject(new Error("boom")),
      messages,
    });

    expect(error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      messages.failed,
    );
    expect(info).toHaveBeenCalledWith(messages.clean);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles immediately for an idle loop with the remaining shared budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const app = Fastify({ logger: false });
    const info = vi.spyOn(app.log, "info");
    const warn = vi.spyOn(app.log, "warn");

    await raceLoopShutdown({ fastify: app, inFlight: null, messages });

    expect(info).toHaveBeenCalledWith(messages.clean);
    expect(warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
