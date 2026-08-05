/**
 * Rollback CLI (rollback-attempt-command-receipts.ts) — URL parsing +
 * controlled error path + real-PG lifecycle (J5-I1C Slice 1 audit §10;
 * overnight hardening: mirrors `rollback-incident-tables.test.ts`).
 *
 * Unit tests cover `parseDatabaseName` (query params, trailing slash,
 * percent-encoding, malformed URLs, malformed percent-encoding → fail
 * closed). Subprocess tests spawn the real CLI via tsx and assert the full
 * contract: clear stderr, nonzero exit, connection closed when opened, no
 * unhandledRejection. The PG-dependent subprocess tests run against isolated
 * test schemas (search_path via URL options), so they never touch dev/test
 * database state outside their own schema.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parseDatabaseName } from "./rollback-attempt-command-receipts.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import {
  addSearchPathToUrl,
  setupIsolatedTestDb,
} from "@exam/db/src/testIsolation.js";
import { createDatabase } from "@exam/db/src/database.js";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { withTestInfraLifecycleLock } from "@exam/db/src/testInfraLock.js";
import { schema } from "@exam/db/src/schema/pg.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, "rollback-attempt-command-receipts.ts");
const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");

const BASE_URL = resolveTestDbUrl();

async function pgReachable(url: string): Promise<boolean> {
  const conn = await createPostgresDatabase(url);
  try {
    await conn.sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await conn.sql.end();
  }
}

const PG_UP = await pgReachable(BASE_URL);
const PG_DESCRIBE = PG_UP ? describe : describe.skip;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Spawn the CLI and capture stdout/stderr/exit; hard timeout + kill. */
function runCli(
  args: string[],
  env: Record<string, string | undefined>,
  timeoutMs = 30_000,
): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], {
      env: {
        // The CLI is env-driven; neutralize inherited test-mode vars so
        // APP_MODE/DATABASE_URL below are the only inputs.
        APP_MODE: "",
        NODE_ENV: "development",
        TEST_DATABASE_URL: undefined,
        TEST_DB_URL: undefined,
        ALLOW_UNSAFE_TEST_DATABASE_URL: undefined,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      stdout += d;
    });
    child.stderr.on("data", (d: string) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI subprocess timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}

describe("parseDatabaseName", () => {
  it("excludes query params (sslmode=require)", () => {
    expect(
      parseDatabaseName(
        "postgres://exam:exam@localhost:15432/exam_test?sslmode=require",
      ),
    ).toBe("exam_test");
  });

  it("handles a trailing slash", () => {
    expect(
      parseDatabaseName("postgres://exam:exam@localhost:15432/exam_test/"),
    ).toBe("exam_test");
  });

  it("uses the final non-empty pathname segment", () => {
    expect(
      parseDatabaseName("postgres://exam:exam@localhost:15432/a/b/exam_test"),
    ).toBe("exam_test");
  });

  it("percent-decodes the database name", () => {
    expect(
      parseDatabaseName("postgres://exam:exam@localhost:15432/exam_%74est"),
    ).toBe("exam_test");
  });

  it("returns an empty string when no path segment exists", () => {
    expect(parseDatabaseName("postgres://exam:exam@localhost:15432/")).toBe("");
  });

  it("throws on a malformed URL", () => {
    expect(() => parseDatabaseName("not a url")).toThrow();
  });

  it("throws on malformed percent-encoding (fail closed, no raw fallback)", () => {
    // The incident rollback script falls back to the raw segment; this script
    // deliberately fails closed — a name the guard cannot evaluate reliably
    // must not be proceeded with (overnight hardening).
    expect(() =>
      parseDatabaseName("postgres://exam:exam@localhost:15432/exam_%ZZ"),
    ).toThrow(/Malformed percent-encoding/);
  });
});

describe("rollback CLI — controlled error path (no DB needed)", () => {
  it("refuses to run without --confirm (exit 2, stderr)", async () => {
    const res = await runCli([], {
      DATABASE_URL: `${BASE_URL}?connect_timeout=2`,
    });
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/--confirm/);
    expect(res.stderr).not.toMatch(/unhandledRejection/i);
  });

  it("rejects a malformed DATABASE_URL (exit 2, stderr)", async () => {
    const res = await runCli(["--confirm"], {
      DATABASE_URL: "not a url",
    });
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/Invalid DATABASE_URL/);
    expect(res.stderr).not.toMatch(/unhandledRejection/i);
  });

  it("rejects malformed percent-encoding in DATABASE_URL (exit 2, stderr)", async () => {
    const res = await runCli(["--confirm"], {
      DATABASE_URL: "postgres://exam:exam@localhost:15432/exam_%ZZ",
    });
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/Malformed percent-encoding/);
    expect(res.stderr).not.toMatch(/unhandledRejection/i);
  });

  it("fails fast when the required DB env is missing (exit 2, stderr)", async () => {
    const res = await runCli(["--confirm"], {
      // production mode never gets the development convenience fallback. An
      // EMPTY (set) DATABASE_URL prevents the CLI's loadRootEnv() from filling
      // the value from the repo `.env`, simulating a truly missing env.
      APP_MODE: "production",
      NODE_ENV: "",
      DATABASE_URL: "",
    });
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/DATABASE_URL is required/);
    expect(res.stderr).not.toMatch(/unhandledRejection/i);
  });

  it("refuses a database name outside the guard regex (exit 2, stderr)", async () => {
    const res = await runCli(["--confirm"], {
      DATABASE_URL: "postgres://exam:exam@localhost:15432/production_db",
    });
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(
      /Refusing to run against database "production_db"/,
    );
    expect(res.stderr).not.toMatch(/unhandledRejection/i);
  });

  it("surfaces a createDatabase/query failure as exit 1 with stderr", async () => {
    // Port 1 refuses connections; the name guard passes ("exam_test"), so the
    // failure must come from the connection/query path, not from parsing.
    const res = await runCli(["--confirm"], {
      DATABASE_URL:
        "postgres://exam:exam@127.0.0.1:1/exam_test?connect_timeout=2",
    });
    expect(res.code).toBe(1);
    expect(res.stderr.length).toBeGreaterThan(0);
    expect(res.stderr).not.toMatch(/unhandledRejection/i);
  }, 45_000);
});

// ── Exit-code regression (in-process, no DB) ────────────────────────────
//
// The subprocess PG tests cannot force `conn.sql.end()` to reject on a clean
// schema, so the close-failure exit-code path is invisible to them. These
// in-process tests drive `main()` directly with `@exam/db` mocked.
const recoveryMocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  rollbackAttemptCommandReceipts: vi.fn(),
}));

vi.mock("@exam/db", () => ({
  createDatabase: (...args: unknown[]) => recoveryMocks.createDatabase(...args),
  rollbackAttemptCommandReceipts: (...args: unknown[]) =>
    recoveryMocks.rollbackAttemptCommandReceipts(...args),
}));

// loadRootEnv is a no-op for these tests (env is controlled); runtimeConfig
// returns a guard-passing URL so the parse/guard stages never short-circuit.
vi.mock("../config/loadRootEnv.js", () => ({
  loadRootEnv: () => {},
}));
vi.mock("../config/runtimeConfig.js", () => ({
  resolveDatabaseUrlFromEnv: () => "postgres://exam:exam@localhost:15432/exam",
}));

// Imported after the mocks are registered. `main` is exported precisely so it
// can be unit-tested in-process without spawning a subprocess.
const { main } = await import("./rollback-attempt-command-receipts.js");

describe("rollback CLI main() — close-failure exit code (no DB needed)", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let capturedStdout: string[];
  let capturedStderr: string[];

  beforeEach(() => {
    process.exitCode = undefined;
    capturedStdout = [];
    capturedStderr = [];
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        capturedStdout.push(typeof chunk === "string" ? chunk : "");
        return true;
      });
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        capturedStderr.push(typeof chunk === "string" ? chunk : "");
        return true;
      });
    recoveryMocks.createDatabase.mockReset();
    recoveryMocks.rollbackAttemptCommandReceipts.mockReset();
    process.argv = [
      "node",
      "rollback-attempt-command-receipts.ts",
      "--confirm",
    ];
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = undefined;
    process.argv = ["node", "rollback-attempt-command-receipts.ts"];
  });

  it("exit 1 when rollback succeeds but sql.end() rejects", async () => {
    const sqlEnd = vi.fn().mockRejectedValue(new Error("pool teardown failed"));
    recoveryMocks.createDatabase.mockResolvedValue({
      db: {},
      sql: { end: sqlEnd },
    });
    recoveryMocks.rollbackAttemptCommandReceipts.mockResolvedValue({
      rowCount: 0,
      dropped: true,
      absent: false,
      blocked: false,
    });

    await main();

    expect(recoveryMocks.rollbackAttemptCommandReceipts).toHaveBeenCalledTimes(
      1,
    );
    expect(sqlEnd).toHaveBeenCalledTimes(1);
    // A close failure must surface as non-zero.
    expect(process.exitCode).toBe(1);
    expect(capturedStderr.join("")).toMatch(/Failed to close the connection/);
    expect(capturedStdout.join("")).toMatch(/Dropped attempt_command_receipts/);
  });

  it("preserves an existing non-zero exit code when sql.end() also fails", async () => {
    const sqlEnd = vi
      .fn()
      .mockRejectedValue(new Error("secondary close failure"));
    recoveryMocks.createDatabase.mockResolvedValue({
      db: {},
      sql: { end: sqlEnd },
    });
    recoveryMocks.rollbackAttemptCommandReceipts.mockRejectedValue(
      new Error("Guard tripped: 1 row(s) exist in attempt_command_receipts"),
    );

    await main();

    expect(process.exitCode).toBe(1);
    expect(capturedStderr.join("")).toMatch(/Guard tripped/);
    expect(capturedStderr.join("")).toMatch(/Failed to close the connection/);
  });

  it("exit 0 on full success with clean close (no false non-zero)", async () => {
    const sqlEnd = vi.fn().mockResolvedValue(undefined);
    recoveryMocks.createDatabase.mockResolvedValue({
      db: {},
      sql: { end: sqlEnd },
    });
    recoveryMocks.rollbackAttemptCommandReceipts.mockResolvedValue({
      rowCount: 0,
      dropped: true,
      absent: false,
      blocked: false,
    });

    await main();

    // On the clean success path exitCode stays `undefined`, which the OS
    // treats as 0.
    expect(process.exitCode).toBeUndefined();
    expect(capturedStdout.join("")).toMatch(/Dropped attempt_command_receipts/);
    expect(capturedStderr.join("")).not.toMatch(
      /Failed to close the connection/,
    );
  });

  it("exit 0 on the absent-table no-op with clean close", async () => {
    const sqlEnd = vi.fn().mockResolvedValue(undefined);
    recoveryMocks.createDatabase.mockResolvedValue({
      db: {},
      sql: { end: sqlEnd },
    });
    recoveryMocks.rollbackAttemptCommandReceipts.mockResolvedValue({
      rowCount: 0,
      dropped: false,
      absent: true,
      blocked: false,
    });

    await main();

    expect(process.exitCode).toBeUndefined();
    expect(capturedStdout.join("")).toMatch(/absent — no-op/);
  });
});

PG_DESCRIBE(
  "rollback CLI — real PostgreSQL lifecycle",
  { timeout: 120_000 },
  () => {
    const cleanSchema = `cli_clean_${randomUUID().slice(0, 8)}`;
    const guardSchema = `cli_guard_${randomUUID().slice(0, 8)}`;
    let cleanIso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
    let guardIso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;

    beforeAll(async () => {
      cleanIso = await setupIsolatedTestDb({
        namespace: cleanSchema,
        databaseUrl: BASE_URL,
      });
      guardIso = await setupIsolatedTestDb({
        namespace: guardSchema,
        databaseUrl: BASE_URL,
      });
      for (const iso of [cleanIso, guardIso]) {
        const conn = await createDatabase(iso.databaseUrl, iso.schemaName);
        await withTestInfraLifecycleLock(iso.databaseUrl, () =>
          migratePostgres(conn.db, { migrationsSchema: iso.schemaName }),
        );
        await conn.sql.end();
      }
      // Seed the guard schema with one receipt row (activation state), so the
      // CLI must refuse to drop.
      await seedActivatedReceipt(guardIso.schemaName);
    }, 120_000);

    afterAll(async () => {
      await Promise.allSettled([cleanIso?.cleanup(), guardIso?.cleanup()]);
    });

    it("drops the table on a clean schema and exits 0 (connection closed)", async () => {
      const url = addSearchPathToUrl(BASE_URL, cleanIso.schemaName);
      const res = await runCli(["--confirm"], {
        DATABASE_URL: url,
      });
      expect(res.code).toBe(0);
      expect(res.stdout).toMatch(/Dropped attempt_command_receipts/);
      // Exit 0 within the timeout proves the connection was closed (a leaked
      // postgres.js pool would keep the process alive until the timeout).
      const conn = await createPostgresDatabase(BASE_URL);
      try {
        const rows = await conn.sql`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = ${cleanIso.schemaName}
            AND table_name = 'attempt_command_receipts'
        `;
        expect(rows).toHaveLength(0);
      } finally {
        await conn.sql.end();
      }
    });

    it("fails closed when a receipt row exists (exit 1, Guard tripped, table preserved)", async () => {
      const url = addSearchPathToUrl(BASE_URL, guardIso.schemaName);
      const res = await runCli(["--confirm"], {
        DATABASE_URL: url,
      });
      expect(res.code).toBe(1);
      expect(res.stderr).toMatch(/Guard tripped/);
      expect(res.stderr).not.toMatch(/unhandledRejection/i);
      const conn = await createPostgresDatabase(BASE_URL);
      try {
        const rows = await conn.sql`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = ${guardIso.schemaName}
            AND table_name = 'attempt_command_receipts'
        `;
        expect(rows).toHaveLength(1);
      } finally {
        await conn.sql.end();
      }
    });
  },
);

/** Seeds org → user → course → exam → enrollment → attempt → one receipt. */
async function seedActivatedReceipt(schemaName: string): Promise<void> {
  const conn = await createDatabase(BASE_URL, schemaName);
  const db = conn.db;
  try {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const orgId = `cli-org-${randomUUID().slice(0, 8)}`;
    const actorId = `cli-user-${randomUUID().slice(0, 8)}`;
    const courseId = randomUUID();
    const examId = randomUUID();
    const candidateId = randomUUID();
    const enrollmentId = randomUUID();
    const attemptId = randomUUID();

    await db.insert(schema.organizations).values({
      id: orgId,
      name: orgId,
      displayName: orgId,
      slug: orgId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.users).values({
      id: actorId,
      organizationId: orgId,
      username: `cli-${randomUUID().slice(0, 8)}`,
      passwordHash: "hash",
      name: "Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.candidateProfiles).values({
      id: candidateId,
      organizationId: orgId,
      userId: actorId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.courses).values({
      id: courseId,
      organizationId: orgId,
      name: "Course",
      code: `c-${randomUUID().slice(0, 8)}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.exams).values({
      id: examId,
      organizationId: orgId,
      title: "Exam",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date("2026-01-02T00:00:00.000Z"),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [],
      questionSnapshot: [],
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId: orgId,
      examId,
      candidateId,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId: orgId,
      examId,
      enrollmentId,
      candidateId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      startedAt: now,
      deadlineAt: new Date("2026-01-01T01:00:00.000Z"),
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.attemptCommandReceipts).values({
      id: randomUUID(),
      organizationId: orgId,
      attemptId,
      operationId: randomUUID(),
      commandType: "force_submit",
      requestPayload: { reason: "cli-seed" },
      resultPayload: {
        commandType: "force_submit",
        beforeStatus: "in_progress",
        afterStatus: "graded",
        submittedAt: now.toISOString(),
        gradedAt: now.toISOString(),
        appliedAt: now.toISOString(),
      },
      outcome: "applied",
      actorId,
    });
  } finally {
    await conn.sql.end();
  }
}
