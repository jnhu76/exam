import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isWorkerDatabaseMode,
  setupApiTestDatabaseFromEnv,
} from "./testDatabase.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";

/**
 * ADR-007 Phase 3B — API test database adapter tests.
 *
 * Two coverage layers:
 *   - Mode selection: the Phase 3A `setupWorkerTestDatabase` is mocked and the
 *     adapter must pick the right path for each TEST_DB_ISOLATION strategy
 *     value (worker-database opt-in vs legacy file-schema).
 *   - TEST_DB_ISOLATION_ENABLED authority (F-04): the per-file schema path is
 *     NOT mocked — the enabled/disabled counterfactual cells run the real
 *     `setupIsolatedTestDb` (real CREATE/DROP SCHEMA against the test DB) and
 *     observe the returned handle's `schemaName`, so the adapter cannot drift
 *     from the canonical resolver without a real behavioral difference.
 *
 * The end-to-end worker-DB lifecycle (real CREATE DATABASE / migrate /
 * truncate / close / production guard) is covered in
 * `packages/db/src/testWorkerDatabase.test.ts` (Phase 3A). Delegation of
 * close/reset/refusal is proven there against the real helper, not against a
 * mock of it.
 */

const BASE_URL = resolveTestDbUrl();

// --- mock the Phase 3A worker helper ----------------------------------------

const setupWorkerMock = vi.fn();

vi.mock("@exam/db/src/testWorkerDatabase.js", () => ({
  setupWorkerTestDatabase: (opts: unknown) => setupWorkerMock(opts),
}));

beforeEach(() => {
  setupWorkerMock.mockReset();
});

// --- pure mode-selection helper ---------------------------------------------

describe("isWorkerDatabaseMode", () => {
  it("returns false on default / unset / file-schema", () => {
    expect(isWorkerDatabaseMode({})).toBe(false);
    expect(isWorkerDatabaseMode({ TEST_DB_ISOLATION: "file-schema" })).toBe(
      false,
    );
    expect(isWorkerDatabaseMode({ TEST_DB_ISOLATION: "0" })).toBe(false);
  });

  it("returns true only for worker-database", () => {
    expect(isWorkerDatabaseMode({ TEST_DB_ISOLATION: "worker-database" })).toBe(
      true,
    );
  });
});

// --- adapter wiring (mocked worker helper, no PG) ---------------------------

describe("setupApiTestDatabaseFromEnv — mode selection", () => {
  it("default (unset) → legacy file-schema, schemaName defined, resetPostgres no-op", async () => {
    const h = await setupApiTestDatabaseFromEnv({
      env: { TEST_DATABASE_URL: BASE_URL },
      namespace: "unit-default",
    });
    expect(h.mode).toBe("file-schema");
    expect(typeof h.schemaName).toBe("string");
    expect(h.schemaName).toMatch(/^test_/);
    expect(setupWorkerMock).not.toHaveBeenCalled();
    // resetPostgres in legacy mode is a no-op (resolves without touching PG).
    await expect(h.resetPostgres()).resolves.toBeUndefined();
    await h.close();
  });

  it("TEST_DB_ISOLATION=file-schema → legacy path with per-file schema (NOT silently disabled)", async () => {
    // "file-schema" is the documented legacy mode name; under the canonical
    // TEST_DB_ISOLATION_ENABLED grammar only exact "0"/"false" disable, so it
    // resolves ENABLED and must get a per-file schema (never the shared
    // `public` schema with no isolation).
    const h = await setupApiTestDatabaseFromEnv({
      env: { TEST_DB_ISOLATION: "file-schema", TEST_DATABASE_URL: BASE_URL },
      namespace: "unit-fs",
    });
    expect(h.mode).toBe("file-schema");
    expect(typeof h.schemaName).toBe("string");
    expect(h.schemaName).toMatch(/^test_/);
    expect(setupWorkerMock).not.toHaveBeenCalled();
    await h.close();
  });

  it("whitespace-padded TEST_DB_ISOLATION value still resolves enabled", async () => {
    // The enabled fact does not trim: canonical grammar disables only on the
    // exact tokens "0"/"false", so "  file-schema  " is an unknown (enabled)
    // token. (Trimming stays owned by the worker-database opt-in check.)
    const h = await setupApiTestDatabaseFromEnv({
      env: {
        TEST_DB_ISOLATION: "  file-schema  ",
        TEST_DATABASE_URL: BASE_URL,
      },
      namespace: "unit-fs-trim",
    });
    expect(h.mode).toBe("file-schema");
    expect(typeof h.schemaName).toBe("string");
    await h.close();
  });

  it("TEST_DB_ISOLATION=worker-database → worker path via helper", async () => {
    setupWorkerMock.mockResolvedValueOnce({
      databaseName: "exam_test_w1",
      databaseUrl: `${BASE_URL.replace(/\/[^/]+$/, "/exam_test_w1")}`,
      scope: { dbIsolation: "worker-database" },
      resetPostgres: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const h = await setupApiTestDatabaseFromEnv({
      env: {
        TEST_DB_ISOLATION: "worker-database",
        TEST_WORKER_ID: "1",
        TEST_DATABASE_URL: BASE_URL,
      },
      namespace: "unit-wd",
    });
    expect(h.mode).toBe("worker-database");
    expect(setupWorkerMock).toHaveBeenCalledTimes(1);
    expect(h.schemaName).toBeUndefined();
    expect(h.databaseUrl.endsWith("/exam_test_w1")).toBe(true);
    await h.close();
  });

  it("worker mode does NOT return a per-file schemaName", async () => {
    setupWorkerMock.mockResolvedValueOnce({
      databaseName: "exam_test_w1",
      databaseUrl: "postgresql://exam:exam@localhost:5432/exam_test_w1",
      scope: { dbIsolation: "worker-database" },
      resetPostgres: vi.fn(),
      close: vi.fn(),
    });
    const h = await setupApiTestDatabaseFromEnv({
      env: {
        TEST_DB_ISOLATION: "worker-database",
        TEST_DATABASE_URL: BASE_URL,
      },
    });
    expect(h.schemaName).toBeUndefined();
    await h.close();
  });
});

// --- isolation-enabled fact: single canonical resolver (F-04) ---------------

describe("setupApiTestDatabaseFromEnv — TEST_DB_ISOLATION_ENABLED authority", () => {
  // Observation target is the HANDLE, not a local boolean: a schemaName
  // matching /^test_/ means the adapter entered the per-file schema path
  // (real CREATE SCHEMA against the test DB); `undefined` means the
  // shared-DB disabled path — the silent no-isolation outcome #730 E6
  // observed under `TEST_DB_ISOLATION=yes` before the adapter delegated to
  // the canonical resolver. The enabled/disabled grammar itself is owned by
  // `packages/db` `isTestDbIsolationEnabled` (see testIsolation.test.ts);
  // these cells pin the adapter to whatever that resolver reports.

  it.each([
    ["yes", "hostile token (#730 E6)"],
    ["1", "canonical shorthand"],
    ["true", "canonical word"],
    ["on", "canonical word"],
    ["definitely", "unknown token"],
  ])(
    "TEST_DB_ISOLATION=%s (%s) → enabled: per-file schema created",
    async (value) => {
      const h = await setupApiTestDatabaseFromEnv({
        env: { TEST_DB_ISOLATION: value, TEST_DATABASE_URL: BASE_URL },
        namespace: "unit-iso-enabled",
      });
      expect(h.mode).toBe("file-schema");
      expect(typeof h.schemaName).toBe("string");
      expect(h.schemaName).toMatch(/^test_/);
      expect(setupWorkerMock).not.toHaveBeenCalled();
      await h.close();
    },
  );

  it.each(["0", "false"])(
    "TEST_DB_ISOLATION=%s → disabled: shared DB, schemaName undefined",
    async (value) => {
      const h = await setupApiTestDatabaseFromEnv({
        env: { TEST_DB_ISOLATION: value, TEST_DATABASE_URL: BASE_URL },
        namespace: "unit-iso-disabled",
      });
      expect(h.mode).toBe("file-schema");
      expect(h.schemaName).toBeUndefined();
      expect(setupWorkerMock).not.toHaveBeenCalled();
      await h.close();
    },
  );

  it("TEST_DB_ISOLATION unset → enabled by default", async () => {
    const h = await setupApiTestDatabaseFromEnv({
      env: { TEST_DATABASE_URL: BASE_URL },
      namespace: "unit-iso-unset",
    });
    expect(h.mode).toBe("file-schema");
    expect(typeof h.schemaName).toBe("string");
    expect(h.schemaName).toMatch(/^test_/);
    await h.close();
  });

  it("TEST_DB_ISOLATION='' (set but empty) → enabled by default", async () => {
    const h = await setupApiTestDatabaseFromEnv({
      env: { TEST_DB_ISOLATION: "", TEST_DATABASE_URL: BASE_URL },
      namespace: "unit-iso-empty",
    });
    expect(h.mode).toBe("file-schema");
    expect(typeof h.schemaName).toBe("string");
    expect(h.schemaName).toMatch(/^test_/);
    await h.close();
  });
});
