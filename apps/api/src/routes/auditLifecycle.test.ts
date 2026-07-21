import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import type { Database } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import {
  cleanupBusinessData,
  cleanupOrganizationTestData,
} from "@exam/db/src/testCleanup.js";

const auditProbe = vi.hoisted(() => {
  let blocker: Promise<void> | null = null;
  let releaseBlocker: (() => void) | null = null;
  let rejectWrite = false;
  let events: string[] = [];
  const waiters = new Map<string, Array<() => void>>();

  return {
    reset(options: { paused: boolean; rejectWrite?: boolean }) {
      blocker = options.paused
        ? new Promise<void>((resolve) => {
            releaseBlocker = resolve;
          })
        : null;
      rejectWrite = options.rejectWrite ?? false;
      events = [];
      waiters.clear();
    },
    mark(event: string) {
      events.push(event);
      for (const resolve of waiters.get(event) ?? []) resolve();
      waiters.delete(event);
    },
    async waitFor(event: string) {
      if (events.includes(event)) return;
      await new Promise<void>((resolve) => {
        const current = waiters.get(event) ?? [];
        current.push(resolve);
        waiters.set(event, current);
      });
    },
    async beforeInsert() {
      if (blocker) await blocker;
      if (rejectWrite) throw new Error("controlled audit failure");
    },
    release() {
      releaseBlocker?.();
      releaseBlocker = null;
      blocker = null;
    },
    snapshot() {
      return [...events];
    },
  };
});

vi.mock("@exam/db/src/repository/auditLogRepo.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@exam/db/src/repository/auditLogRepo.js")
    >();
  return {
    ...actual,
    createAuditLogWriter(db: Database) {
      const writer = actual.createAuditLogWriter<string>(db);
      return {
        async insert(...args: Parameters<typeof writer.insert>) {
          auditProbe.mark("AUDIT_INSERT_STARTED");
          try {
            await auditProbe.beforeInsert();
            await writer.insert(...args);
            auditProbe.mark("AUDIT_INSERT_FINISHED");
          } catch (error) {
            auditProbe.mark("AUDIT_INSERT_REJECTED");
            throw error;
          }
        },
      };
    },
  };
});

const { recordBestEffortAudit } = await import("../audit/auditWriter.js");
const { buildTestApp } = await import("./testHelpers.js");

interface AuditLifecycleView {
  pendingCount(): number;
  isDraining(): boolean;
}

type BuiltTestContext = Awaited<ReturnType<typeof buildTestApp>>;
type AuditAwareTestContext = Omit<BuiltTestContext, "app"> & {
  app: BuiltTestContext["app"] & { auditWrites: AuditLifecycleView };
};

const probeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/audit-probe", async (request) => {
    const organizationId = String(request.headers["x-organization-id"]);
    const targetId = String(request.headers["x-target-id"]);
    auditProbe.mark("AUDIT_SCHEDULED");
    recordBestEffortAudit(
      fastify,
      request,
      {
        actorId: "audit-probe-actor",
        organizationId,
        role: "Admin",
        permissions: [],
        sessionId: "audit-probe-session",
      },
      { action: "logout", targetType: "user", targetId },
    );
    return { accepted: true };
  });
};

async function buildAuditAwareTestApp(): Promise<AuditAwareTestContext> {
  return (await buildTestApp(probeRoutes, {
    prefix: "/api",
  })) as AuditAwareTestContext;
}

async function createOrganization(db: Database) {
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.organizations).values({
    id,
    name: "Audit lifecycle test",
    displayName: "Audit lifecycle test",
    slug: `audit-lifecycle-test-${id}`,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function scheduleAudit(
  ctx: AuditAwareTestContext,
  organizationId: string,
) {
  const targetId = crypto.randomUUID();
  const response = await ctx.app.inject({
    method: "POST",
    url: "/api/audit-probe",
    headers: {
      "x-organization-id": organizationId,
      "x-target-id": targetId,
    },
  });
  auditProbe.mark("HTTP_RESPONSE_RESOLVED");
  expect(response.statusCode).toBe(200);
  await auditProbe.waitFor("AUDIT_INSERT_STARTED");
  return targetId;
}

async function readAuditRows(db: Database, targetId: string) {
  return db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.targetId, targetId));
}

async function waitForDrainStart(ctx: AuditAwareTestContext) {
  for (let turn = 0; turn < 10; turn++) {
    if (ctx.app.auditWrites.isDraining()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("audit drain did not start");
}

describe("tracked audit write lifecycle", () => {
  let ctx: AuditAwareTestContext;

  beforeAll(async () => {
    ctx = await buildAuditAwareTestApp();
  });

  afterAll(async () => {
    await ctx.drainAuditWritesStrict();
    await ctx.cleanup();
  });

  it("keeps the HTTP response non-blocking while drain waits for persistence", async () => {
    auditProbe.reset({ paused: true });
    const organizationId = await createOrganization(ctx.db);
    const targetId = await scheduleAudit(ctx, organizationId);

    expect(auditProbe.snapshot()).not.toContain("AUDIT_INSERT_FINISHED");
    expect(ctx.app.auditWrites.pendingCount()).toBe(1);
    let drained = false;
    const drain = ctx.drainAuditWrites().then(() => {
      drained = true;
    });
    await waitForDrainStart(ctx);
    expect(drained).toBe(false);

    auditProbe.release();
    await drain;
    expect(drained).toBe(true);
    expect(ctx.app.auditWrites.pendingCount()).toBe(0);
    expect(await readAuditRows(ctx.db, targetId)).toHaveLength(1);

    await cleanupOrganizationTestData(ctx.db, organizationId);
  });

  it("drains before business cleanup so the next test cannot see a late row", async () => {
    auditProbe.reset({ paused: true });
    const organizationId = await createOrganization(ctx.db);
    const targetId = await scheduleAudit(ctx, organizationId);
    let cleanupStarted = false;

    const cleanup = ctx.drainAuditWritesStrict().then(async () => {
      cleanupStarted = true;
      await cleanupBusinessData(ctx.db, organizationId);
    });
    await waitForDrainStart(ctx);
    expect(cleanupStarted).toBe(false);

    auditProbe.release();
    await cleanup;
    expect(await readAuditRows(ctx.db, targetId)).toEqual([]);

    await cleanupOrganizationTestData(ctx.db, organizationId);
  });

  it("drains before destructive cleanup so organization deletion cannot race", async () => {
    auditProbe.reset({ paused: true });
    const organizationId = await createOrganization(ctx.db);
    await scheduleAudit(ctx, organizationId);
    let cleanupStarted = false;

    const cleanup = ctx.drainAuditWritesStrict().then(async () => {
      cleanupStarted = true;
      await cleanupOrganizationTestData(ctx.db, organizationId);
    });
    await waitForDrainStart(ctx);
    expect(cleanupStarted).toBe(false);

    auditProbe.release();
    await expect(cleanup).resolves.toBeUndefined();
    const organizations = await ctx.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
    expect(organizations).toEqual([]);
  });

  it("observes audit failure and removes the rejected write from the registry", async () => {
    auditProbe.reset({ paused: false, rejectWrite: true });
    const errorSpy = vi.spyOn(ctx.app.log, "error");
    const targetId = await scheduleAudit(ctx, ctx.org.id);

    await expect(ctx.drainAuditWrites()).resolves.toEqual({
      timedOut: false,
      pendingCount: 0,
    });
    expect(ctx.app.auditWrites.pendingCount()).toBe(0);
    expect(await readAuditRows(ctx.db, targetId)).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "audit-probe-actor",
        action: "logout",
      }),
      "Failed to record best-effort audit observation",
    );
    errorSpy.mockRestore();
  });
});

describe("Fastify close audit barrier", () => {
  it("does not finish app.close until the accepted audit write settles", async () => {
    const ctx = await buildAuditAwareTestApp();
    auditProbe.reset({ paused: true });
    const organizationId = await createOrganization(ctx.db);
    const targetId = await scheduleAudit(ctx, organizationId);
    let closeSettled = false;

    const close = ctx.app.close().then(() => {
      closeSettled = true;
    });
    await waitForDrainStart(ctx);
    expect(closeSettled).toBe(false);

    auditProbe.release();
    await close;
    expect(closeSettled).toBe(true);
    expect(ctx.app.auditWrites.pendingCount()).toBe(0);
    expect(await readAuditRows(ctx.db, targetId)).toHaveLength(1);

    await cleanupOrganizationTestData(ctx.db, organizationId);
    await ctx.cleanup();
  });
});
