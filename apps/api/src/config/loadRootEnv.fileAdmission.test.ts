import { describe, expect, it, type TestContext } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadRootEnv, resolveRootEnvPaths } from "./loadRootEnv.js";

/**
 * Physical file admission through the REAL canonical seam (no dotenv mock —
 * the mocked boundary lives in `loadRootEnv.test.ts`).
 *
 * `loadRootEnv.test.ts` proves the admission DECISION (which candidate paths
 * are handed to dotenv per profile). This file proves the physical half that
 * a mocked dotenv cannot: when the seam admits a real `.env`, its values
 * actually land in `process.env` — and when it refuses one, no file-only
 * value does. Admission semantics, not precedence (#730/#732).
 *
 * Fixture safety: the fixture lives at a repository candidate path
 * (`resolveRootEnvPaths()[0]`) because `loadRootEnv` resolves paths relative
 * to its own module, never cwd. A REAL file at that path (a developer or
 * deployment-local `.env`) is never mutated: the tests SKIP when one exists
 * and run wherever the candidate path is absent (fresh checkouts, CI), where
 * the fixture creates its own file and removes it in `finally` with the
 * removal asserted. The fixture contains ONLY the probe key — admitting it
 * must not inject any database configuration into the running test worker.
 */

const PROBE_KEY = "DOTENV_ADMISSION_PROBE";
const PROBE_VALUE = "dev-file-admitted";
const FIXTURE_CONTENT = `${PROBE_KEY}=${PROBE_VALUE}\n`;

const candidatePath = resolveRootEnvPaths()[0]!;

/**
 * Run `fn` with the fixture `.env` in place and a bare-development-looking
 * process env (no APP_MODE / NODE_ENV — the vitest worker runs with
 * APP_MODE=test injected by TEST_RUNTIME_ENV). Restores file and env
 * afterwards and proves the restoration. A `fn` failure is rethrown after
 * the restoration assertions so a restore bug cannot mask it.
 */
function withDevEnvFixture(content: string, fn: () => void): void {
  const fileExisted = existsSync(candidatePath);
  const originalBytes = fileExisted ? readFileSync(candidatePath) : null;
  const envSnapshot = { ...process.env };
  let fnError: unknown;
  try {
    writeFileSync(candidatePath, content);
    delete process.env[PROBE_KEY];
    delete process.env.APP_MODE;
    delete process.env.NODE_ENV;
    fn();
  } catch (err) {
    fnError = err;
  } finally {
    if (originalBytes === null) {
      rmSync(candidatePath, { force: true });
    } else {
      writeFileSync(candidatePath, originalBytes);
    }
    process.env = envSnapshot;
  }
  // Restoration is part of the contract (fixture-safety proof).
  if (originalBytes === null) {
    expect(existsSync(candidatePath)).toBe(false);
  } else {
    expect(readFileSync(candidatePath)).toEqual(originalBytes);
  }
  if (fnError !== undefined) throw fnError;
}

/**
 * A real `.env` at the candidate path belongs to a developer or deployment —
 * tests must never mutate it. The physical proof runs only where the
 * candidate path is absent, which is exactly the state of fresh checkouts
 * and CI.
 */
function skipWhenRealFilePresent(ctx: TestContext): void {
  if (existsSync(candidatePath)) {
    ctx.skip(
      `real ${candidatePath} present — refusing to mutate a developer/deployment file`,
    );
  }
}

describe("loadRootEnv physical file admission", () => {
  it("bare development: a real developer .env is physically admitted", (ctx) => {
    skipWhenRealFilePresent(ctx);
    withDevEnvFixture(FIXTURE_CONTENT, () => {
      loadRootEnv();
      expect(process.env[PROBE_KEY]).toBe(PROBE_VALUE);
    });
  });

  it("managed profile: a real developer .env stays physically unadmitted", (ctx) => {
    skipWhenRealFilePresent(ctx);
    withDevEnvFixture(FIXTURE_CONTENT, () => {
      process.env.APP_MODE = "e2e";
      loadRootEnv();
      expect(process.env[PROBE_KEY]).toBeUndefined();
    });
  });
});
