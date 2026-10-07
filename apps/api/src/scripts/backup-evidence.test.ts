import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import { getIsolatedTestDb, resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { addSearchPathToUrl } from "@exam/db/src/testIsolation.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { backupRuns } from "@exam/db/src/schema/pg.js";
import {
  decideEvidenceDbAccess,
  parseNonNegativeInt,
  parseStrictPositiveInt,
  validateRetentionSuccessInvariant,
  validateAutomatedDrillDurationInvariant,
  type EvidenceDbAccessInput,
} from "./backup-evidence.js";

const base = {
  runtimeMode: "development",
  urlDatabaseName: "exam",
  allowUnsafeTestDb: false,
} satisfies Partial<EvidenceDbAccessInput>;

describe("decideEvidenceDbAccess (connected-DB identity guard)", () => {
  it("allows a production-named database without flagging a bypass", () => {
    expect(decideEvidenceDbAccess({ ...base, connectedDb: "exam" })).toEqual({
      allowed: true,
      bypassed: false,
    });
  });

  it("fails closed on a test-like name (e2e) without the opt-in", () => {
    const d = decideEvidenceDbAccess({ ...base, connectedDb: "exam_e2e" });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toContain("exam_e2e");
      expect(d.reason).toContain("ALLOW_UNSAFE_EVIDENCE_TEST_DB");
    }
  });

  it("fails closed on every test-like substring (test / e2e / ci)", () => {
    for (const db of ["exam_test", "exam_e2e", "exam_ci", "ci_run"]) {
      const d = decideEvidenceDbAccess({ ...base, connectedDb: db });
      expect(d.allowed, `db=${db}`).toBe(false);
    }
  });

  it("allows a test-like database WITH the opt-in, flagged as bypassed", () => {
    expect(
      decideEvidenceDbAccess({
        ...base,
        connectedDb: "exam_e2e",
        allowUnsafeTestDb: true,
      }),
    ).toEqual({ allowed: true, bypassed: true });
  });

  it("does NOT bypass when the connected identity is unreadable, even with the opt-in", () => {
    const d = decideEvidenceDbAccess({
      ...base,
      connectedDb: undefined,
      allowUnsafeTestDb: true,
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toContain("could not determine");
  });

  it("the opt-in never upgrades a production-named database to bypassed", () => {
    expect(
      decideEvidenceDbAccess({
        ...base,
        connectedDb: "exam",
        allowUnsafeTestDb: true,
      }),
    ).toEqual({ allowed: true, bypassed: false });
  });
});

describe("validateRetentionSuccessInvariant (success ↔ verified)", () => {
  it("accepts succeeded + verified", () => {
    expect(
      validateRetentionSuccessInvariant({
        result: "succeeded",
        verificationStatus: "verified",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects succeeded with NO verification flag (the gap that used to record a fake success)", () => {
    const d = validateRetentionSuccessInvariant({
      result: "succeeded",
      verificationStatus: null,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("--verification-status verified");
  });

  it("rejects succeeded + failed verification (the contradictory shape)", () => {
    const d = validateRetentionSuccessInvariant({
      result: "succeeded",
      verificationStatus: "failed",
    });
    expect(d.ok).toBe(false);
  });

  it("rejects succeeded + pending verification", () => {
    const d = validateRetentionSuccessInvariant({
      result: "succeeded",
      verificationStatus: "pending",
    });
    expect(d.ok).toBe(false);
  });

  it("accepts failed with any/no verification (failed needs no verified evidence)", () => {
    for (const verificationStatus of ["failed", "pending", null] as const) {
      expect(
        validateRetentionSuccessInvariant({
          result: "failed",
          verificationStatus,
        }),
      ).toEqual({ ok: true });
    }
  });
});

describe("validateAutomatedDrillDurationInvariant (automated success → duration)", () => {
  it("rejects an automated succeeded drill with no duration (RTO would be unmeasurable)", () => {
    const d = validateAutomatedDrillDurationInvariant({
      source: "automated",
      result: "succeeded",
      durationMs: undefined,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("--duration-ms");
  });

  it("accepts an automated succeeded drill WITH a duration", () => {
    expect(
      validateAutomatedDrillDurationInvariant({
        source: "automated",
        result: "succeeded",
        durationMs: 42_000,
      }),
    ).toEqual({ ok: true });
  });

  it("accepts an automated FAILED drill with no duration (failures carry no restore duration)", () => {
    expect(
      validateAutomatedDrillDurationInvariant({
        source: "automated",
        result: "failed",
        durationMs: undefined,
      }),
    ).toEqual({ ok: true });
  });

  it("accepts an operator-declared success with no duration (declared success is not RTO proof)", () => {
    expect(
      validateAutomatedDrillDurationInvariant({
        source: "operator_declared",
        result: "succeeded",
        durationMs: undefined,
      }),
    ).toEqual({ ok: true });
  });
});

// ── #351: artifact-size parsers ─────────────────────────────────────────
// Rejection paths call fail() → process.exit(1); they are proven end-to-end
// by the CLI subprocess tests below (exit code + ledger state), not by
// in-process calls that would kill the test worker.

describe("size parsers (#351 fail-closed evidence)", () => {
  it("parseNonNegativeInt still accepts legitimate zero (counters)", () => {
    expect(parseNonNegativeInt("0", "duration-ms")).toBe(0);
    expect(parseNonNegativeInt("42", "pruned-backups")).toBe(42);
  });

  it("parseStrictPositiveInt accepts real artifact sizes", () => {
    expect(parseStrictPositiveInt("1", "size-bytes")).toBe(1);
    expect(parseStrictPositiveInt("123456", "size-bytes")).toBe(123456);
  });
});

// ── #351: CLI-level fail-closed proof ───────────────────────────────────
// Spawns the REAL CLI via tsx against an isolated test schema (with the
// documented ALLOW_UNSAFE_EVIDENCE_TEST_DB opt-in — the same one the E2E
// harness uses) and asserts both the process contract (exit 1, clear
// stderr) AND the ledger contract (no succeeded row survives a rejected
// size). This is the layer the pg-basebackup.sh fail-open used to slip a
// 0-byte verified success through.

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, "backup-evidence.ts");
const require2 = createRequire(import.meta.url);
const TSX_CLI = require2.resolve("tsx/cli");

async function cliPgReachable(url: string): Promise<boolean> {
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

const CLI_PG_UP = await cliPgReachable(resolveTestDbUrl());
const CLI_DESCRIBE = CLI_PG_UP ? describe : describe.skip;

interface CliRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Base child environment for the CLI subprocess.
 *
 * INTENTIONAL DEVELOPMENT profile: backup-evidence is the operator
 * evidence-recording CLI, and its own guard refuses test-like runtime modes
 * ("Set APP_MODE=development ..."), so development is the profile under test,
 * not an ambient default. Under the documented loader law (#565) this profile
 * ADMITS the developer root `.env`, so no "explicit values are the only
 * inputs" claim is made here; instead every semantic fact under test is pinned
 * by an explicit projection that the file cannot override (dotenv never
 * overwrites already-set vars): the mode identity, the DATABASE_URL target,
 * and the guard opt-in. The isolated schema lives inside the exam_test
 * database, so the connected-DB identity guard needs its documented opt-in.
 */
function buildCliEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    APP_MODE: "development",
    NODE_ENV: "development",
    ALLOW_UNSAFE_EVIDENCE_TEST_DB: "1",
    DATABASE_URL: cliDbUrl,
  };
  // `undefined` means UNSET (not empty): the child must not inherit a value
  // for a variable the case deliberately removes.
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function runEvidenceCli(
  args: string[],
  overrides: Record<string, string | undefined> = {},
  timeoutMs = 60_000,
): Promise<CliRunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], {
      env: buildCliEnv(overrides),
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
      reject(new Error(`backup-evidence CLI timed out after ${timeoutMs}ms`));
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

let cliDbUrl = "";
let cliDb: Awaited<ReturnType<typeof getIsolatedTestDb>>["db"] | null = null;
let cliCleanup: (() => Promise<void>) | null = null;

CLI_DESCRIBE("backup-evidence CLI (real subprocess, isolated schema)", () => {
  beforeAll(async () => {
    const iso = await getIsolatedTestDb("api-backup-evidence-cli");
    cliDb = iso.db;
    cliCleanup = iso.cleanup;
    const baseUrl = iso.databaseUrl ?? resolveTestDbUrl();
    cliDbUrl = iso.schemaName
      ? addSearchPathToUrl(baseUrl, iso.schemaName)
      : baseUrl;
    // resolveDefaultOrgId requires one organization row.
    const organizationRepo = createOrganizationRepo(iso.db);
    await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions: [],
        sessionId: "s",
      },
      {
        name: "org",
        displayName: "Org",
        slug: `slug-${randomUUID().slice(0, 8)}`,
      },
    );
  }, 30_000);

  afterAll(async () => {
    await cliCleanup?.();
  });

  /**
   * The CLI's test-like mode guard must classify the CANONICAL runtime mode
   * (packages/db::parseAppMode: APP_MODE authoritative, NODE_ENV the fallback,
   * invalid APP_MODE throws) — never a local APP_MODE grammar. These cases run
   * the real subprocess so the hostile environments reach the real consumer.
   */
  describe("runtime-mode guard (parseAppMode convergence)", () => {
    it("refuses a test-like mode that only NODE_ENV selects (APP_MODE unset)", async () => {
      // The canonical fallback reads NODE_ENV when APP_MODE is unset: the
      // resolved mode here IS test, so the test-DB safety refusal must
      // activate. A raw-APP_MODE grammar sees "unset" and stays silent.
      const result = await runEvidenceCli(
        [
          "complete",
          "--operation-id",
          `physical_base:mode-${randomUUID().slice(0, 8)}`,
          "--type",
          "physical_base",
          "--artifact-label",
          "mode.tar",
          "--size-bytes",
          "1024",
          "--verification-method",
          "pg_verifybackup",
          "--executor",
          "host_script",
        ],
        { APP_MODE: undefined, NODE_ENV: "test" },
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("refusing to record evidence");
      expect(result.stderr).toContain("test");
    });

    it("honours APP_MODE over NODE_ENV (development wins over NODE_ENV=test)", async () => {
      // Precedence direction proof: NODE_ENV=test does NOT select test mode
      // while APP_MODE says development. Without this, "refuse whenever any
      // raw input looks test-like" would pass the case above while inverting
      // the documented precedence.
      const operationId = `physical_base:precedence-${randomUUID().slice(0, 8)}`;
      const result = await runEvidenceCli(
        [
          "complete",
          "--operation-id",
          operationId,
          "--type",
          "physical_base",
          "--artifact-label",
          "precedence.tar",
          "--size-bytes",
          "2048",
          "--verification-method",
          "pg_verifybackup",
          "--executor",
          "host_script",
        ],
        { APP_MODE: "development", NODE_ENV: "test" },
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("verified success");
      const rows = await cliDb!
        .select()
        .from(backupRuns)
        .where(eq(backupRuns.operationId, operationId));
      expect(rows.find((r) => r.status === "succeeded")).toBeDefined();
    });

    it("propagates the canonical invalid-APP_MODE error instead of a local fallback", async () => {
      // Canonical semantics: an unparseable APP_MODE throws. The CLI must fail
      // closed on that config error — never re-classify the bad value as
      // "not test-like, therefore proceed as development".
      const result = await runEvidenceCli(
        [
          "complete",
          "--operation-id",
          `physical_base:invalid-${randomUUID().slice(0, 8)}`,
          "--type",
          "physical_base",
          "--artifact-label",
          "invalid.tar",
          "--size-bytes",
          "1024",
          "--verification-method",
          "pg_verifybackup",
          "--executor",
          "host_script",
        ],
        { APP_MODE: "prooduction", NODE_ENV: "development" },
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Invalid APP_MODE "prooduction"');
      // The failure precedes any database work: no target was even resolved.
      expect(result.stderr).not.toContain("target database");
    });
  });

  describe("complete --size-bytes (#351 fail-closed)", () => {
    it("rejects --size-bytes 0 and records NO succeeded ledger row", async () => {
      const operationId = `physical_base:reject-${randomUUID().slice(0, 8)}`;
      const result = await runEvidenceCli([
        "complete",
        "--operation-id",
        operationId,
        "--type",
        "physical_base",
        "--artifact-label",
        "reject.tar",
        "--size-bytes",
        "0",
        "--verification-method",
        "pg_verifybackup",
        "--executor",
        "host_script",
      ]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        "--size-bytes must be a positive integer",
      );

      const rows = await cliDb!
        .select()
        .from(backupRuns)
        .where(eq(backupRuns.operationId, operationId));
      // 0-byte fail-open regression: no verified success may exist.
      expect(rows.filter((r) => r.status === "succeeded")).toHaveLength(0);
    });

    it("accepts a positive size and records the verified success", async () => {
      const operationId = `physical_base:accept-${randomUUID().slice(0, 8)}`;
      const result = await runEvidenceCli([
        "complete",
        "--operation-id",
        operationId,
        "--type",
        "physical_base",
        "--artifact-label",
        "accept.tar",
        "--size-bytes",
        "123456",
        "--verification-method",
        "pg_verifybackup",
        "--executor",
        "host_script",
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("verified success");

      const rows = await cliDb!
        .select()
        .from(backupRuns)
        .where(eq(backupRuns.operationId, operationId));
      const succeeded = rows.find((r) => r.status === "succeeded");
      expect(succeeded).toBeDefined();
      expect(succeeded!.artifactSizeBytes).toBe(123456);
    });
  });
});
