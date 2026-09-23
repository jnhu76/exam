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
 * Bootstrap-lifetime proof — fixture file TWO of TWO. See the file-one
 * fixture and fixture-support.ts for the protocol: both files run in ONE
 * child worker process; the second file to run must see the slot bootstrap
 * already complete (zero lifecycle acquisitions) and the first file's
 * sentinel business row gone (per-file reset).
 */
describe.skipIf(BOOTSTRAP_LIFETIME_HANDOFF === "")(
  "bootstrap lifetime fixture two",
  () => {
    let ctx: TestContext;

    beforeAll(
      async () => {
        ctx = await buildTestApp(examRoutes);
      },
      // Same lifecycle-queue participant pattern as the file-one fixture.
      30_000,
    );

    afterAll(async () => {
      await ctx.cleanup();
    }, 30_000);

    it("runs the shared lifetime protocol", async () => {
      expect(BOOTSTRAP_LIFETIME_HANDOFF).not.toBe("");
      await runBootstrapLifetimeFixture(
        ctx,
        "bootstrap-lifetime.two.fixture.test.ts",
      );
    });
  },
);
