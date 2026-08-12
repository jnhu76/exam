import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import { createBackupEvidenceRepo } from "@exam/db/src/repository/backupEvidenceRepo.js";
import { backupRuns, organizations } from "@exam/db/src/schema/pg.js";
import type { Database, TenantContext } from "@exam/db/src/types.js";

/**
 * P7-E2B — Backup evidence ledger semantics (ADR-017 D10).
 *
 * Proves the four frozen invariants:
 *   1. a backup must not become SUCCESS before verification;
 *   2. a duplicate logical run must not produce contradictory evidence;
 *   3. a crash before verified evidence must not claim success;
 *   4. (pruning is host-owned; the fail-closed surface is the duplicate
 *      conflict + DB-level success-requires-verification CHECK).
 */
describe("P7-E2B backup evidence ledger", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let orgId: string;
  let ctx: TenantContext;

  beforeAll(async () => {
    const handle = await getIsolatedTestDb("backup-evidence");
    db = handle.db;
    cleanup = handle.cleanup;
  });

  beforeEach(async () => {
    orgId = randomUUID();
    await db.insert(organizations).values({
      id: orgId,
      name: "Test Org",
      displayName: "Test Org",
      slug: `test-org-${orgId.slice(0, 8)}-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    ctx = {
      organizationId: orgId,
      actorId: "test",
      role: "Admin",
      permissions: [],
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  const repo = () => createBackupEvidenceRepo(db);
  const opId = () => `logical:${Date.now()}`;

  it("start → complete records a VERIFIED success with full evidence", async () => {
    const operationId = opId();
    const started = await repo().startRun(ctx, {
      operationId,
      backupType: "logical",
      artifactLabel: "exam-2026-08-12.dump",
      executorType: "host_script",
      now: new Date("2026-08-12T10:00:00Z"),
    });
    expect(started.status).toBe("running");

    const done = await repo().completeRun(ctx, {
      operationId,
      backupType: "logical",
      artifactLabel: "exam-2026-08-12.dump",
      artifactSizeBytes: 123456,
      verificationMethod: "pg_restore_list",
      verifiedAt: new Date("2026-08-12T10:05:00Z"),
      executorType: "host_script",
      now: new Date("2026-08-12T10:05:00Z"),
    });
    expect(done.status).toBe("succeeded");
    expect(done.verificationStatus).toBe("verified");
    expect(done.verificationMethod).toBe("pg_restore_list");
    expect(done.artifactSizeBytes).toBe(123456);
    expect(done.completedAt?.toISOString()).toBe("2026-08-12T10:05:00.000Z");

    // The read projection answers "latest verified backup".
    const latest = await repo().latestSucceededRun(ctx);
    expect(latest?.operationId).toBe(operationId);
    expect(latest?.artifactLabel).toBe("exam-2026-08-12.dump");
  });

  it("a run that never verifies NEVER becomes success (crash before verification)", async () => {
    const operationId = opId();
    await repo().startRun(ctx, {
      operationId,
      backupType: "logical",
      artifactLabel: "crash.dump",
      executorType: "host_script",
      now: new Date(),
    });
    // No complete/fail call — the process died. The run stays running and is
    // NOT success; a NEW start for the same logical run closes it abandoned.
    await repo().startRun(ctx, {
      operationId,
      backupType: "logical",
      artifactLabel: "crash.dump",
      executorType: "host_script",
      now: new Date(Date.now() + 1000),
    });
    const runs = await repo().listRuns(ctx);
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.status).sort()).toEqual(["abandoned", "running"]);
    expect(runs.some((r) => r.status === "succeeded")).toBe(false);
  });

  it("a failed verification is recorded as failed, never success", async () => {
    const operationId = opId();
    await repo().startRun(ctx, {
      operationId,
      backupType: "logical",
      artifactLabel: "bad.dump",
      executorType: "host_script",
      now: new Date(),
    });
    const failed = await repo().failRun(ctx, {
      operationId,
      backupType: "logical",
      executorType: "host_script",
      reason: "verification failed: pg_restore --list rejected the archive",
      now: new Date(),
    });
    expect(failed.status).toBe("failed");
    expect(failed.verificationStatus).toBe("failed");
    expect(failed.failureReason).toContain("pg_restore --list");
    expect(await repo().latestSucceededRun(ctx)).toBeNull();
  });

  it("duplicate completion with the SAME artifact is an idempotent no-op", async () => {
    const operationId = opId();
    await repo().completeRun(ctx, {
      operationId,
      backupType: "logical",
      artifactLabel: "same.dump",
      artifactSizeBytes: 100,
      verificationMethod: "pg_restore_list",
      verifiedAt: new Date(),
      executorType: "host_script",
      now: new Date(),
    });
    const again = await repo().completeRun(ctx, {
      operationId,
      backupType: "logical",
      artifactLabel: "same.dump",
      artifactSizeBytes: 100,
      verificationMethod: "pg_restore_list",
      verifiedAt: new Date(),
      executorType: "host_script",
      now: new Date(),
    });
    expect(again.status).toBe("succeeded");
    const runs = await repo().listRuns(ctx);
    expect(runs.filter((r) => r.status === "succeeded")).toHaveLength(1);
  });

  it("duplicate completion with a DIFFERENT artifact fails closed (no contradictory success)", async () => {
    const operationId = opId();
    await repo().completeRun(ctx, {
      operationId,
      backupType: "logical",
      artifactLabel: "first.dump",
      artifactSizeBytes: 100,
      verificationMethod: "pg_restore_list",
      verifiedAt: new Date(),
      executorType: "host_script",
      now: new Date(),
    });
    const second = await repo().completeRun(ctx, {
      operationId,
      backupType: "logical",
      artifactLabel: "second.dump",
      artifactSizeBytes: 200,
      verificationMethod: "pg_restore_list",
      verifiedAt: new Date(),
      executorType: "host_script",
      now: new Date(),
    });
    expect(second.status).toBe("failed");
    expect(second.failureReason).toBe("duplicate_operation_conflict");

    // The original success is untouched and still authoritative.
    const latest = await repo().latestSucceededRun(ctx);
    expect(latest?.artifactLabel).toBe("first.dump");
  });

  it("complete without a prior start still records verified evidence (start-loss)", async () => {
    const operationId = opId();
    const done = await repo().completeRun(ctx, {
      operationId,
      backupType: "logical",
      artifactLabel: "lost-start.dump",
      artifactSizeBytes: 50,
      verificationMethod: "pg_restore_list",
      verifiedAt: new Date(),
      executorType: "host_script",
      now: new Date(),
    });
    expect(done.status).toBe("succeeded");
    expect(done.verificationStatus).toBe("verified");
  });

  it("the DB CHECK forbids a succeeded row without verified evidence (D10 #1)", async () => {
    await expect(
      db.insert(backupRuns).values({
        id: randomUUID(),
        organizationId: orgId,
        operationId: "logical:forged",
        backupType: "logical",
        status: "succeeded",
        startedAt: new Date(),
        verificationStatus: "pending",
        executorType: "host_script",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("concurrent duplicate completion produces at most one success", async () => {
    const operationId = opId();
    const results = await Promise.allSettled([
      repo().completeRun(ctx, {
        operationId,
        backupType: "logical",
        artifactLabel: "race-a.dump",
        artifactSizeBytes: 100,
        verificationMethod: "pg_restore_list",
        verifiedAt: new Date(),
        executorType: "host_script",
        now: new Date(),
      }),
      repo().completeRun(ctx, {
        operationId,
        backupType: "logical",
        artifactLabel: "race-b.dump",
        artifactSizeBytes: 100,
        verificationMethod: "pg_restore_list",
        verifiedAt: new Date(),
        executorType: "host_script",
        now: new Date(),
      }),
    ]);
    const successes = results.filter(
      (r) => r.status === "fulfilled" && r.value.status === "succeeded",
    ).length;
    expect(successes).toBe(1);
    const runs = await repo().listRuns(ctx);
    expect(runs.filter((r) => r.status === "succeeded")).toHaveLength(1);
    expect(await repo().latestSucceededRun(ctx)).not.toBeNull();
  });

  it("records restore drills and distinguishes automated from operator-declared", async () => {
    await repo().recordDrill(ctx, {
      operationId: "logical-restore:2026-08-10",
      backupType: "logical",
      result: "succeeded",
      source: "automated",
      startedAt: new Date("2026-08-10T09:00:00Z"),
      completedAt: new Date("2026-08-10T09:42:00Z"),
      durationMs: 2520000,
    });
    await repo().recordDrill(ctx, {
      operationId: "logical-restore:2026-08-11",
      backupType: "logical",
      result: "operator_declared",
      source: "operator_declared",
      startedAt: new Date("2026-08-11T09:00:00Z"),
      completedAt: new Date("2026-08-11T09:30:00Z"),
      durationMs: 1800000,
    });
    const drills = await repo().listDrills(ctx);
    expect(drills).toHaveLength(2);
    const latest = await repo().latestDrill(ctx);
    expect(latest?.result).toBe("operator_declared");
    expect(latest?.source).toBe("operator_declared");
  });
});

// ───────────────────────── API read surface ─────────────────────────

import {
  afterAll as afterAll2,
  beforeAll as beforeAll2,
  describe as describe2,
} from "vitest";
import type { FastifyPluginAsync } from "fastify";
import {
  buildTestApp,
  createAssignedUserForTest,
} from "../routes/testHelpers.js";
import systemRoutes from "../routes/system.js";
import { createBackupEvidenceRepo as repo2 } from "@exam/db/src/repository/backupEvidenceRepo.js";
import type { TestContext } from "../routes/testHelpers.js";

describe2("P7-E2B backup read API", () => {
  let appCtx: TestContext;
  let cleanup2: () => Promise<void>;
  let maintainerToken: string;

  beforeAll2(async () => {
    const built = await buildTestApp(systemRoutes as FastifyPluginAsync, {
      prefix: "/api",
    });
    appCtx = built;
    cleanup2 = built.cleanup;
    const m = await createAssignedUserForTest(
      built.db,
      built.org.id,
      "Maintainer",
      "maintainer-bk",
    );
    maintainerToken = m.token;
    // Seed evidence rows through the repo (the real CLI path is covered by
    // the ledger tests + the operator smoke test).
    const evidence = repo2(built.db);
    await evidence.completeRun(
      {
        organizationId: built.org.id,
        actorId: "test",
        role: "Admin",
        permissions: [],
      },
      {
        operationId: "logical:2026-08-10",
        backupType: "logical",
        artifactLabel: "exam-2026-08-10.dump",
        artifactSizeBytes: 1024,
        verificationMethod: "pg_restore_list",
        verifiedAt: new Date("2026-08-10T12:00:00Z"),
        executorType: "host_script",
        now: new Date("2026-08-10T12:00:00Z"),
      },
    );
    await evidence.recordDrill(
      {
        organizationId: built.org.id,
        actorId: "test",
        role: "Admin",
        permissions: [],
      },
      {
        operationId: "logical-restore:2026-08-11",
        backupType: "logical",
        result: "succeeded",
        source: "automated",
        startedAt: new Date("2026-08-11T09:00:00Z"),
        completedAt: new Date("2026-08-11T09:40:00Z"),
        durationMs: 2400000,
      },
    );
  });

  afterAll2(async () => {
    await cleanup2();
  });

  it("Admin can read the backup evidence projection", async () => {
    const res = await appCtx.app.inject({
      method: "GET",
      url: "/api/system/backups",
      cookies: { "auth-token": appCtx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.latestVerified).not.toBeNull();
    expect(body.latestVerified.artifactLabel).toBe("exam-2026-08-10.dump");
    expect(body.latestVerified.verificationStatus).toBe("verified");
    expect(body.history).toHaveLength(1);
  });

  it("Maintainer can read the backup evidence projection (observation plane)", async () => {
    const res = await appCtx.app.inject({
      method: "GET",
      url: "/api/system/backups",
      cookies: { "auth-token": maintainerToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.latest).not.toBeNull();
  });

  it("Maintainer can read restore-readiness drill evidence", async () => {
    const res = await appCtx.app.inject({
      method: "GET",
      url: "/api/system/restore-readiness",
      cookies: { "auth-token": maintainerToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.latestDrill.result).toBe("succeeded");
    expect(body.latestDrill.source).toBe("automated");
    expect(body.drillHistory).toHaveLength(1);
  });

  it("the evidence projection never leaks host paths or credentials", async () => {
    const res = await appCtx.app.inject({
      method: "GET",
      url: "/api/system/backups",
      cookies: { "auth-token": appCtx.adminToken },
    });
    const text = JSON.stringify(res.json());
    expect(text).not.toMatch(/\/var\/|mnt|nas|postgresql:\/\//);
    expect(text).toContain("exam-2026-08-10.dump");
  });

  it("no write surface exists (backup.trigger etc. are NOT implemented)", async () => {
    for (const [method, url] of [
      ["POST", "/api/system/backups"],
      ["POST", "/api/system/restore-readiness"],
      ["POST", "/api/system/backups/trigger"],
    ] as const) {
      const res = await appCtx.app.inject({
        method,
        url,
        cookies: { "auth-token": appCtx.adminToken },
      });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it("Candidate cannot read backup evidence", async () => {
    const res = await appCtx.app.inject({
      method: "GET",
      url: "/api/system/backups",
      cookies: { "auth-token": appCtx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
  });
});
