import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isWorkerDatabaseMode,
  setupApiTestDatabaseFromEnv,
} from "./testDatabase.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";

/**
 * ADR-007 Phase 3B — API test database adapter tests.
 *
 * This file is PURE mode-selection coverage: it mocks the Phase 3A
 * `setupWorkerTestDatabase` and asserts the adapter picks the right path for
 * each TEST_DB_ISOLATION value — the "file-schema" ENABLED isolation
 * regression and its trim/worker-database variants. No PG service is needed.
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
});
