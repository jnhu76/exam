import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
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
import { getIsolatedTestDb } from "@exam/db/testDb";
import { createOrganizationRepo } from "@exam/db/repository/organizationRepo";
import { emailOutbox, workerHeartbeats } from "@exam/db/schema/pg";
import type { Database } from "@exam/db/types";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import { BOOTSTRAP_PENDING_MESSAGE } from "../email/sanitizeError.js";
import type { NowProvider } from "./now.js";
import emailOutboxLoopPlugin, {
  EMAIL_DELIVERY_WORKER_NAME,
} from "./emailOutboxLoop.js";

/**
 * #1012 RED witnesses for the API-host email loop — the ③ layer: lifecycle
 * catch sites reaching the REAL Pino transport, plus the worker_heartbeats
 * write (⑤) they perform.
 *
 * Unlike emailOutboxLoop.test.ts (logger:false, business-only), this file
 * boots the plugin with a REAL Fastify/Pino logger writing to a capturing
 * stream and asserts the actual serialized JSON bytes. Database assertions
 * read back rows written by the loop into an isolated real PostgreSQL schema.
 *
 * Markers are synthetic (no real credentials, recipients, or SMTP servers).
 */

const permissions: RequestContext["permissions"] = [];

const M_SQL = "RED1012-SELECT-grade-FROM-attempts";
const M_BIND = "RED1012-bind-$1::uuid";
const M_SECRET = "RED1012-smtp-secret-9f1zq";
const M_RCPT = "red1012-candidate@example.invalid";

const MARKERS = [M_SQL, M_BIND, M_SECRET, M_RCPT];

function leakedIn(text: string): string[] {
  return MARKERS.filter((m) => text.includes(m));
}

/** Captures every pino JSON line emitted by the app under test. */
class LogCapture extends Writable {
  readonly lines: string[] = [];
  override _write(
    chunk: Buffer,
    _enc: BufferEncoding,
    done: (err?: Error | null) => void,
  ) {
    this.lines.push(chunk.toString("utf8"));
    done();
  }
  parsed(): Array<Record<string, unknown>> {
    return this.lines
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }
}

function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions,
    sessionId: randomUUID(),
  };
}

async function seedRow(
  db: Database,
  orgId: string,
  overrides: Partial<{
    attemptCount: number;
    maxAttempts: number;
    status: EmailOutboxStatus;
  }> = {},
) {
  const ts = new Date();
  const [row] = await db
    .insert(emailOutbox)
    .values({
      id: randomUUID(),
      organizationId: orgId,
      type: "grade_notification",
      recipientEmail: "to@example.com",
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

async function findHeartbeatWithMarker(db: Database): Promise<string | null> {
  const rows = await db
    .select()
    .from(workerHeartbeats)
    .where(eq(workerHeartbeats.workerName, EMAIL_DELIVERY_WORKER_NAME));
  for (const row of rows) {
    if (row.lastError && MARKERS.some((m) => row.lastError!.includes(m))) {
      return row.lastError;
    }
  }
  return null;
}

/**
 * Bounded predicate poll (the repo's own waitFor pattern): resolves with the
 * matched value, so a later overwrite of the row cannot invalidate the
 * assertion on the captured snapshot.
 */
async function waitForMatch<T>(
  predicate: () => T | null | Promise<T | null>,
  what: string,
  timeoutMs = 10_000,
  stepMs = 25,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matched = await predicate();
    if (matched !== null) return matched;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  throw new Error(`loop condition not met within timeout: ${what}`);
}

function stubSender(
  impl: (message: EmailMessage) => Promise<EmailSendResult>,
): EmailSender {
  return { send: impl };
}

/**
 * The canonical safe-string grammar every error emission must satisfy
 * (#1012 closed field): fixed categories, allowlisted codes, 3-digit
 * validated response codes — nothing else.
 */
const CANONICAL_SAFE_ERROR =
  /^email_error:(smtp_auth_failed|smtp_connection_failed|smtp_recipient_rejected|smtp_send_failed|db_connection_failed|db_error|internal_error)( code=[A-Z0-9_]{2,16})?( rc=\d{3})?$/;

/** No marker byte may appear anywhere in the captured serialized stream. */
function assertNoMarkersInStream(logs: LogCapture) {
  const leaked = leakedIn(logs.lines.join("\n"));
  expect(
    leaked,
    `markers reached the Pino stream: ${leaked.join(", ")}`,
  ).toEqual([]);
}

/** Latest non-bootstrap error heartbeat the loop wrote (snapshot value). */
async function findErrorHeartbeat(db: Database): Promise<string | null> {
  const rows = await db
    .select()
    .from(workerHeartbeats)
    .where(eq(workerHeartbeats.workerName, EMAIL_DELIVERY_WORKER_NAME));
  let latest: string | null = null;
  let latestPoll = 0;
  for (const row of rows) {
    if (
      row.lastError !== null &&
      row.lastError !== BOOTSTRAP_PENDING_MESSAGE &&
      row.lastPollAt.getTime() >= latestPoll
    ) {
      latest = row.lastError;
      latestPoll = row.lastPollAt.getTime();
    }
  }
  return latest;
}

/**
 * DB-boundary fault injection: wraps the real drizzle handle so ONE method
 * (select / update / insert) rejects with the marker error while everything
 * else passes through to real PostgreSQL. This reaches the loop's lifecycle
 * catch sites through their real code paths:
 *  - `update` fails `recoverAbandoned`  -> poll catch (③c)
 *  - `select` fails org resolution      -> supervisor catch (③d)
 *  - `insert` fails the heartbeat write -> writeHeartbeat catch (③b)
 */
function failingDbProxy(
  db: Database,
  method: "select" | "update" | "insert",
  markerError: Error,
): Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === method) {
        return () => {
          throw markerError;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function buildLoopApp(
  db: Database,
  sender: EmailSender,
  logs: LogCapture,
  shutdownTimeoutMs = 1000,
) {
  process.env.EMAIL_WORKER_POLL_INTERVAL_MS = "2000";
  process.env.EMAIL_WORKER_BATCH_SIZE = "10";
  process.env.EMAIL_WORKER_LOCK_TIMEOUT_MS = "30000";
  process.env.EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS = String(shutdownTimeoutMs);
  resetRuntimeConfigForTest();

  // REAL pino: Fastify instantiates its production logger with this options
  // object; serialization of the loop's log() payloads happens in pino, and
  // the capture stream receives the exact bytes pino emitted.
  const app = Fastify({ logger: { level: "info", stream: logs } });
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

describe("emailOutboxLoop plugin — #1012 RED witnesses (real Pino bytes)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let ctx: RequestContext;
  let savedEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    savedEnv = Object.fromEntries(
      LOOP_ENV_KEYS.map((key) => [key, process.env[key]]),
    );
    const result = await getIsolatedTestDb("api-email-loop-witness");
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
  }, 30_000);

  afterAll(async () => {
    for (const key of LOOP_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key]!;
    }
    resetRuntimeConfigForTest();
    await cleanup();
  }, 30_000);

  it("witness: dead-letter transition logs the provider's free text through real Pino and persists it into email_outbox.last_error", async () => {
    const logs = new LogCapture();
    // attemptCount seeded at maxAttempts so the first failed send is terminal.
    const deadRow = await seedRow(db, ctx.organizationId, {
      attemptCount: 3,
      maxAttempts: 3,
    });
    const sender = stubSender(async () => {
      throw new Error(
        `provider echoed: sql=${M_SQL} bind=${M_BIND} secret=${M_SECRET} rcpt=${M_RCPT}`,
      );
    });
    const app = await buildLoopApp(db, sender, logs);

    try {
      await waitForMatch(
        async () =>
          (await getRow(db, deadRow.id)).status === "dead" ? true : null,
        "row reaches dead",
      );

      // The persisted value read back from PostgreSQL.
      const dead = await getRow(db, deadRow.id);
      const persistedLeak = leakedIn(dead.lastError ?? "");
      expect(
        persistedLeak,
        `markers persisted into email_outbox.last_error: ${persistedLeak.join(", ")}\nlastError: ${dead.lastError}`,
      ).toEqual([]);

      // The dead-letter terminal line as serialized by real Pino.
      const deadLetterLine = await waitForMatch(() => {
        const line = logs
          .parsed()
          .find(
            (l) =>
              l.level === 50 &&
              String(l.msg ?? "").includes("Email delivery failed permanently"),
          );
        return line ?? null;
      }, "dead-letter pino line");
      const serialized = JSON.stringify(deadLetterLine);
      const logLeak = leakedIn(serialized);
      expect(
        logLeak,
        `markers reached the Pino dead-letter line: ${logLeak.join(", ")}\nline: ${serialized}`,
      ).toEqual([]);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("GREEN-target: a hostile `message` getter is CONTAINED in the per-row catch — no poll failure, canonical lastError, nothing escapes to Pino", async () => {
    const logs = new LogCapture();
    const row = await seedRow(db, ctx.organizationId);
    const hostile = new Error("placeholder");
    Object.defineProperty(hostile, "message", {
      get() {
        // Reading .message throws — exactly the "异常 getter" boundary; the
        // thrown text carries the synthetic provider dump markers.
        throw new Error(
          `getter exploded: sql=${M_SQL} bind=${M_BIND} rcpt=${M_RCPT}`,
        );
      },
    });
    const sender = stubSender(async () => {
      throw hostile;
    });
    const app = await buildLoopApp(db, sender, logs);

    try {
      await waitForMatch(
        async () =>
          (await getRow(db, row.id)).status === "retry_wait" ? true : null,
        "row reaches retry_wait (failure contained in-band)",
      );
      const updated = await getRow(db, row.id);
      expect(updated.lastError).toMatch(CANONICAL_SAFE_ERROR);
      const leaked = leakedIn(updated.lastError ?? "");
      expect(
        leaked,
        `markers persisted into email_outbox.last_error: ${leaked.join(", ")}\nlastError: ${updated.lastError}`,
      ).toEqual([]);

      // The containment means NO lifecycle catch fired while processing the
      // row: no error-level Pino line may exist at this point.
      const errorLines = logs.parsed().filter((l) => l.level === 50);
      expect(
        errorLines,
        `expected no error-level line while the hostile error was contained:\n${logs.lines.join("\n")}`,
      ).toEqual([]);
      assertNoMarkersInStream(logs);
      // And no heartbeat ever carried a marker.
      expect(await findHeartbeatWithMarker(db)).toBeNull();
    } finally {
      await app.close();
    }
  }, 30_000);

  it("GREEN-target: a marker DB failure inside the poll reaches the poll catch — safe bytes through real Pino and a canonical heartbeat lastError (③c + ⑤)", async () => {
    const logs = new LogCapture();
    const marker = new Error(
      `recover failed: sql=${M_SQL} bind=${M_BIND} secret=${M_SECRET}`,
    );
    const app = await buildLoopApp(
      failingDbProxy(db, "update", marker),
      stubSender(async () => ({ providerMessageId: null })),
      logs,
    );

    try {
      const pollLine = await waitForMatch(() => {
        const line = logs
          .parsed()
          .find(
            (l) =>
              l.level === 50 && String(l.msg ?? "") === "poll cycle failed",
          );
        return line ?? null;
      }, "poll cycle failed pino line");
      expect(String(pollLine.error)).toMatch(CANONICAL_SAFE_ERROR);
      assertNoMarkersInStream(logs);

      const heartbeatError = await waitForMatch(
        () => findErrorHeartbeat(db),
        "error heartbeat written by the poll catch",
      );
      expect(heartbeatError).toMatch(CANONICAL_SAFE_ERROR);
      expect(leakedIn(heartbeatError ?? "")).toEqual([]);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("GREEN-target: a marker DB failure while resolving the organization reaches the supervisor catch — safe Pino bytes and a canonical heartbeat (③d + ⑤)", async () => {
    const logs = new LogCapture();
    const marker = new Error(
      `org resolve failed: sql=${M_SQL} bind=${M_BIND} secret=${M_SECRET}`,
    );
    const app = await buildLoopApp(
      failingDbProxy(db, "select", marker),
      stubSender(async () => ({ providerMessageId: null })),
      logs,
    );

    try {
      const crashLine = await waitForMatch(() => {
        const line = logs
          .parsed()
          .find(
            (l) =>
              l.level === 50 &&
              String(l.msg ?? "").includes("email outbox loop crashed"),
          );
        return line ?? null;
      }, "supervisor crash pino line");
      expect(String(crashLine.error)).toMatch(CANONICAL_SAFE_ERROR);
      assertNoMarkersInStream(logs);

      const heartbeatError = await waitForMatch(
        () => findErrorHeartbeat(db),
        "error heartbeat written by the supervisor catch",
      );
      expect(heartbeatError).toMatch(CANONICAL_SAFE_ERROR);
      expect(leakedIn(heartbeatError ?? "")).toEqual([]);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("GREEN-target: a marker heartbeat-write failure logs the safe classification only (③b)", async () => {
    const logs = new LogCapture();
    const marker = new Error(
      `heartbeat insert failed: sql=${M_SQL} bind=${M_BIND} secret=${M_SECRET}`,
    );
    const app = await buildLoopApp(
      failingDbProxy(db, "insert", marker),
      stubSender(async () => ({ providerMessageId: null })),
      logs,
    );

    try {
      const warnLine = await waitForMatch(() => {
        const line = logs
          .parsed()
          .find(
            (l) =>
              l.level === 40 &&
              String(l.msg ?? "") === "heartbeat write failed (non-fatal)",
          );
        return line ?? null;
      }, "heartbeat write failure warn line");
      expect(String(warnLine.error)).toMatch(CANONICAL_SAFE_ERROR);
      // The poll itself succeeded — no error-level line may exist.
      expect(logs.parsed().filter((l) => l.level === 50)).toEqual([]);
      assertNoMarkersInStream(logs);
    } finally {
      await app.close();
    }
  }, 30_000);
});
