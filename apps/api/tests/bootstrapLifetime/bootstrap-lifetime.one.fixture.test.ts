import { afterAll, beforeAll, describe, expect, it } from "vitest";
import examRoutes from "../../src/routes/exam.js";
import {
  buildTestApp,
  type TestContext,
} from "../../src/routes/testHelpers.js";
import {
  BOOTSTRAP_LIFETIME_HANDOFF,
  runBootstrapLifetimeFixture,
} from "./fixture-support.js";

/**
 * Bootstrap-lifetime proof — fixture file ONE of TWO.
 *
 * Inert in ordinary suite runs: the parent (bootstrap-lifetime.test.ts)
 * spawns BOTH fixture files as ONE child Vitest run with `maxWorkers: 1`
 * and BOOTSTRAP_LIFETIME_HANDOFF set; without that env the describe skips.
 * Which file runs first is decided by the child run's file ordering — the
 * shared protocol elects the "first" role with an exclusive lock file, so
 * the proof holds for either order.
 */
describe.skipIf(BOOTSTRAP_LIFETIME_HANDOFF === "")(
  "bootstrap lifetime fixture one",
  () => {
    let ctx: TestContext;

    beforeAll(
      async () => {
        ctx = await buildTestApp(examRoutes);
      },
      // Cold dedicated-slot bootstrap (CREATE DATABASE + full migrate) is a
      // lifecycle-queue participant with a legitimately longer budget —
      // same pattern as the slotReuse stage fixtures.
      30_000,
    );

    afterAll(async () => {
      await ctx.cleanup();
    }, 30_000);

    it("runs the shared lifetime protocol", async () => {
      expect(BOOTSTRAP_LIFETIME_HANDOFF).not.toBe("");
      await runBootstrapLifetimeFixture(
        ctx,
        "bootstrap-lifetime.one.fixture.test.ts",
      );
    });
  },
);
