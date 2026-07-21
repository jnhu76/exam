import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const createDatabaseMock = vi.fn();
const sqlEndMock = vi.fn();

vi.mock("@exam/db/src/database.js", () => ({
  createDatabase: (...args: unknown[]) => createDatabaseMock(...args),
}));

async function loadDbPlugin() {
  const mod = await import("./db.js");
  const { resetRuntimeConfigForTest } =
    await import("../config/runtimeConfig.js");
  resetRuntimeConfigForTest();
  return mod.default;
}

function databaseConnectionMock() {
  return { db: {}, sql: { end: sqlEndMock } };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("db plugin: P0-2 uses runtimeConfig.database.url", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    createDatabaseMock.mockReset();
    sqlEndMock.mockReset();
    vi.resetModules();
  });

  it("APP_MODE=ci + TEST_DATABASE_URL set + DATABASE_URL unset uses TEST_DATABASE_URL", async () => {
    vi.stubEnv("APP_MODE", "ci");
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://ci:ci@host:5432/ci_db");
    vi.stubEnv("DATABASE_URL", "");

    createDatabaseMock.mockResolvedValueOnce(databaseConnectionMock());
    const dbPlugin = await loadDbPlugin();
    const app = Fastify();
    await app.register(dbPlugin);
    await app.ready();

    expect(createDatabaseMock).toHaveBeenCalledWith(
      "postgresql://ci:ci@host:5432/ci_db",
    );
    await app.close();
    expect(sqlEndMock).toHaveBeenCalledOnce();
  });

  it("APP_MODE=test uses TEST_DATABASE_URL", async () => {
    vi.stubEnv("APP_MODE", "test");
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://t:t@host:5432/test_db");

    createDatabaseMock.mockResolvedValueOnce(databaseConnectionMock());
    const dbPlugin = await loadDbPlugin();
    const app = Fastify();
    await app.register(dbPlugin);
    await app.ready();

    expect(createDatabaseMock).toHaveBeenCalledWith(
      "postgresql://t:t@host:5432/test_db",
    );
    await app.close();
  });

  it("APP_MODE=e2e uses TEST_DATABASE_URL", async () => {
    vi.stubEnv("APP_MODE", "e2e");
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://e2e:e2e@host:5432/e2e_db");

    createDatabaseMock.mockResolvedValueOnce(databaseConnectionMock());
    const dbPlugin = await loadDbPlugin();
    const app = Fastify();
    await app.register(dbPlugin);
    await app.ready();

    expect(createDatabaseMock).toHaveBeenCalledWith(
      "postgresql://e2e:e2e@host:5432/e2e_db",
    );
    await app.close();
  });

  it("APP_MODE=development uses DATABASE_URL", async () => {
    vi.stubEnv("APP_MODE", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://dev:dev@host:5432/dev_db");

    createDatabaseMock.mockResolvedValueOnce(databaseConnectionMock());
    const dbPlugin = await loadDbPlugin();
    const app = Fastify();
    await app.register(dbPlugin);
    await app.ready();

    expect(createDatabaseMock).toHaveBeenCalledWith(
      "postgresql://dev:dev@host:5432/dev_db",
    );
    await app.close();
  });

  it("APP_MODE=production uses DATABASE_URL", async () => {
    vi.stubEnv("APP_MODE", "production");
    vi.stubEnv("JWT_SECRET", "s");
    vi.stubEnv("CORS_ORIGIN", "https://example.com");
    vi.stubEnv("DATABASE_URL", "postgresql://prod:prod@host:5432/prod_db");

    createDatabaseMock.mockResolvedValueOnce(databaseConnectionMock());
    const dbPlugin = await loadDbPlugin();
    const app = Fastify();
    await app.register(dbPlugin);
    await app.ready();

    expect(createDatabaseMock).toHaveBeenCalledWith(
      "postgresql://prod:prod@host:5432/prod_db",
    );
    await app.close();
  });

  it("production missing DATABASE_URL fails fast at config build", async () => {
    vi.stubEnv("APP_MODE", "production");
    vi.stubEnv("JWT_SECRET", "s");
    vi.stubEnv("CORS_ORIGIN", "https://example.com");
    vi.stubEnv("DATABASE_URL", "");

    const dbPlugin = await loadDbPlugin();
    const app = Fastify();
    await expect(app.register(dbPlugin)).rejects.toThrow(
      /DATABASE_URL is required in production/,
    );
  });

  it("drains accepted audit work before closing the database pool", async () => {
    vi.stubEnv("APP_MODE", "test");
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://t:t@host:5432/test_db");
    const events: string[] = [];
    const gate = createDeferred();
    sqlEndMock.mockImplementationOnce(async () => {
      events.push("database-closed");
    });
    createDatabaseMock.mockResolvedValueOnce(databaseConnectionMock());
    const dbPlugin = await loadDbPlugin();
    const auditLifecyclePlugin = (await import("./auditLifecycle.js")).default;
    const app = Fastify();
    await app.register(dbPlugin);
    await app.register(auditLifecyclePlugin);
    await app.ready();
    app.auditWrites.schedule(async () => {
      await gate.promise;
      events.push("audit-finished");
    }, vi.fn());

    const close = app.close();
    for (let turn = 0; turn < 10 && !app.auditWrites.isDraining(); turn++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(app.auditWrites.isDraining()).toBe(true);
    expect(sqlEndMock).not.toHaveBeenCalled();

    gate.resolve();
    await close;
    expect(events).toEqual(["audit-finished", "database-closed"]);
  });
});
