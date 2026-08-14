import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import { createRetentionEvidenceRepo } from "@exam/db/src/repository/retentionEvidenceRepo.js";
import { organizations, retentionRuns } from "@exam/db/src/schema/pg.js";
import type { Database, TenantContext } from "@exam/db/src/types.js";

/**
 * P7-CLOSE P7-3b — Host-side retention evidence ledger.
 *
 * Proves the success ↔ verified invariant (review P1-2): a retention run may
 * be `succeeded` ONLY when repository/chain verification is `verified` AND it
 * has a completion time, and `latestSucceededRetention` reflects exactly that
 * (verified + succeeded, ordered by completion time, unbounded — a long run of
 * recent failures/unverified rows must not hide an older verified success).
 */
describe("P7-CLOSE retention evidence ledger", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let orgId: string;
  let ctx: TenantContext;

  beforeAll(async () => {
    const handle = await getIsolatedTestDb("retention-evidence");
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

  const repo = () => createRetentionEvidenceRepo(db);
  const opId = () => `retention:${Date.now()}-${randomUUID().slice(0, 8)}`;

  it("records a verified success and answers latestSucceededRetention", async () => {
    const now = new Date("2026-08-13T02:00:00Z");
    const run = await repo().recordRetentionRun(ctx, {
      operationId: opId(),
      tool: "pgbackrest",
      result: "succeeded",
      startedAt: new Date("2026-08-13T01:55:00Z"),
      completedAt: now,
      prunedBackups: 2,
      prunedWalArchives: 1247,
      retentionObjective: "repo-retention-full=2; 2 full remaining",
      verificationStatus: "verified",
      verificationDetail: "pgbackrest check passed",
      failureReason: null,
      executorType: "host_script",
      now,
    });
    expect(run.result).toBe("succeeded");
    expect(run.verificationStatus).toBe("verified");
    expect(run.prunedBackups).toBe(2);
    const latest = await repo().latestSucceededRetention(ctx);
    expect(latest?.operationId).toBe(run.operationId);
  });

  it("the DB CHECK forbids succeeded with a FAILED verification (cross-field invariant)", async () => {
    // `result` and `verification_status` were previously validated as
    // independent fields — succeeded + failed must now be rejected by the
    // CHECK constraint, not accepted and later rendered as a success.
    await expect(
      db.insert(retentionRuns).values({
        id: randomUUID(),
        organizationId: orgId,
        operationId: "retention:forged-failed-verification",
        tool: "pgbackrest",
        result: "succeeded",
        startedAt: new Date(),
        completedAt: new Date(),
        verificationStatus: "failed",
        executorType: "host_script",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("the DB CHECK forbids succeeded with NULL verification (NULL-safe)", async () => {
    // PostgreSQL CHECK semantics pass on NULL — the constraint must be
    // NULL-safe so a forged `succeeded` row cannot skip the verified-evidence
    // requirement via a NULL verification_status.
    await expect(
      db.insert(retentionRuns).values({
        id: randomUUID(),
        organizationId: orgId,
        operationId: "retention:forged-null-verification",
        tool: "pgbackrest",
        result: "succeeded",
        startedAt: new Date(),
        completedAt: new Date(),
        verificationStatus: null,
        executorType: "host_script",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("the DB CHECK forbids succeeded with a NULL completion time", async () => {
    await expect(
      db.insert(retentionRuns).values({
        id: randomUUID(),
        organizationId: orgId,
        operationId: "retention:forged-null-completion",
        tool: "pgbackrest",
        result: "succeeded",
        startedAt: new Date(),
        completedAt: null,
        verificationStatus: "verified",
        executorType: "host_script",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("latestSucceededRetention ignores an unverified succeeded-shaped row", async () => {
    // A failed run (the normal non-verified outcome) never satisfies the
    // lookup, even though it carries verificationStatus.
    await repo().recordRetentionRun(ctx, {
      operationId: opId(),
      tool: "pgbackrest",
      result: "failed",
      startedAt: new Date("2026-08-13T01:55:00Z"),
      completedAt: new Date("2026-08-13T02:00:00Z"),
      retentionObjective: "repo-retention-full=2",
      prunedBackups: null,
      prunedWalArchives: null,
      verificationStatus: "failed",
      verificationDetail: "pgbackrest check failed",
      failureReason: "verification failed",
      executorType: "host_script",
      now: new Date("2026-08-13T02:00:00Z"),
    });
    expect(await repo().latestSucceededRetention(ctx)).toBeNull();
  });

  it("latestSucceededRetention selects by COMPLETION time, not start time", async () => {
    // Run A started EARLIER but COMPLETED LATER.
    await repo().recordRetentionRun(ctx, {
      operationId: `${opId()}-A`,
      tool: "pgbackrest",
      result: "succeeded",
      startedAt: new Date("2026-08-12T10:00:00Z"),
      completedAt: new Date("2026-08-12T11:00:00Z"),
      retentionObjective: "repo-retention-full=2",
      prunedBackups: null,
      prunedWalArchives: null,
      verificationStatus: "verified",
      verificationDetail: "ok",
      failureReason: null,
      executorType: "host_script",
      now: new Date("2026-08-12T11:00:00Z"),
    });
    // Run B started LATER but COMPLETED EARLIER.
    const b = await repo().recordRetentionRun(ctx, {
      operationId: `${opId()}-B`,
      tool: "pgbackrest",
      result: "succeeded",
      startedAt: new Date("2026-08-12T10:30:00Z"),
      completedAt: new Date("2026-08-12T10:40:00Z"),
      retentionObjective: "repo-retention-full=2",
      prunedBackups: null,
      prunedWalArchives: null,
      verificationStatus: "verified",
      verificationDetail: "ok",
      failureReason: null,
      executorType: "host_script",
      now: new Date("2026-08-12T10:40:00Z"),
    });
    // The most recent VERIFIED success is A (completed 11:00), not B (10:40) —
    // even though B started later. Ordering by startedAt would wrongly pick B.
    const latest = await repo().latestSucceededRetention(ctx);
    expect(latest?.operationId).not.toBe(b.operationId);
    expect(latest?.completedAt).toEqual(new Date("2026-08-12T11:00:00Z"));
  });

  it("latestSucceededRetention sees an older verified success beyond the history page (unbounded)", async () => {
    // 25 failed retention runs fill the bounded history page; an older
    // verified success must still be the answer (a long run of recent
    // failures must not hide an older verified success).
    for (let i = 0; i < 25; i++) {
      await repo().recordRetentionRun(ctx, {
        operationId: `retention:recent-fail-${i}-${randomUUID().slice(0, 6)}`,
        tool: "pgbackrest",
        result: "failed",
        startedAt: new Date(Date.UTC(2026, 7, 12, 0, i)),
        completedAt: new Date(Date.UTC(2026, 7, 12, 0, i + 1)),
        retentionObjective: "repo-retention-full=2",
        prunedBackups: null,
        prunedWalArchives: null,
        verificationStatus: "failed",
        verificationDetail: "check failed",
        failureReason: "transient",
        executorType: "host_script",
        now: new Date(Date.UTC(2026, 7, 12, 0, i + 1)),
      });
    }
    const oldOp = `retention:old-verified-${randomUUID().slice(0, 6)}`;
    await repo().recordRetentionRun(ctx, {
      operationId: oldOp,
      tool: "pgbackrest",
      result: "succeeded",
      startedAt: new Date("2026-07-01T01:55:00Z"),
      completedAt: new Date("2026-07-01T02:00:00Z"),
      retentionObjective: "repo-retention-full=2",
      prunedBackups: null,
      prunedWalArchives: null,
      verificationStatus: "verified",
      verificationDetail: "ok",
      failureReason: null,
      executorType: "host_script",
      now: new Date("2026-07-01T02:00:00Z"),
    });
    const latest = await repo().latestSucceededRetention(ctx);
    expect(latest?.operationId).toBe(oldOp);
    // And it is genuinely outside the bounded history page.
    const history = await repo().listRetentionRuns(ctx, 20);
    expect(history.some((r) => r.operationId === oldOp)).toBe(false);
  });
});
