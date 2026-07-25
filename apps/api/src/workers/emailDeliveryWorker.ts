/**
 * Email Delivery Worker — P5-0 independent process entrypoint.
 *
 * This worker is a standalone Node.js process that:
 * 1. Resolves the default organization from PostgreSQL at startup.
 * 2. Claims due email outbox rows atomically (FOR UPDATE SKIP LOCKED).
 * 3. Sends each claimed row through the configured EmailSender.
 * 4. Persists a PostgreSQL heartbeat after each poll cycle.
 * 5. Handles graceful shutdown on SIGTERM/SIGINT.
 *
 * It does NOT:
 * - Import or start Fastify.
 * - Construct an authenticated Admin context or JWT.
 * - Use HTTP, Redis, or any process-local shared state.
 * - Depend on bundler auto-discovery of files not imported by the server.
 *
 * Build entry: `node dist/workers/emailDeliveryWorker.js`
 * Package script: `pnpm --filter @exam/api worker:email`
 */
import { createDatabase } from "@exam/db/src/database.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { createEmailOutboxRepo } from "@exam/db/src/repository/emailOutboxRepo.js";
import { createWorkerHeartbeatRepo } from "@exam/db/src/repository/workerHeartbeatRepo.js";
import { createEmailSender } from "../email/senders.js";
import { EmailOutboxService } from "../email/outboxService.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

// ── Constants ──────────────────────────────────────────────────────

const WORKER_NAME = "email-delivery";

// ── State ───────────────────────────────────────────────────────────

let shuttingDown = false;

// ── Logger ──────────────────────────────────────────────────────────

function log(level: string, msg: string, meta?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    worker: WORKER_NAME,
    msg,
    ...meta,
  };
  if (level === "error") {
    process.stderr.write(JSON.stringify(entry) + "\n");
  } else {
    process.stdout.write(JSON.stringify(entry) + "\n");
  }
}

// ── Shutdown handling ───────────────────────────────────────────────

/**
 * Registers signal handlers that set the `shuttingDown` flag and interrupt
 * the poll-loop sleep. The actual resource cleanup happens in `main()` after
 * the current poll cycle finishes — NOT in the signal handler itself.
 */
function setupShutdown(): void {
  const handleSignal = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", `received ${signal}, will shutdown after current poll`);
  };

  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("info", "email delivery worker starting");

  const config = getRuntimeConfig();
  const workerInstanceId = `${hostname()}-${process.pid}-${randomUUID()}`;
  const {
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: DEFAULT_BATCH_SIZE,
    lockTimeoutMs: LOCK_TIMEOUT_MS,
  } = config.emailWorker;

  log("info", "worker identity", {
    workerName: WORKER_NAME,
    workerInstanceId,
  });

  // 1. Database connection
  log("info", "connecting to database", {
    databaseUrl: config.database.url.replace(/\/\/.*@/, "//***@"),
  });
  const conn = await createDatabase(config.database.url);
  const { db, sql } = conn;

  // Run migrations (the worker needs the latest schema)
  log("info", "running migrations");
  await migratePostgres(db);

  // 2. Resolve default organization (no Admin context — uses branding resolver)
  const orgRepo = createOrganizationRepo(db);
  const defaultOrg = await orgRepo.resolveBrandingTenant({
    purpose: "public_branding",
  });

  const organizationId = defaultOrg.id;
  const orgScope = { organizationId };
  log("info", "resolved default organization", { organizationId });

  // 3. Build sender
  log("info", "creating email sender", {
    enabled: config.email.enabled,
    transport: config.email.transport,
  });
  const sender = createEmailSender({
    enabled: config.email.enabled,
    transport: config.email.transport,
    from: config.email.from,
    fromName: config.email.fromName,
    fakeMode: config.email.fakeMode,
    smtp: config.email.smtp,
  });

  // 4. Create repositories and service
  const outboxRepo = createEmailOutboxRepo(db);
  const heartbeatRepo = createWorkerHeartbeatRepo(db);
  const outboxService = new EmailOutboxService({
    repo: outboxRepo,
    ctx: orgScope,
    sender,
    retryBaseSeconds: config.email.retryBaseSeconds,
    scrubSecrets: config.email.smtp?.password
      ? [config.email.smtp.password]
      : [],
  });

  // 5. Setup graceful shutdown (signal handler only sets the flag)
  setupShutdown();

  // 6. Main poll loop
  log("info", "starting poll loop", {
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: DEFAULT_BATCH_SIZE,
    lockTimeoutMs: LOCK_TIMEOUT_MS,
  });

  while (!shuttingDown) {
    const pollStart = new Date();

    try {
      // 6a. Recover abandoned processing rows
      const recovered = await outboxRepo.recoverAbandoned(
        orgScope,
        pollStart,
        LOCK_TIMEOUT_MS,
      );
      if (recovered > 0) {
        log("warn", "recovered abandoned processing rows", {
          count: recovered,
        });
      }

      // 6b. Claim and process due rows
      const result = await outboxService.processDueEmails({
        now: pollStart,
        limit: DEFAULT_BATCH_SIZE,
        workerInstanceId,
      });

      if (result.processed > 0) {
        log("info", "poll cycle completed", {
          processed: result.processed,
          sent: result.sent,
          retryWait: result.retryWait,
          dead: result.dead,
          ownershipLost: result.ownershipLost,
        });
      }

      // 6c. Persist heartbeat (lastSuccessAt = every successful poll)
      try {
        await heartbeatRepo.upsert({
          workerName: WORKER_NAME,
          workerInstanceId,
          lastPollAt: pollStart,
          lastSuccessAt: pollStart,
          lastErrorAt: null,
          lastError: null,
        });
      } catch (err) {
        log("warn", "heartbeat write failed (non-fatal)", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      log("error", "poll cycle failed", {
        error: err instanceof Error ? err.message : String(err),
      });

      // Persist error heartbeat
      try {
        await heartbeatRepo.upsert({
          workerName: WORKER_NAME,
          workerInstanceId,
          lastPollAt: new Date(),
          lastSuccessAt: null,
          lastErrorAt: new Date(),
          lastError: err instanceof Error ? err.message : String(err),
        });
      } catch {
        // heartbeat write failure is non-fatal
      }
    }

    // 6d. Wait for next poll interval (unless shutting down)
    if (!shuttingDown) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  // 7. Shutdown: current poll cycle has finished; close resources.
  log("info", "shutting down — closing sender");
  try {
    await sender.close?.();
  } catch (err) {
    log("error", "sender close error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  log("info", "closing database connection");
  await sql.end();
  log("info", "shutdown complete");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Allow interruption on shutdown
    const checkShutdown = setInterval(() => {
      if (shuttingDown) {
        clearInterval(checkShutdown);
        clearTimeout(timer);
        resolve();
      }
    }, 200);
    timer.unref();
    checkShutdown.unref();
  });
}

// ── Entry ───────────────────────────────────────────────────────────

main().catch((err) => {
  log("error", "worker failed to start", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
