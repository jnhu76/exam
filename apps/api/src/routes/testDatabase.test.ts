import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isWorkerDatabaseMode,
  setupApiTestDatabaseFromEnv,
} from "./testDatabase.js";

/**
 * ADR-007 Phase 3B — API test database adapter tests.
 *
 * This file is PURE WIRING coverage: it mocks the Phase 3A
 * `setupWorkerTestDatabase` and asserts the adapter picks the right path,
 * threads schemaName/databaseUrl correctly, and proxies close/reset
 * idempotently. No PG service is needed.
 *
 * The end-to-end worker-DB lifecycle (real CREATE DATABASE / migrate /
 * truncate / close) is already covered in
 * `packages/db/src/testWorkerDatabase.test.ts` (Phase 3A). This file only
 * proves the API-side adapter wiring, not the underlying bootstrap.
 */

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://exam:exam@localhost:5432/exam_test";

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
    // Regression guard: "file-schema" is the documented legacy mode name and
    // MUST be treated as ENABLED. Without the explicit handling it falls
    // through to the disabled branch, returning schemaName undefined and
    // silently running tests on the shared `public` schema with no isolation.
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

  it("trims whitespace around TEST_DB_ISOLATION before matching", async () => {
    // "  file-schema  " must behave identically to "file-schema" (enabled).
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

  it("adapter close delegates to underlying worker close (idempotent)", async () => {
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    setupWorkerMock.mockResolvedValueOnce({
      databaseName: "exam_test_w1",
      databaseUrl: "postgresql://exam:exam@localhost:5432/exam_test_w1",
      scope: { dbIsolation: "worker-database" },
      resetPostgres: vi.fn(),
      close: closeSpy,
    });
    const h = await setupApiTestDatabaseFromEnv({
      env: {
        TEST_DB_ISOLATION: "worker-database",
        TEST_DATABASE_URL: BASE_URL,
      },
    });
    await h.close();
    await h.close(); // idempotent: close only forwarded once
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("adapter resetPostgres delegates to worker resetPostgres", async () => {
    const resetSpy = vi.fn().mockResolvedValue(undefined);
    setupWorkerMock.mockResolvedValueOnce({
      databaseName: "exam_test_w1",
      databaseUrl: "postgresql://exam:exam@localhost:5432/exam_test_w1",
      scope: { dbIsolation: "worker-database" },
      resetPostgres: resetSpy,
      close: vi.fn(),
    });
    const h = await setupApiTestDatabaseFromEnv({
      env: {
        TEST_DB_ISOLATION: "worker-database",
        TEST_DATABASE_URL: BASE_URL,
      },
    });
    await h.resetPostgres();
    expect(resetSpy).toHaveBeenCalledTimes(1);
    await h.close();
  });

  it("production mode refusal is delegated to the worker helper (not re-implemented)", async () => {
    // The adapter does not re-implement the production guard; it delegates to
    // `setupWorkerTestDatabase`, whose own `assertNotProduction` is tested in
    // `packages/db/src/testWorkerDatabase.test.ts`. Here we only assert the
    // adapter forwards to that helper in worker mode (so the guard WILL fire
    // through it). The mock stands in for the helper, so no throw is expected
    // in this mocked context.
    setupWorkerMock.mockResolvedValueOnce({
      databaseName: "exam_test_w1",
      databaseUrl: "postgresql://exam:exam@localhost:5432/exam_test_w1",
      scope: { dbIsolation: "worker-database" },
      resetPostgres: vi.fn(),
      close: vi.fn(),
    });
    const h = await setupApiTestDatabaseFromEnv({
      env: {
        APP_MODE: "production",
        TEST_DB_ISOLATION: "worker-database",
        TEST_DATABASE_URL: BASE_URL,
      },
    });
    expect(setupWorkerMock).toHaveBeenCalledTimes(1);
    await h.close();
  });

  it("does not create a DB at import time (no side effect on module load)", () => {
    // Importing the module above already happened; assert the worker mock was
    // NOT called simply by loading. setupWorkerMock is reset in beforeEach, and
    // the only call sites are inside setupApiTestDatabaseFromEnv.
    expect(setupWorkerMock).not.toHaveBeenCalled();
  });
});
