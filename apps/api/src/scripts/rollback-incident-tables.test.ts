/**
 * Rollback CLI (rollback-incident-tables.ts) — URL parsing + controlled error
 * path (ADR-014 §14, P2-D).
 *
 * Unit tests cover `parseDatabaseName` (query params, trailing slash,
 * percent-encoding, malformed URLs). Subprocess tests spawn the real CLI via
 * tsx and assert the full contract: clear stderr, nonzero exit, connection
 * closed when opened, no unhandledRejection. The PG-dependent subprocess tests
 * run against isolated test schemas (search_path via URL options), so they
 * never touch dev/test database state outside their own schema.
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
import { eq } from "drizzle-orm";
import { parseDatabaseName } from "@exam/db";
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
const SCRIPT_PATH = resolve(__dirname, "rollback-incident-tables.ts");
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

  it("refuses a database name outside the guard allowlist (exit 2, stderr)", async () => {
    const res = await runCli(["--confirm"], {
      DATABASE_URL: "postgres://exam:exam@localhost:15432/production_db",
    });
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(
      /Refusing to run against database "production_db"/,
    );
    expect(res.stderr).toMatch(/destructive rollback/);
    expect(res.stderr).not.toMatch(/unhandledRejection/i);
  });

  // ── Review P1-1 counterexamples (the loose regex falsely accepted these) ──
  // Shared with rollback-attempt-command-receipts.test.ts: each name below
  // PASSED the old `/^(exam|.*e2e|.*test|.*ci)/i` regex but must be REJECTED
  // by the exact allowlist. Subprocess test exercises the full CLI guard path.
  for (const dbName of [
    "examproduction",
    "precision_prod",
    "incident_store",
    "decision_db",
  ]) {
    it(`rejects the look-alike "${dbName}" (review P1-1 counterexample)`, async () => {
      const res = await runCli(["--confirm"], {
        DATABASE_URL: `postgres://exam:exam@localhost:15432/${dbName}?connect_timeout=2`,
      });
      expect(res.code).toBe(2);
      expect(res.stderr).toMatch(
        `Refusing to run against database "${dbName}"`,
      );
      expect(res.stderr).not.toMatch(/unhandledRejection/i);
    });
  }

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
// The subprocess PG tests above cannot force `conn.sql.end()` to reject on a
// clean schema, so the close-failure exit-code bug is invisible to them. These
// in-process tests drive `main()` directly with `@exam/db` mocked, so the
// three exit-code branches are deterministic. They mock the barrel `@exam/db`
// (the script's own import surface); existing tests use deep-path imports and
// subprocess spawning, neither of which is affected by this barrel mock.
const recoveryMocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  rollbackIncidentTables: vi.fn(),
}));

vi.mock("@exam/db", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@exam/db/src/scripts/destructiveDbNameGuard.js")
    >();
  return {
    createDatabase: (...args: unknown[]) =>
      recoveryMocks.createDatabase(...args),
    rollbackIncidentTables: (...args: unknown[]) =>
      recoveryMocks.rollbackIncidentTables(...args),
    isDestructiveRollbackTarget: real.isDestructiveRollbackTarget,
    parseDatabaseName: real.parseDatabaseName,
    refuseDbNameMessage: real.refuseDbNameMessage,
  };
});

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
const { main } = await import("./rollback-incident-tables.js");

describe("rollback CLI main() — close-failure exit code (no DB needed)", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let capturedStdout: string[];
  let capturedStderr: string[];

  beforeEach(() => {
    // Reset the process-wide exit code before each case. `undefined` is the
    // Node default and is exactly the state the bug hid in.
    process.exitCode = undefined;
    capturedStdout = [];
    capturedStderr = [];
    // Suppress real output AND capture it. Returning true satisfies the
    // WriteSync callback contract.
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
    recoveryMocks.rollbackIncidentTables.mockReset();
    // --confirm is required; the env mock makes the URL pass the name guard.
    process.argv = ["node", "rollback-incident-tables.ts", "--confirm"];
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = undefined;
    process.argv = ["node", "rollback-incident-tables.ts"];
  });

  it("exit 1 when rollback succeeds but sql.end() rejects (the bug)", async () => {
    const sqlEnd = vi.fn().mockRejectedValue(new Error("pool teardown failed"));
    recoveryMocks.createDatabase.mockResolvedValue({
      db: {},
      sql: { end: sqlEnd },
    });
    recoveryMocks.rollbackIncidentTables.mockResolvedValue({
      nonNullIncidentCount: 0,
      dropped: true,
      blocked: false,
    });

    await main();

    expect(recoveryMocks.rollbackIncidentTables).toHaveBeenCalledTimes(1);
    expect(sqlEnd).toHaveBeenCalledTimes(1);
    // The regression: before the fix exitCode stayed `undefined` → process
    // exits 0. The fix must surface close failure as non-zero.
    expect(process.exitCode).toBe(1);
    expect(capturedStderr.join("")).toMatch(/Failed to close the connection/);
    expect(capturedStdout.join("")).toMatch(/Dropped incident tables/);
  });

  it("preserves an existing non-zero exit code when sql.end() also fails", async () => {
    const sqlEnd = vi
      .fn()
      .mockRejectedValue(new Error("secondary close failure"));
    recoveryMocks.createDatabase.mockResolvedValue({
      db: {},
      sql: { end: sqlEnd },
    });
    recoveryMocks.rollbackIncidentTables.mockRejectedValue(
      new Error("rollback boom"),
    );

    await main();

    // Rollback failure sets exitCode 1; the subsequent close failure must NOT
    // clobber it back to undefined or leave it untouched-as-undefined.
    expect(process.exitCode).toBe(1);
    expect(capturedStderr.join("")).toMatch(/rollback boom/);
    expect(capturedStderr.join("")).toMatch(/Failed to close the connection/);
  });

  it("exit 0 on full success with clean close (no false non-zero)", async () => {
    const sqlEnd = vi.fn().mockResolvedValue(undefined);
    recoveryMocks.createDatabase.mockResolvedValue({
      db: {},
      sql: { end: sqlEnd },
    });
    recoveryMocks.rollbackIncidentTables.mockResolvedValue({
      nonNullIncidentCount: 0,
      dropped: true,
      blocked: false,
    });

    await main();

    // Guards against an over-fix that always sets non-zero. On the clean
    // success path exitCode stays `undefined`, which the OS treats as 0.
    expect(process.exitCode).toBeUndefined();
    expect(capturedStdout.join("")).toMatch(/Dropped incident tables/);
    expect(capturedStderr.join("")).not.toMatch(
      /Failed to close the connection/,
    );
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
      // Seed the guard schema with a non-null incident_id adjustment row
      // (activation state), so the CLI must refuse to drop.
      await seedActivatedIncident(guardIso.schemaName);
    }, 120_000);

    afterAll(async () => {
      await Promise.allSettled([cleanIso?.cleanup(), guardIso?.cleanup()]);
    });

    it("drops the five tables on a clean schema and exits 0 (connection closed)", async () => {
      const url = addSearchPathToUrl(BASE_URL, cleanIso.schemaName);
      const res = await runCli(["--confirm"], {
        DATABASE_URL: url,
      });
      expect(res.code).toBe(0);
      expect(res.stdout).toMatch(/Dropped incident tables/);
      // Exit 0 within the timeout proves the connection was closed (a leaked
      // postgres.js pool would keep the process alive until the timeout).
      const conn = await createPostgresDatabase(BASE_URL);
      try {
        const rows = await conn.sql`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = ${cleanIso.schemaName}
            AND table_name IN (
              'exam_incidents', 'exam_incident_events',
              'exam_incident_actions', 'exam_incident_attempts',
              'exam_incident_interruption_links'
            )
        `;
        expect(rows).toHaveLength(0);
      } finally {
        await conn.sql.end();
      }
    });

    it("fails closed when a non-null incident_id exists (exit 1, Guard tripped, tables preserved)", async () => {
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
            AND table_name = 'exam_incidents'
        `;
        expect(rows).toHaveLength(1);
        const adjRows = await conn.sql`
          SELECT count(*)::int AS n
          FROM ${conn.sql(guardIso.schemaName)}.attempt_time_adjustments
          WHERE incident_id IS NOT NULL
        `;
        expect(Number(adjRows[0]?.n ?? 0)).toBe(1);
      } finally {
        await conn.sql.end();
      }
    });
  },
);

/** Seeds org → user → course → exam → enrollment → attempt → incident → activated adjustment. */
async function seedActivatedIncident(schemaName: string): Promise<void> {
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
    const incidentId = randomUUID();

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
      username: `usr-${randomUUID().slice(0, 6)}`,
      passwordHash: "x",
      name: "Actor",
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
      name: "c",
      code: `code-${randomUUID().slice(0, 6)}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.exams).values({
      id: examId,
      organizationId: orgId,
      title: "t",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(now.getTime() + 86400_000),
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
      interruptionTimePolicy: "operator_incident",
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
      deadlineAt: new Date(now.getTime() + 3600_000),
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.examIncidents).values({
      id: incidentId,
      organizationId: orgId,
      examId,
      type: "other",
      severity: "info",
      status: "open",
      description: "activation",
      reportedBy: actorId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    // source=system_incident satisfies the source_shape CHECK with a non-null
    // incident_id (no actor/reasonText required).
    await db.insert(schema.attemptTimeAdjustments).values({
      id: randomUUID(),
      operationId: randomUUID(),
      organizationId: orgId,
      attemptId,
      incidentId,
      policy: "operator_incident",
      source: "system_incident",
      beforeDeadline: now,
      afterDeadline: new Date(now.getTime() + 300_000),
      addedSeconds: 300,
      reasonCode: "activation",
      createdAt: now,
    });
    // Guard sanity: the activated row is visible through the isolated schema.
    const count = await db
      .select()
      .from(schema.attemptTimeAdjustments)
      .where(eq(schema.attemptTimeAdjustments.organizationId, orgId));
    expect(count).toHaveLength(1);
  } finally {
    await conn.sql.end();
  }
}
