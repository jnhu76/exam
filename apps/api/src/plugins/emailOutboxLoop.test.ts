import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import type {
  EmailMessage,
  EmailOutboxStatus,
  EmailSendResult,
  EmailSender,
  RequestContext,
} from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { emailOutbox, workerHeartbeats } from "@exam/db/src/schema/pg.js";
import type { Database } from "@exam/db/src/types.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import type { NowProvider } from "./now.js";
import emailOutboxLoopPlugin, {
  EMAIL_DELIVERY_WORKER_NAME,
} from "./emailOutboxLoop.js";

const permissions: RequestContext["permissions"] = [];

function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions,
    sessionId: randomUUID(),
  };
}

/** Inserts an outbox row with arbitrary pre-state for loop tests. */
async function seedRow(
  db: Database,
  orgId: string,
  overrides: Partial<{
    attemptCount: number;
    maxAttempts: number;
    status: EmailOutboxStatus;
    recipientEmail: string;
  }> = {},
) {
  const ts = new Date();
  const [row] = await db
    .insert(emailOutbox)
    .values({
      id: randomUUID(),
      organizationId: orgId,
      type: "test_email",
      recipientEmail: overrides.recipientEmail ?? "to@example.com",
      subject: "s",
      bodyText: "t",
      bodyHtml: null,
      status: overrides.status ?? "pending",
      attemptCount: overrides.attemptCount ?? 0,
      maxAttempts: overrides.maxAttempts ?? 3,
      lastError: null,
      nextAttemptAt: null,
      lockedAt: null,
      lockedBy: null,
      providerMessageId: null,
      dedupeKey: null,
      sentAt: null,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning();
  return row!;
}

async function getRow(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.id, id));
  return row!;
}

async function getHeartbeats(db: Database) {
  return db
    .select()
    .from(workerHeartbeats)
    .where(eq(workerHeartbeats.workerName, EMAIL_DELIVERY_WORKER_NAME));
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 10000,
  stepMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  throw new Error("loop condition not met within timeout");
}

function stubSender(
  impl: (message: EmailMessage) => Promise<EmailSendResult>,
): EmailSender {
  return { send: impl };
}

/** Builds a Fastify instance with the loop plugin against an isolated test DB. */
async function buildLoopApp(
  db: Database,
  sender: EmailSender,
  shutdownTimeoutMs = 1000,
) {
  process.env.EMAIL_WORKER_POLL_INTERVAL_MS = "25";
  process.env.EMAIL_WORKER_BATCH_SIZE = "10";
  process.env.EMAIL_WORKER_LOCK_TIMEOUT_MS = "30000";
  process.env.EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS = String(shutdownTimeoutMs);
  resetRuntimeConfigForTest();

  const app = Fastify({ logger: false });
  app.decorate<Database>("db", db);
  app.decorate<NowProvider>("now", () => new Date());
  app.decorate<EmailSender>("emailSender", sender);
  await app.register(emailOutboxLoopPlugin);
  await app.ready();
  return app;
}

const LOOP_ENV_KEYS = [
  "EMAIL_WORKER_POLL_INTERVAL_MS",
  "EMAIL_WORKER_BATCH_SIZE",
  "EMAIL_WORKER_LOCK_TIMEOUT_MS",
  "EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS",
];

describe("emailOutboxLoop plugin", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let ctx: RequestContext;
  let savedEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    savedEnv = Object.fromEntries(
      LOOP_ENV_KEYS.map((key) => [key, process.env[key]]),
    );
    const result = await getIsolatedTestDb("api-email-outbox-loop");
    db = result.db;
    cleanup = result.cleanup;
    const organizationRepo = createOrganizationRepo(db);
    const org = await organizationRepo.create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions,
        sessionId: "s",
      },
      {
        name: "org",
        displayName: "Org",
        slug: `slug-${randomUUID().slice(0, 8)}`,
      },
    );
    ctx = createContext(org.id);
  });

  afterAll(async () => {
    for (const key of LOOP_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key]!;
    }
    resetRuntimeConfigForTest();
    await cleanup();
  });

  it("delivers a pending row through the loop and writes a success heartbeat", async () => {
    const sentMessages: EmailMessage[] = [];
    const sender = stubSender(async (message) => {
      sentMessages.push(message);
      return { providerMessageId: `mid-${sentMessages.length}` };
    });
    const row = await seedRow(db, ctx.organizationId);
    const app = await buildLoopApp(db, sender);

    try {
      await waitFor(async () => (await getRow(db, row.id)).status === "sent");
      const heartbeats = await getHeartbeats(db);
      expect(heartbeats.length).toBe(1);
      expect(heartbeats[0]!.lastSuccessAt).not.toBeNull();
      expect(heartbeats[0]!.lastError).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("stops cleanly on close; rows enqueued afterwards stay pending", async () => {
    const sender = stubSender(async () => ({ providerMessageId: "mid" }));
    const app = await buildLoopApp(db, sender);
    await waitFor(async () => (await getHeartbeats(db)).length > 0);
    await app.close();

    const row = await seedRow(db, ctx.organizationId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await getRow(db, row.id)).status).toBe("pending");
  });

  it("bounds shutdown: an in-flight send is abandoned past the shutdown timeout", async () => {
    const sender = stubSender(
      () => new Promise<EmailSendResult>(() => undefined),
    );
    const row = await seedRow(db, ctx.organizationId);
    const app = await buildLoopApp(db, sender, 150);
    await waitFor(
      async () => (await getRow(db, row.id)).status === "processing",
    );

    const startedAt = Date.now();
    await app.close();
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(5000);
    expect((await getRow(db, row.id)).status).toBe("processing");
  });

  it("marks a row dead when the sender keeps failing and the loop keeps running", async () => {
    // attemptCount seeded at maxAttempts so the first failed send is terminal
    // (the claim increments attemptCount; >= maxAttempts marks dead immediately).
    const deadRow = await seedRow(db, ctx.organizationId, {
      attemptCount: 3,
      maxAttempts: 3,
      recipientEmail: "poisoned@example.com",
    });
    let sendCalls = 0;
    const sender = stubSender(async (message) => {
      sendCalls += 1;
      if (message.to === "poisoned@example.com") {
        throw new Error("smtp unavailable");
      }
      return { providerMessageId: `mid-${sendCalls}` };
    });
    const app = await buildLoopApp(db, sender);

    try {
      await waitFor(
        async () => (await getRow(db, deadRow.id)).status === "dead",
        10000,
      );
      const dead = await getRow(db, deadRow.id);
      expect(dead.lastError).toContain("smtp unavailable");

      // The loop must survive the failure: a later row still gets delivered.
      const followupRow = await seedRow(db, ctx.organizationId);
      await waitFor(
        async () => (await getRow(db, followupRow.id)).status === "sent",
        10000,
      );
      expect(sendCalls).toBeGreaterThanOrEqual(2);
    } finally {
      await app.close();
    }
  }, 20000);
});
