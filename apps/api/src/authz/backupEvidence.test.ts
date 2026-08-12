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
    // The rejected attempt must never render as verification-verified: its
    // terminal verification state matches the failed status.
    expect(second.verificationStatus).toBe("failed");
    expect(second.verifiedAt).toBeNull();

    // The original success is untouched and still authoritative.
    const latest = await repo().latestSucceededRun(ctx);
    expect(latest?.artifactLabel).toBe("first.dump");
  });

  it("the DB CHECK forbids a succeeded row with NULL verification (NULL-safe)", async () => {
    // PostgreSQL CHECK semantics pass on NULL — the constraint must be
    // NULL-safe so a forged `succeeded` row cannot skip the verified
    // evidence requirement via a NULL verification_status.
    await expect(
      db.insert(backupRuns).values({
        id: randomUUID(),
        organizationId: orgId,
        operationId: "logical:forged-null",
        backupType: "logical",
        status: "succeeded",
        startedAt: new Date(),
        verificationStatus: null,
        executorType: "host_script",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("completeRun stores the caller-provided start time (cold-import truth)", async () => {
    const operationId = opId();
    const startedAt = new Date("2026-08-10T22:00:00Z");
    const done = await repo().completeRun(ctx, {
      operationId,
      backupType: "cold_filesystem",
      artifactLabel: "cold.dump",
      artifactSizeBytes: 50,
      verificationMethod: "pg_version_presence",
      verifiedAt: new Date("2026-08-11T06:00:00Z"),
      executorType: "host_script",
      now: new Date("2026-08-11T06:00:00Z"),
      startedAt,
    });
    expect(done.status).toBe("succeeded");
    expect(done.startedAt.toISOString()).toBe(startedAt.toISOString());
  });

  it("completeRun stores the caller-provided completion time — an old backup imported now never renders as freshly verified (P7-E truthful RPO)", async () => {
    const operationId = opId();
    // A cold backup that ACTUALLY ran Aug 11 01:00→02:00, imported into the
    // ledger Aug 12 18:00 (the machine was down in between). The ledger must
    // keep the real completion/verification time as the RPO authority and
    // record the ingestion time only in createdAt/updatedAt.
    const startedAt = new Date("2026-08-11T01:00:00Z");
    const completedAt = new Date("2026-08-11T02:00:00Z");
    const importTime = new Date("2026-08-12T18:00:00Z");
    const done = await repo().completeRun(ctx, {
      operationId,
      backupType: "cold_filesystem",
      artifactLabel: "cold-2026-08-11.dump",
      artifactSizeBytes: 50,
      verificationMethod: "pg_version_presence",
      verifiedAt: completedAt,
      completedAt,
      executorType: "host_script",
      now: importTime,
      startedAt,
    });
    expect(done.status).toBe("succeeded");
    expect(done.startedAt.toISOString()).toBe(startedAt.toISOString());
    expect(done.completedAt?.toISOString()).toBe(completedAt.toISOString());
    expect(done.verifiedAt?.toISOString()).toBe(completedAt.toISOString());
    // Ingestion time is the evidence-commit time, never the protection time.
    expect(done.createdAt.toISOString()).toBe(importTime.toISOString());
    // The RPO authority timestamp (verifiedAt) is 40h old — NOT import time.
    const latest = await repo().latestSucceededRun(ctx);
    expect(latest?.verifiedAt?.toISOString()).toBe(completedAt.toISOString());
  });

  it("lastFailure ignores failed rows with a NULL completion time (NULLS LAST)", async () => {
    const operationId = opId();
    await repo().failRun(ctx, {
      operationId: `${operationId}-old`,
      backupType: "logical",
      executorType: "host_script",
      reason: "old failure",
      now: new Date("2026-08-10T08:00:00Z"),
    });
    // Raw insert: a failed row with a NULL completedAt must not win the
    // "last failure" projection over a row with a real timestamp.
    await db.insert(backupRuns).values({
      id: randomUUID(),
      organizationId: orgId,
      operationId: `${operationId}-null`,
      backupType: "logical",
      status: "failed",
      startedAt: new Date("2026-08-12T08:00:00Z"),
      completedAt: null,
      failureReason: "null-completed row",
      executorType: "host_script",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const last = await repo().lastFailure(ctx);
    expect(last?.failureReason).toBe("old failure");
  });

  it("latestSucceededRun ignores succeeded rows with a NULL verifiedAt (NULLS LAST)", async () => {
    const operationId = opId();
    await repo().completeRun(ctx, {
      operationId,
      backupType: "logical",
      artifactLabel: "verified-recent.dump",
      artifactSizeBytes: 100,
      verificationMethod: "pg_restore_list",
      verifiedAt: new Date("2026-08-12T10:00:00Z"),
      executorType: "host_script",
      now: new Date("2026-08-12T10:00:00Z"),
    });
    // Raw insert: a succeeded+verified row with a NULL verifiedAt must not
    // outrank the row with a real verifiedAt.
    await db.insert(backupRuns).values({
      id: randomUUID(),
      organizationId: orgId,
      operationId: `${operationId}-null`,
      backupType: "logical",
      status: "succeeded",
      startedAt: new Date("2026-08-12T11:00:00Z"),
      completedAt: new Date("2026-08-12T11:00:00Z"),
      artifactLabel: "null-verified.dump",
      verificationMethod: "pg_restore_list",
      verificationStatus: "verified",
      verifiedAt: null,
      executorType: "host_script",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const latest = await repo().latestSucceededRun(ctx);
    expect(latest?.artifactLabel).toBe("verified-recent.dump");
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
    // An operator-declared FAILED drill: result and source are orthogonal —
    // `failed` is the outcome, `operator_declared` is who recorded it.
    await repo().recordDrill(ctx, {
      operationId: "logical-restore:2026-08-11",
      backupType: "logical",
      result: "failed",
      source: "operator_declared",
      startedAt: new Date("2026-08-11T09:00:00Z"),
      completedAt: new Date("2026-08-11T09:30:00Z"),
      durationMs: 1800000,
      failureReason: "restore rejected the archive",
    });
    const drills = await repo().listDrills(ctx);
    expect(drills).toHaveLength(2);
    const latest = await repo().latestDrill(ctx);
    expect(latest?.result).toBe("failed");
    expect(latest?.source).toBe("operator_declared");
  });

  it("operator-declared evidence never overwrites an automated drill record", async () => {
    const operationId = "logical-restore:preserved";
    await repo().recordDrill(ctx, {
      operationId,
      backupType: "logical",
      result: "succeeded",
      source: "automated",
      startedAt: new Date("2026-08-10T09:00:00Z"),
      completedAt: new Date("2026-08-10T09:42:00Z"),
      durationMs: 2520000,
    });
    // A later operator declaration for the same logical drill must NOT
    // replace the automated proof (the setWhere guard preserves it).
    const returned = await repo().recordDrill(ctx, {
      operationId,
      backupType: "logical",
      result: "failed",
      source: "operator_declared",
      startedAt: new Date("2026-08-11T09:00:00Z"),
      completedAt: new Date("2026-08-11T09:30:00Z"),
      failureReason: "operator re-check failed",
    });
    expect(returned.source).toBe("automated");
    expect(returned.result).toBe("succeeded");

    const latest = await repo().latestDrill(ctx);
    expect(latest?.source).toBe("automated");
    expect(latest?.result).toBe("succeeded");

    // Compatible re-recording (operator_declared over operator_declared)
    // still updates in place: a declared FAILURE corrected to a declared
    // SUCCESS is a single logical drill re-run, not two records.
    await repo().recordDrill(ctx, {
      operationId: "logical-restore:declared",
      backupType: "logical",
      result: "failed",
      source: "operator_declared",
      startedAt: new Date("2026-08-10T09:00:00Z"),
      completedAt: new Date("2026-08-10T09:30:00Z"),
      failureReason: "first attempt failed",
    });
    const redone = await repo().recordDrill(ctx, {
      operationId: "logical-restore:declared",
      backupType: "logical",
      result: "succeeded",
      source: "operator_declared",
      startedAt: new Date("2026-08-11T09:00:00Z"),
      completedAt: new Date("2026-08-11T09:30:00Z"),
    });
    expect(redone.source).toBe("operator_declared");
    expect(redone.result).toBe("succeeded");
  });

  it("latestSucceededDrill / latestDrill select by COMPLETION time, not start time (crossed durations, P7-E review P2-2)", async () => {
    // Drill A started EARLIER but COMPLETED LATER (long duration).
    await repo().recordDrill(ctx, {
      operationId: "logical-restore:crossed-A",
      backupType: "logical",
      result: "succeeded",
      source: "automated",
      startedAt: new Date("2026-08-12T10:00:00Z"),
      completedAt: new Date("2026-08-12T11:00:00Z"),
      durationMs: 3600000,
    });
    // Drill B started LATER but COMPLETED EARLIER (short duration).
    await repo().recordDrill(ctx, {
      operationId: "logical-restore:crossed-B",
      backupType: "logical",
      result: "succeeded",
      source: "automated",
      startedAt: new Date("2026-08-12T10:30:00Z"),
      completedAt: new Date("2026-08-12T10:40:00Z"),
      durationMs: 600000,
    });
    // The most recent SUCCESSFUL drill EVIDENCE is A (completed 11:00), not B
    // (completed 10:40) — even though B started later. Ordering by startedAt
    // would wrongly pick B, understating recency and flipping the cadence
    // projection (now - completedAt) at the boundary.
    const latestSuccess = await repo().latestSucceededDrill(ctx);
    expect(latestSuccess?.operationId).toBe("logical-restore:crossed-A");
    expect(latestSuccess?.completedAt).toEqual(
      new Date("2026-08-12T11:00:00Z"),
    );

    const latest = await repo().latestDrill(ctx);
    expect(latest?.operationId).toBe("logical-restore:crossed-A");
  });

  it("latestSucceededDrill sees an older success beyond the bounded history page", async () => {
    // 25 failed/declared drills fill the 20-row history page; the older
    // automated success must still be visible via the unbounded lookup.
    for (let i = 0; i < 25; i++) {
      await repo().recordDrill(ctx, {
        operationId: `logical-restore:recent-${i}`,
        backupType: "logical",
        result: "failed",
        source: "automated",
        startedAt: new Date(Date.UTC(2026, 7, 1, 0, i)),
        completedAt: new Date(Date.UTC(2026, 7, 1, 0, i + 1)),
      });
    }
    await repo().recordDrill(ctx, {
      operationId: "logical-restore:old-success",
      backupType: "logical",
      result: "succeeded",
      source: "automated",
      startedAt: new Date("2026-07-01T09:00:00Z"),
      completedAt: new Date("2026-07-01T09:42:00Z"),
    });
    const latest = await repo().latestSucceededDrill(ctx);
    expect(latest?.operationId).toBe("logical-restore:old-success");
    const history = await repo().listDrills(ctx, 20);
    expect(
      history.some((d) => d.operationId === "logical-restore:old-success"),
    ).toBe(false);
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
    expect(body.latestVerified).not.toBeNull();
    expect(body.latestVerified.artifactLabel).toBe("exam-2026-08-10.dump");
    expect(body.latestVerified.verificationStatus).toBe("verified");
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
