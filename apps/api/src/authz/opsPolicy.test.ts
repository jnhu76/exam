import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import {
  createOperationalPolicyRepo,
  type OperationalPolicyRow,
} from "@exam/db/src/repository/operationalPolicyRepo.js";
import { createDatabase } from "@exam/db/src/database.js";
import { isTestDbIsolationEnabled } from "@exam/db/src/testIsolation.js";
import { organizations } from "@exam/db/src/schema/pg.js";
import type { Database, TenantContext } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { ValidationError } from "@exam/domain";

/**
 * P7-E3 — Operational policy INTENT (ADR-017 D9).
 *
 * Proves: typed/versioned intent record with CAS; absence = NOT_CONFIGURED;
 * the intent never binds infrastructure (the repo only stores the desired
 * objectives); VERSION_CONFLICT on stale writes; reason required.
 *
 * The two dual-connection CAS races need per-file schema isolation so both
 * writers race on the SAME row. With TEST_DB_ISOLATION disabled,
 * getIsolatedTestDb falls back to the shared test DB and a second
 * createDatabase() call would resolve the env DATABASE_URL — the writers
 * would not be racing the same row and the "proof" would be meaningless
 * (P7-E review P2-2). Skip with an explicit reason instead of running it.
 */
const raceIt = isTestDbIsolationEnabled() ? it : it.skip;
describe("P7-E3 operational policy intent", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let databaseUrl: string | undefined;
  let schemaName: string | undefined;
  let orgId: string;
  let ctx: TenantContext;

  beforeAll(async () => {
    const handle = await getIsolatedTestDb("ops-policy");
    db = handle.db;
    databaseUrl = handle.databaseUrl;
    schemaName = handle.schemaName;
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
      actorId: "admin-1",
      role: "Admin",
      permissions: [],
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  const repo = () => createOperationalPolicyRepo(db);
  const base = {
    desiredRpoSeconds: 3600,
    desiredRetentionDays: 30,
    desiredDrillCadenceDays: 7,
    reason: "initial setup",
  };

  async function upsert(
    expectedVersion: number,
    overrides: Record<string, unknown> = {},
  ) {
    return executeInTransaction(db, (tx) =>
      repo().upsertPolicyWithinTransaction(ctx, tx, {
        desiredRpoSeconds:
          (overrides.desiredRpoSeconds as number) ?? base.desiredRpoSeconds,
        desiredRetentionDays:
          (overrides.desiredRetentionDays as number) ??
          base.desiredRetentionDays,
        desiredDrillCadenceDays:
          (overrides.desiredDrillCadenceDays as number) ??
          base.desiredDrillCadenceDays,
        expectedVersion,
        reason: (overrides.reason as string) ?? base.reason,
        actorId: ctx.actorId,
        now: new Date(),
      }),
    );
  }

  it("no policy row = NOT_CONFIGURED (null read)", async () => {
    expect(await repo().getPolicy(ctx)).toBeNull();
  });

  it("creates the intent record (version 1) with actor + reason", async () => {
    const policy = await upsert(0);
    expect(policy.version).toBe(1);
    expect(policy.desiredRpoSeconds).toBe(3600);
    expect(policy.desiredRetentionDays).toBe(30);
    expect(policy.desiredDrillCadenceDays).toBe(7);
    expect(policy.createdBy).toBe("admin-1");
    expect(policy.updatedBy).toBe("admin-1");
    expect(policy.reason).toBe("initial setup");

    const read = await repo().getPolicy(ctx);
    expect(read?.version).toBe(1);
  });

  it("updates with CAS: echo the read version, bump to version 2", async () => {
    await upsert(0);
    const updated = await upsert(1, {
      desiredRpoSeconds: 7200,
      reason: "tighten RPO",
    });
    expect(updated.version).toBe(2);
    expect(updated.desiredRpoSeconds).toBe(7200);
    expect(updated.reason).toBe("tighten RPO");
  });

  it("rejects a stale write (VERSION_CONFLICT) and leaves the row unchanged", async () => {
    await upsert(0);
    await upsert(1);
    await expect(upsert(1, { desiredRpoSeconds: 9999 })).rejects.toMatchObject({
      code: "OPS_POLICY_VERSION_CONFLICT",
    });
    const read = await repo().getPolicy(ctx);
    expect(read?.desiredRpoSeconds).toBe(3600);
    expect(read?.version).toBe(2);
  });

  raceIt(
    "concurrent updates with the same expected version: exactly one wins (real CAS, no lost update)",
    async () => {
      await upsert(0); // version 1
      // Two writers both read version 1 and race to update. The CAS predicate
      // (version in the UPDATE WHERE) must reject the loser — its write is NOT
      // silently overwritten. The race runs on TWO real connections at READ
      // COMMITTED (the single-connection test pool would serialize the writers
      // and never exercise the predicate): under READ COMMITTED a lost update
      // would otherwise be visible; under REPEATABLE READ the loser would be
      // rejected by snapshot isolation instead of by the CAS itself.
      const conn2 = await createDatabase(databaseUrl, schemaName);
      try {
        const [a, b] = await Promise.allSettled([
          executeInTransaction(
            db,
            (tx) =>
              repo().upsertPolicyWithinTransaction(ctx, tx, {
                desiredRpoSeconds: 7200,
                desiredRetentionDays: 30,
                desiredDrillCadenceDays: 7,
                expectedVersion: 1,
                reason: "writer A",
                actorId: ctx.actorId,
                now: new Date(),
              }),
            "read committed",
          ),
          executeInTransaction(
            conn2.db,
            (tx) =>
              createOperationalPolicyRepo(
                conn2.db,
              ).upsertPolicyWithinTransaction(ctx, tx, {
                desiredRpoSeconds: 9000,
                desiredRetentionDays: 30,
                desiredDrillCadenceDays: 7,
                expectedVersion: 1,
                reason: "writer B",
                actorId: ctx.actorId,
                now: new Date(),
              }),
            "read committed",
          ),
        ]);
        const winners = [a, b].filter(
          (r): r is PromiseFulfilledResult<OperationalPolicyRow> =>
            r.status === "fulfilled" && r.value.version === 2,
        );
        const conflicts = [a, b].filter(
          (r): r is PromiseRejectedResult =>
            r.status === "rejected" &&
            (r.reason as { code?: string }).code ===
              "OPS_POLICY_VERSION_CONFLICT",
        );
        expect(winners).toHaveLength(1);
        expect(conflicts).toHaveLength(1);
        // The loser's value never landed: the committed row carries ONLY the
        // winner's desiredRpoSeconds (the loser's write was rejected, not
        // silently overwritten).
        const read = await repo().getPolicy(ctx);
        expect(read?.version).toBe(2);
        expect(read?.desiredRpoSeconds).toBe(
          winners[0]!.value.desiredRpoSeconds,
        );
        expect([7200, 9000]).toContain(read?.desiredRpoSeconds);
      } finally {
        await conn2.sql.end();
      }
    },
  );

  raceIt(
    "concurrent first-creation: exactly one wins, the other gets VERSION_CONFLICT",
    async () => {
      // Two writers both see NO row (expectedVersion 0) and race to insert on
      // two real connections. The unique org index serializes them; the loser
      // is mapped to VERSION_CONFLICT instead of a raw unique-violation.
      const conn2 = await createDatabase(databaseUrl, schemaName);
      try {
        const [a, b] = await Promise.allSettled([
          executeInTransaction(
            db,
            (tx) =>
              repo().upsertPolicyWithinTransaction(ctx, tx, {
                desiredRpoSeconds: 3600,
                desiredRetentionDays: 30,
                desiredDrillCadenceDays: 7,
                expectedVersion: 0,
                reason: "creator A",
                actorId: ctx.actorId,
                now: new Date(),
              }),
            "read committed",
          ),
          executeInTransaction(
            conn2.db,
            (tx) =>
              createOperationalPolicyRepo(
                conn2.db,
              ).upsertPolicyWithinTransaction(ctx, tx, {
                desiredRpoSeconds: 1800,
                desiredRetentionDays: 30,
                desiredDrillCadenceDays: 7,
                expectedVersion: 0,
                reason: "creator B",
                actorId: ctx.actorId,
                now: new Date(),
              }),
            "read committed",
          ),
        ]);
        const winners = [a, b].filter(
          (r): r is PromiseFulfilledResult<OperationalPolicyRow> =>
            r.status === "fulfilled" && r.value.version === 1,
        );
        const conflicts = [a, b].filter(
          (r): r is PromiseRejectedResult =>
            r.status === "rejected" &&
            (r.reason as { code?: string }).code ===
              "OPS_POLICY_VERSION_CONFLICT",
        );
        expect(winners).toHaveLength(1);
        expect(conflicts).toHaveLength(1);
        const read = await repo().getPolicy(ctx);
        expect(read?.version).toBe(1);
        expect(read?.desiredRpoSeconds).toBe(
          winners[0]!.value.desiredRpoSeconds,
        );
      } finally {
        await conn2.sql.end();
      }
    },
  );

  it("rejects a first-creation with a non-zero version", async () => {
    await expect(upsert(1)).rejects.toMatchObject({
      code: "OPS_POLICY_VERSION_CONFLICT",
    });
    expect(await repo().getPolicy(ctx)).toBeNull();
  });

  it("enforces safe ranges at the DB level", async () => {
    // Out-of-range values are rejected by the CHECK constraints even if the
    // application layer were bypassed.
    await expect(
      executeInTransaction(db, (tx) =>
        repo().upsertPolicyWithinTransaction(ctx, tx, {
          desiredRpoSeconds: 60, // below the 300s floor
          desiredRetentionDays: 30,
          desiredDrillCadenceDays: 7,
          expectedVersion: 0,
          reason: "bad range",
          actorId: ctx.actorId,
          now: new Date(),
        }),
      ),
    ).rejects.toThrow();
    expect(await repo().getPolicy(ctx)).toBeNull();
  });
});

// ───────────────────────── API surface ─────────────────────────

import {
  afterAll as afterAll2,
  beforeAll as beforeAll2,
  describe as describe2,
  expect as expect2,
} from "vitest";
import {
  afterAll as afterAll3,
  beforeAll as beforeAll3,
  describe as describe3,
  expect as expect3,
} from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { auditLogs } from "@exam/db/src/schema/pg.js";
import {
  buildTestApp,
  createAssignedUserForTest,
} from "../routes/testHelpers.js";
import systemRoutes from "../routes/system.js";
import { createBackupEvidenceRepo } from "@exam/db/src/repository/backupEvidenceRepo.js";
import type { TestContext } from "../routes/testHelpers.js";

describe2("P7-E3 ops-policy API", () => {
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
      "maintainer-pol",
    );
    maintainerToken = m.token;
    // Seed a verified backup 2h old so RPO compliance is measurable.
    await createBackupEvidenceRepo(built.db).completeRun(
      {
        organizationId: built.org.id,
        actorId: "test",
        role: "Admin",
        permissions: [],
      },
      {
        operationId: "logical:policy-baseline",
        backupType: "logical",
        artifactLabel: "policy-baseline.dump",
        artifactSizeBytes: 10,
        verificationMethod: "pg_restore_list",
        verifiedAt: new Date(Date.now() - 2 * 3600_000),
        executorType: "host_script",
        now: new Date(),
      },
    );
  });

  afterAll2(async () => {
    await cleanup2();
  });

  async function asAdmin(method: string, url: string, payload?: unknown) {
    return appCtx.app.inject({
      method,
      url,
      payload,
      cookies: { "auth-token": appCtx.adminToken },
    });
  }

  async function asMaintainer(method: string, url: string, payload?: unknown) {
    return appCtx.app.inject({
      method,
      url,
      payload,
      cookies: { "auth-token": maintainerToken },
    });
  }

  it("GET returns NOT_CONFIGURED before any intent exists", async () => {
    const res = await asAdmin("GET", "/api/system/ops-policy");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.policy).toBeNull();
    expect(body.compliance.rpo.status).toBe("NOT_CONFIGURED");
  });

  it("Admin records the intent; compliance computes SATISFIED / NOT_SATISFIED truthfully", async () => {
    // Desired RPO 1h; last verified backup is 2h old → NOT_SATISFIED.
    const put = await asAdmin("PUT", "/api/system/ops-policy", {
      desiredRpoSeconds: 3600,
      desiredRetentionDays: 30,
      desiredDrillCadenceDays: 7,
      version: 0,
      reason: "e2e policy",
    });
    expect(put.statusCode).toBe(200);
    const body = put.json();
    expect(body.policy.version).toBe(1);
    expect(body.compliance.rpo.status).toBe("NOT_SATISFIED");
    expect(body.compliance.retention.status).toBe("NOT_ENFORCED");
    expect(body.compliance.drill.status).toBe("UNKNOWN");

    // Loosen RPO to 3h → SATISFIED.
    const put2 = await asAdmin("PUT", "/api/system/ops-policy", {
      desiredRpoSeconds: 10800,
      desiredRetentionDays: 30,
      desiredDrillCadenceDays: 7,
      version: 1,
      reason: "loosen rpo",
    });
    expect(put2.statusCode).toBe(200);
    expect(put2.json().compliance.rpo.status).toBe("SATISFIED");
  });

  it("stale version → 409 VERSION_CONFLICT", async () => {
    const res = await asAdmin("PUT", "/api/system/ops-policy", {
      desiredRpoSeconds: 3600,
      desiredRetentionDays: 30,
      desiredDrillCadenceDays: 7,
      version: 1, // current version is 2 after the previous test
      reason: "stale write",
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.json())).toContain("OPS_POLICY_VERSION_CONFLICT");
  });

  it("Maintainer can VIEW the intent but CANNOT modify it", async () => {
    const view = await asMaintainer("GET", "/api/system/ops-policy");
    expect(view.statusCode).toBe(200);
    expect(view.json().policy).not.toBeNull();

    const put = await asMaintainer("PUT", "/api/system/ops-policy", {
      desiredRpoSeconds: 3600,
      desiredRetentionDays: 30,
      desiredDrillCadenceDays: 7,
      version: 2,
      reason: "maintainer attempt",
    });
    expect(put.statusCode).toBe(403);
  });

  it("invalid ranges are rejected with 400", async () => {
    const res = await asAdmin("PUT", "/api/system/ops-policy", {
      desiredRpoSeconds: 60, // below floor
      desiredRetentionDays: 30,
      desiredDrillCadenceDays: 7,
      version: 2,
      reason: "bad",
    });
    expect(res.statusCode).toBe(400);
  });

  it("the intent write is audited (ops.policy.updated)", async () => {
    // Drain pending best-effort writes, then read the audit table directly.
    await appCtx.drainAuditWrites();
    const before = await appCtx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "ops.policy.updated"));

    const res = await asAdmin("PUT", "/api/system/ops-policy", {
      desiredRpoSeconds: 3600,
      desiredRetentionDays: 14,
      desiredDrillCadenceDays: 7,
      version: 2,
      reason: "audit check",
    });
    expect(res.statusCode).toBe(200);
    await appCtx.drainAuditWrites();

    const after = await appCtx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "ops.policy.updated"));
    expect(after.length).toBe(before.length + 1);
  });
});

// ───────────────────────── RPO truthfulness (cold-import) ─────────────────────────

describe3(
  "P7-E3 ops-policy RPO truthfulness (old cold backup imported now)",
  () => {
    let appCtx: TestContext;
    let cleanup3: () => Promise<void>;
    let adminToken3: string;
    let orgId3: string;

    beforeAll3(async () => {
      const built = await buildTestApp(systemRoutes as FastifyPluginAsync, {
        prefix: "/api",
      });
      appCtx = built;
      cleanup3 = built.cleanup;
      // Worker-DB mode shares the seeded default org across describes in this
      // file — give this scenario its OWN org + Admin so the policy version
      // and backup evidence are fully independent.
      orgId3 = randomUUID();
      await built.db.insert(organizations).values({
        id: orgId3,
        name: "RPO Truth Org",
        displayName: "RPO Truth Org",
        slug: `rpo-truth-${orgId3.slice(0, 8)}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const admin = await createAssignedUserForTest(
        built.db,
        orgId3,
        "Admin",
        "rpo-truth-admin",
      );
      adminToken3 = admin.token;
      const ctx = {
        organizationId: orgId3,
        actorId: admin.user.id,
        role: "Admin" as const,
        permissions: [],
      };
      // A cold backup that ACTUALLY completed 40h ago, imported into the
      // ledger "now" (the machine was down; the import happens at ledger
      // time). The spool's real completion must be the RPO authority — the
      // projection must NOT treat the import moment as the protection time.
      const completedAt = new Date(Date.now() - 40 * 3600_000);
      await createBackupEvidenceRepo(built.db).completeRun(ctx, {
        operationId: "cold_filesystem:old-import",
        backupType: "cold_filesystem",
        artifactLabel: "cold-old.dump",
        artifactSizeBytes: 10,
        verificationMethod: "pg_version_presence",
        verifiedAt: completedAt,
        completedAt,
        executorType: "host_script",
        now: new Date(),
        startedAt: new Date(completedAt.getTime() - 3600_000),
      });
    });

    afterAll3(async () => {
      await cleanup3();
    });

    it("desired RPO 1h with a 40h-old (just-imported) backup → NOT_SATISFIED", async () => {
      const res = await appCtx.app.inject({
        method: "PUT",
        url: "/api/system/ops-policy",
        payload: {
          desiredRpoSeconds: 3600,
          desiredRetentionDays: 30,
          desiredDrillCadenceDays: 7,
          version: 0,
          reason: "1h rpo",
        },
        cookies: { "auth-token": adminToken3 },
      });
      expect3(res.statusCode).toBe(200);
      const body = res.json();
      expect3(body.compliance.rpo.status).toBe("NOT_SATISFIED");
      // The observed age is measured from the backup's REAL completion (40h),
      // not from the import moment — never a false green.
      const observed = body.compliance.rpo.observed as string; // e.g. "144000s"
      expect3(parseInt(observed, 10)).toBeGreaterThan(3600);
    });

    it("a FAILED operator-declared drill today never satisfies the drill cadence (P1-3)", async () => {
      // Policy intent exists at version 1 (previous test): cadence 7d.
      const ctx = {
        organizationId: orgId3,
        actorId: "test",
        role: "Admin" as const,
        permissions: [],
      };
      // Operator performed a restore drill TODAY and recorded it as FAILED —
      // exactly the case that must not render as "drill done, cadence OK".
      await createBackupEvidenceRepo(appCtx.db).recordDrill(ctx, {
        operationId: "logical-restore:failed-today",
        backupType: "logical",
        result: "failed",
        source: "operator_declared",
        startedAt: new Date(Date.now() - 1800_000),
        completedAt: new Date(),
        failureReason: "restore rejected the archive",
      });

      const res = await appCtx.app.inject({
        method: "GET",
        url: "/api/system/ops-policy",
        cookies: { "auth-token": adminToken3 },
      });
      expect3(res.statusCode).toBe(200);
      const body = res.json();
      // With no successful drill, the status is UNKNOWN — the failed drill is
      // visible through restore-readiness, but it MUST NOT be SATISFIED.
      expect3(body.compliance.drill.status).not.toBe("SATISFIED");
      expect3(body.compliance.drill.status).toBe("UNKNOWN");
    });

    it("drill cadence measures the last SUCCESSFUL drill — an old success outranks a recent failure", async () => {
      // Same org: add a successful drill 40d ago (older than the 7d cadence).
      // The recent failed drill from the previous test must not be measured.
      const ctx = {
        organizationId: orgId3,
        actorId: "test",
        role: "Admin" as const,
        permissions: [],
      };
      const completedAt = new Date(Date.now() - 40 * 86400_000);
      await createBackupEvidenceRepo(appCtx.db).recordDrill(ctx, {
        operationId: "logical-restore:old-success",
        backupType: "logical",
        result: "succeeded",
        source: "automated",
        startedAt: new Date(completedAt.getTime() - 1800_000),
        completedAt,
      });

      const res = await appCtx.app.inject({
        method: "GET",
        url: "/api/system/ops-policy",
        cookies: { "auth-token": adminToken3 },
      });
      expect3(res.statusCode).toBe(200);
      const body = res.json();
      expect3(body.compliance.drill.status).toBe("NOT_SATISFIED");
      // The observed age must come from the 40d-old success, not from the
      // failed drill recorded "today".
      expect3(
        (body.compliance.drill.observed as string).startsWith("40d"),
      ).toBe(true);
    });

    it("a NEWER operator-declared success outranks an OLDER automated success (P7-E review P2)", async () => {
      // Same org as the previous test: the automated success is 40d old (one
      // test earlier). A fresh operator-declared success TODAY is the recency
      // truth — cadence (7d) must be SATISFIED, NOT the false negative that
      // would come from preferring the older automated proof.
      const ctx = {
        organizationId: orgId3,
        actorId: "test",
        role: "Admin" as const,
        permissions: [],
      };
      await createBackupEvidenceRepo(appCtx.db).recordDrill(ctx, {
        operationId: "logical-restore:declared-today",
        backupType: "logical",
        result: "succeeded",
        source: "operator_declared",
        startedAt: new Date(Date.now() - 1800_000),
        completedAt: new Date(),
      });

      const res = await appCtx.app.inject({
        method: "GET",
        url: "/api/system/ops-policy",
        cookies: { "auth-token": adminToken3 },
      });
      expect3(res.statusCode).toBe(200);
      const body = res.json();
      expect3(body.compliance.drill.status).toBe("SATISFIED");
      expect3(body.compliance.drill.observed).toBe("0d ago");
      // The source stays visible on the row that actually satisfied cadence.
      expect3(body.compliance.drill.observedDetail as string).toContain(
        "operator_declared",
      );
    });
  },
);
