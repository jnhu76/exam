/**
 * ADR-007 Phase 4 — background-job default-off regression guard.
 *
 * Audit finding (recorded in docs/dev/test-ci-parallelism-plan.md):
 * `buildTestApp()` does NOT start any background timers. The only periodic
 * timers in `apps/api/src/**` live inside `heartbeatPlugin` and
 * `deadlineScannerPlugin`, both registered EXCLUSIVELY by production
 * `server.ts` — never by the test factory. Tests that exercise scanning call
 * the scan *functions* directly (e.g. `scanDatabaseForExpiredAttempts`),
 * never the timer-driven plugin lifecycle.
 *
 * This file locks that invariant so a future change cannot silently regress
 * it. If ordinary `buildTestApp()` ever starts registering a scanner / poller
 * / worker / `setInterval`, these tests fail BEFORE Phase 5 parallelism is
 * exposed to accidental background-timer interference between workers.
 *
 * Non-goals: this file intentionally does NOT add an `enableScanners` /
 * `enableDeadlineScanner` opt-in to `buildTestApp()`. No current test needs
 * plugin-level scanner lifecycle; tests call the scan functions directly. If
 * a future background test needs the real timer-driven plugin, an explicit
 * opt-in should be added at that time (see the Phase 4 follow-up note in
 * test-ci-parallelism-plan.md).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { buildTestApp } from "./testHelpers.js";

/** A no-op route plugin so buildTestApp has something to register. */
const noopRoute: FastifyPluginAsync = async () => {};

/**
 * Spy `setInterval` for the duration of `fn`, run `fn`, then restore. Returns
 * the list of `setInterval` calls captured while `fn` ran. Used to prove that
 * building a test app creates zero repeating timers.
 */
async function captureSetIntervalDuring<T>(
  fn: () => Promise<T>,
): Promise<T & { setIntervalCalls: unknown[][] }> {
  const calls: unknown[][] = [];
  const original = global.setInterval;
  // Replace global.setInterval with a spy that records but does NOT actually
  // start a timer (returning a dummy handle). This keeps the build hermetic:
  // even if a regression introduced a timer, it would never fire.
  const spy = vi.fn((...args: unknown[]) => {
    calls.push(args);
    return 0 as unknown as NodeJS.Timeout;
  });
  global.setInterval = spy as unknown as typeof global.setInterval;
  try {
    const result = await fn();
    // Attach the captured calls and cast to the intersection type.
    (result as T & { setIntervalCalls: unknown[][] }).setIntervalCalls = calls;
    return result as T & { setIntervalCalls: unknown[][] };
  } finally {
    global.setInterval = original;
  }
}

describe("Phase 4 — buildTestApp background-job default-off", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  it("ordinary buildTestApp() does NOT register the heartbeat scanner plugin", async () => {
    const ctx = await captureSetIntervalDuring(() => buildTestApp(noopRoute));
    cleanup = ctx.cleanup;
    // heartbeatPlugin is the only place that runs the disrupted-attempt
    // scanner timer; it must never be registered by the test factory.
    expect(ctx.app.hasPlugin("heartbeatPlugin")).toBe(false);
  });

  it("ordinary buildTestApp() does NOT register the deadline scanner plugin", async () => {
    const ctx = await captureSetIntervalDuring(() => buildTestApp(noopRoute));
    cleanup = ctx.cleanup;
    // deadlineScannerPlugin is the only place that runs the expired-attempt
    // auto-submit timer; it must never be registered by the test factory.
    expect(ctx.app.hasPlugin("deadlineScannerPlugin")).toBe(false);
  });

  it("ordinary buildTestApp() starts ZERO setInterval timers", async () => {
    // The decisive, name-independent invariant: a test app build creates no
    // repeating background timers at all. This catches a future scanner /
    // poller / worker registered under any name, not just the two known ones.
    const ctx = await captureSetIntervalDuring(() => buildTestApp(noopRoute));
    cleanup = ctx.cleanup;
    expect(ctx.setIntervalCalls).toHaveLength(0);
  });

  it("ordinary buildTestApp() does not depend on background auto-start (regression baseline)", async () => {
    // Sanity: the built app still seeds and is ready to serve requests
    // WITHOUT any scanner running. If a future change made ordinary route
    // behavior depend on a background tick, this assertion would catch it.
    const ctx = await buildTestApp(noopRoute);
    cleanup = ctx.cleanup;
    expect(ctx.app).toBeDefined();
    expect(ctx.org).toBeDefined();
    expect(ctx.adminToken).toBeTruthy();
    expect(ctx.candidateToken).toBeTruthy();
    // No scanner plugin should be present on a working ordinary build.
    expect(ctx.app.hasPlugin("heartbeatPlugin")).toBe(false);
    expect(ctx.app.hasPlugin("deadlineScannerPlugin")).toBe(false);
  });
});
