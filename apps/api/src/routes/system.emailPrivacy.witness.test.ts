import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { hashPassword } from "@exam/auth/password";
import { signJWT } from "@exam/auth/session";
import { workerHeartbeats, schema } from "@exam/db/schema/pg";
import type { TestContext } from "./testHelpers.js";
import { buildTestApp } from "./testHelpers.js";
import systemRoutes from "./system.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import {
  BOOTSTRAP_PENDING_MESSAGE,
  UNDISCLOSED_EMAIL_ERROR,
} from "../email/sanitizeError.js";

/**
 * #1012 RED witnesses for the diagnostics historical projection — the ⑥
 * layer. A DIRTY historical `worker_heartbeats.last_error` row (written
 * directly via SQL, exactly what an older/rolling-upgrade worker would have
 * persisted) must not project its free text through
 * GET /system/diagnostics.
 *
 * The row goes through the REAL route + DiagnosticsResponseSchema
 * serialization; the assertion targets the raw HTTP body bytes.
 */

const M_SQL = "RED1012-SELECT-grade-FROM-attempts";
const M_BIND = "RED1012-bind-$1::uuid";
const M_SECRET = "RED1012-smtp-secret-9f1zq";
const M_RCPT = "red1012-candidate@example.invalid";
const M_ANSWER = "RED1012-answer-B";

const DIRTY_LAST_ERROR = `legacy worker failure: sql=${M_SQL} bind=${M_BIND} secret=${M_SECRET} rcpt=${M_RCPT} answer=${M_ANSWER}`;

const MARKERS = [M_SQL, M_BIND, M_SECRET, M_RCPT, M_ANSWER];

async function cleanupWorkerHeartbeats(db: TestContext["db"]) {
  await db
    .delete(workerHeartbeats)
    .where(eq(workerHeartbeats.workerName, "email-delivery"));
}

function restoreEmailEnabled(prevEnabled: string | undefined) {
  if (prevEnabled === undefined) {
    delete process.env.EMAIL_ENABLED;
  } else {
    process.env.EMAIL_ENABLED = prevEnabled;
  }
  resetRuntimeConfigForTest();
}

describe("GET /system/diagnostics — #1012 RED witnesses (historical lastError projection)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp(systemRoutes);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("witness: a dirty historical worker_heartbeats.last_error row projects verbatim into the diagnostics response", async () => {
    const prevEnabled = process.env.EMAIL_ENABLED;
    process.env.EMAIL_ENABLED = "true";
    resetRuntimeConfigForTest();

    try {
      // Direct SQL seed: historical rows must be treated as untrusted input.
      // This fixture deliberately does NOT pass through any sanitizer.
      await ctx.db.insert(workerHeartbeats).values({
        id: randomUUID(),
        workerName: "email-delivery",
        workerInstanceId: "legacy-dirty-worker-red1012",
        lastPollAt: new Date(),
        lastSuccessAt: null,
        lastErrorAt: new Date(),
        lastError: DIRTY_LAST_ERROR,
      });

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.adminToken },
      });

      expect(res.statusCode).toBe(200);
      // GUARD: the privacy projection must not turn a failing worker healthy.
      const body = res.json();
      expect(body.emailStatus.worker.status).toBe("degraded");

      // RED core: no marker may survive into the serialized response bytes.
      const leaked = MARKERS.filter((m) => res.body.includes(m));
      expect(
        leaked,
        `historical markers projected through diagnostics: ${leaked.join(", ")}\nworker.lastError: ${body.emailStatus.worker.lastError}`,
      ).toEqual([]);

      // RED core: the projection is byte-for-byte verbatim today.
      expect(body.emailStatus.worker.lastError).not.toBe(DIRTY_LAST_ERROR);
    } finally {
      await cleanupWorkerHeartbeats(ctx.db);
      restoreEmailEnabled(prevEnabled);
    }
  });

  it("GUARD: a null lastError heartbeat still projects as null (the no-error contract is not the privacy fix's business)", async () => {
    const prevEnabled = process.env.EMAIL_ENABLED;
    process.env.EMAIL_ENABLED = "true";
    resetRuntimeConfigForTest();

    try {
      const now = new Date();
      await ctx.db.insert(workerHeartbeats).values({
        id: randomUUID(),
        workerName: "email-delivery",
        workerInstanceId: "available-guard-red1012",
        lastPollAt: now,
        lastSuccessAt: now,
        lastErrorAt: null,
        lastError: null,
      });

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.adminToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.emailStatus.worker.status).toBe("available");
      expect(body.emailStatus.worker.lastError).toBeNull();
    } finally {
      await cleanupWorkerHeartbeats(ctx.db);
      restoreEmailEnabled(prevEnabled);
    }
  });

  // ── B3: every stored-value shape is covered through the real route ──

  it("B3: recognized safe values pass the projection through; malformed/empty/overlong values map to the fixed undisclosed label", async () => {
    const prevEnabled = process.env.EMAIL_ENABLED;
    process.env.EMAIL_ENABLED = "true";
    resetRuntimeConfigForTest();

    const cases: Array<{ stored: string; expected: string }> = [
      // Canonical writer output passes through byte-for-byte.
      {
        stored: "email_error:smtp_auth_failed code=EAUTH rc=535",
        expected: "email_error:smtp_auth_failed code=EAUTH rc=535",
      },
      // The fixed bootstrap state is recognized exactly.
      {
        stored: BOOTSTRAP_PENDING_MESSAGE,
        expected: BOOTSTRAP_PENDING_MESSAGE,
      },
      // Empty string is not null — still an error-present row, undisclosed.
      { stored: "", expected: UNDISCLOSED_EMAIL_ERROR },
      // Prefix-plausible but not canonical.
      {
        stored: "email_error:evil_category code=EAUTH",
        expected: UNDISCLOSED_EMAIL_ERROR,
      },
      {
        stored: "email_error:internal_error trailing",
        expected: UNDISCLOSED_EMAIL_ERROR,
      },
      // Overlong junk.
      {
        stored: `legacy failure ${"x".repeat(5000)}`,
        expected: UNDISCLOSED_EMAIL_ERROR,
      },
    ];

    try {
      for (const { stored, expected } of cases) {
        await cleanupWorkerHeartbeats(ctx.db);
        await ctx.db.insert(workerHeartbeats).values({
          id: randomUUID(),
          workerName: "email-delivery",
          workerInstanceId: `b3-shape-${randomUUID().slice(0, 8)}`,
          lastPollAt: new Date(),
          lastSuccessAt: null,
          lastErrorAt: new Date(),
          lastError: stored,
        });
        const res = await ctx.app.inject({
          method: "GET",
          url: "/api/system/diagnostics",
          cookies: { "auth-token": ctx.adminToken },
        });
        expect(res.statusCode, `stored=${stored.slice(0, 40)}`).toBe(200);
        const body = res.json();
        expect(body.emailStatus.worker.lastError).toBe(expected);
        // A non-null stored error keeps the worker degraded — the
        // projection must never turn a failing worker healthy.
        expect(body.emailStatus.worker.status).toBe("degraded");
        expect(body.emailStatus.status).toBe("degraded");
      }
    } finally {
      await cleanupWorkerHeartbeats(ctx.db);
      restoreEmailEnabled(prevEnabled);
    }
  });

  // ── B4: RBAC around the operational projection ─────────────────────

  it("B4: Maintainer sees the operational projection with the same undisclosed label; unauthenticated and no-capability callers stay denied", async () => {
    const prevEnabled = process.env.EMAIL_ENABLED;
    process.env.EMAIL_ENABLED = "true";
    resetRuntimeConfigForTest();

    // Seed a Maintainer (operational viewer, no business-integrity block).
    const now = new Date();
    const maintainerId = randomUUID();
    await ctx.db.insert(schema.users).values({
      id: maintainerId,
      organizationId: ctx.org.id,
      username: `maint-red1012-${maintainerId.slice(0, 8)}`,
      passwordHash: await hashPassword("red1012-pass"),
      name: "Maintainer Witness",
      role: "Maintainer",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      userId: maintainerId,
      role: "Maintainer" as never,
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const maintainerToken = signJWT(
      {
        actorId: maintainerId,
        role: "Maintainer",
        organizationId: ctx.org.id,
        authEpoch: 0,
      },
      getRuntimeConfig().authSecret.jwtSecret,
    );

    try {
      await ctx.db.insert(workerHeartbeats).values({
        id: randomUUID(),
        workerName: "email-delivery",
        workerInstanceId: "maintainer-witness-red1012",
        lastPollAt: new Date(),
        lastSuccessAt: null,
        lastErrorAt: new Date(),
        lastError: DIRTY_LAST_ERROR,
      });

      // Maintainer: operational projection, same privacy, no marker.
      const maintainerRes = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": maintainerToken },
      });
      expect(maintainerRes.statusCode).toBe(200);
      const maintainerBody = maintainerRes.json();
      expect(maintainerBody.emailStatus.worker.lastError).toBe(
        UNDISCLOSED_EMAIL_ERROR,
      );
      const maintainerLeak = MARKERS.filter((m) =>
        maintainerRes.body.includes(m),
      );
      expect(maintainerLeak).toEqual([]);
      expect(maintainerBody.emailStatus.worker.status).toBe("degraded");

      // Unauthenticated: denied.
      const anonRes = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
      });
      expect(anonRes.statusCode).toBe(401);

      // Candidate (no SystemDiagnosticsView): denied.
      const candidateRes = await ctx.app.inject({
        method: "GET",
        url: "/api/system/diagnostics",
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(candidateRes.statusCode).toBe(403);
    } finally {
      await ctx.db
        .delete(schema.users)
        .where(eq(schema.users.id, maintainerId));
      await cleanupWorkerHeartbeats(ctx.db);
      restoreEmailEnabled(prevEnabled);
    }
  });
});
