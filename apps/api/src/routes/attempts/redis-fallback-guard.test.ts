import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildSharedAttemptFixture,
  type SharedAttemptFixture,
} from "./__tests__/attempts.testHelpers.js";

/**
 * P3-M7-REDIS-FALLBACK-GUARD
 *
 * Guardrail proving that the test app's candidate surface runs WITHOUT the
 * Redis plugin (`fastify.redis === undefined`). Per the M7 audit
 * (`docs/archive/phase3/audit-redis-fallback-guard-m7.md`), Redis is
 * diagnostics-only today: no candidate/answer/score/submit/attempt code path
 * reads or writes Redis. This precondition pin fails loudly if a future change
 * registers Redis in the test app — at that point the Redis-absent behavior of
 * every candidate flow needs re-examination, because the optional-chained
 * reads that keep the happy-path suites green under absence would no longer
 * prove anything about Redis-present behavior.
 */
describe("P3-M7 redis fallback guard — candidate PG state with Redis absent", () => {
  let fixture: SharedAttemptFixture;

  beforeAll(async () => {
    fixture = await buildSharedAttemptFixture();
  });

  afterAll(async () => {
    await fixture.ctx.cleanup();
  });

  it("the test app runs with Redis absent (fastify.redis falsy)", () => {
    // Sanity: if a future change registers the redis plugin in the test app,
    // these guardrail tests would no longer exercise the Redis-absent path.
    // Fail loudly so a maintainer notices.
    expect(fixture.ctx.app.redis).toBeFalsy();
  });
});
