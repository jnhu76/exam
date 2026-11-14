import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

/**
 * Telemetry root marker vs capacity research (#964 W2, R5 review):
 * the telemetry root-pool registration must not be counted by the #550
 * capacity-research arrival wrapper.
 *
 * `registerRootSqlConnectionForTelemetry` creates ONE lazy marker query
 * through the root pool (`sql.unsafe("select 1")` — never consumed, never
 * submitted) to learn the root handler closure. If the research wrapper is
 * installed first, that non-executed marker increments the research
 * `sql.total` counter by 1 per process when both switches are On, making the
 * research snapshot claim a statement arrival that never happened. The db
 * plugin therefore registers telemetry BEFORE installing the wrapper.
 *
 * This test drives the real plugin order with a fake pool: it fails if the
 * two blocks are swapped back (marker counted → total 1).
 */

const createDatabaseMock = vi.fn();
const registerRootMock = vi.fn();

vi.mock("@exam/db/database", () => ({
  createDatabase: (...args: unknown[]) => createDatabaseMock(...args),
}));

vi.mock("../telemetry/runtime.js", () => ({
  registerRootSqlConnectionForTelemetry: (...args: unknown[]) =>
    registerRootMock(...args),
}));

describe("db plugin: telemetry root marker vs capacity research", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    createDatabaseMock.mockReset();
    registerRootMock.mockReset();
  });

  it("does not count the telemetry marker query as a research arrival", async () => {
    vi.stubEnv("APP_MODE", "test");
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://t:t@localhost:5432/test_db");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("CAPACITY_RESEARCH", "1");
    vi.resetModules();

    const sql = {
      options: { max: 10 },
      unsafe: vi.fn(() => ({ handler: { root: true } })),
      end: vi.fn(async () => {}),
    };
    createDatabaseMock.mockResolvedValueOnce({ db: {}, sql });
    // Same shape as the W2 plugin's registerRootConnection: creates one lazy
    // marker query through the root pool and drops it without executing.
    registerRootMock.mockImplementationOnce(
      (rootSql: { unsafe: (query: string) => unknown }) => {
        rootSql.unsafe("select 1");
      },
    );

    // Fresh modules: the research counter is process-global module state.
    const { getCapacityResearchSnapshot } =
      await import("../lib/capacityResearch.js");
    const dbPlugin = (await import("./db.js")).default;
    const app = Fastify();
    await app.register(dbPlugin);
    await app.ready();

    const snapshot = getCapacityResearchSnapshot();
    expect((snapshot.sql as { total: number }).total).toBe(0);

    await app.close();
  });
});
