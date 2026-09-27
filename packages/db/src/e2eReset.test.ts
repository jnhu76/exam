/**
 * Regression test for the E2E mutable-state reset GUARD: `resetE2eState`
 * refuses databases outside the e2e full-reset allowlist, so a misdirected
 * reseed fails loudly instead of truncating a dev/test database.
 *
 * The reseed CONVERGENCE contract (reset:true converges a retained worker DB
 * to the canonical baseline; seed without reset stays an additive upsert) is
 * exercised in @exam/api's `e2e-reseed-convergence.test.ts` — it needs the
 * production submit+grade composition, which lives above this package.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "./database.js";
import { resolveTestDbUrl } from "./testDb.js";
import { resetE2eState } from "./e2eReset.js";

describe("resetE2eState guard", () => {
  let testConn: Awaited<ReturnType<typeof createDatabase>> | undefined;

  afterAll(async () => {
    if (testConn) {
      await testConn.sql.end();
    }
  });

  it("refuses databases outside the e2e full-reset allowlist", async () => {
    // Connect to the vitest test DB (its name never matches the e2e/CI
    // allowlist) and expect a loud refusal.
    testConn = await createDatabase(resolveTestDbUrl());
    await expect(resetE2eState(testConn.db)).rejects.toThrow(
      /Refusing to reset database/,
    );
  });
});
