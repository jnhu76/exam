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
} from "./backup-evidence.js";

const base = {
  appMode: "development",
  urlDatabaseName: "exam",
  allowUnsafeTestDb: false,
};

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

function runEvidenceCli(
  args: string[],
  timeoutMs = 60_000,
): Promise<CliRunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], {
      env: {
        APP_MODE: "",
        NODE_ENV: "development",
        TEST_DATABASE_URL: undefined,
        TEST_DB_URL: undefined,
        ALLOW_UNSAFE_TEST_DATABASE_URL: undefined,
        // The isolated schema lives inside the exam_test database, so the
        // connected-DB identity guard needs its documented opt-in.
        ALLOW_UNSAFE_EVIDENCE_TEST_DB: "1",
        DATABASE_URL: cliDbUrl,
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

CLI_DESCRIBE(
  "backup-evidence CLI complete --size-bytes (#351 fail-closed)",
  () => {
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
  },
);
