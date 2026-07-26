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
 * - Auto-create the initial organization. Bootstrap-admin is the single source
 *   of truth for first organization + first Admin creation.
 *
 * Build entry: `node dist/workers/emailDeliveryWorker.js`
 * Package script: `pnpm --filter @exam/api worker:email`
 */
import { createDatabase } from "@exam/db/src/database.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { createEmailOutboxRepo } from "@exam/db/src/repository/emailOutboxRepo.js";
import {
  createWorkerHeartbeatRepo,
  type WorkerHeartbeatRepo,
} from "@exam/db/src/repository/workerHeartbeatRepo.js";
import type { EmailSender, Organization } from "@exam/domain";
import { createEmailSender } from "../email/senders.js";
import { EmailOutboxService } from "../email/outboxService.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Constants ──────────────────────────────────────────────────────

const WORKER_NAME = "email-delivery";

export const BOOTSTRAP_PENDING_MESSAGE =
  "bootstrap_pending: initial organization not initialized";

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

export type LogFn = typeof log;

// ── Types ───────────────────────────────────────────────────────────

type OrganizationRepo = ReturnType<typeof createOrganizationRepo>;

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

// ── Bootstrap wait ──────────────────────────────────────────────────

export interface WaitForSingleOrganizationDeps {
  orgRepo: Pick<OrganizationRepo, "resolveOptionalBrandingTenant">;
  heartbeatRepo: Pick<WorkerHeartbeatRepo, "upsert">;
  workerInstanceId: string;
  pollIntervalMs: number;
  isShuttingDown: () => boolean;
  sleep: (ms: number) => Promise<void>;
  log: LogFn;
}

/**
 * Waits until exactly one organization exists in the database.
 *
 * - 0 organizations: writes a `bootstrap_pending` heartbeat and sleeps.
 * - 1 organization: returns it and proceeds to the poll loop.
 * - >1 organizations: throws (fatal configuration error).
 *
 * The worker does NOT create the organization itself; `bootstrap-admin` is the
 * only authority for first organization creation.
 */
export async function waitForSingleOrganization(
  deps: WaitForSingleOrganizationDeps,
): Promise<Organization | null> {
  let pendingLogged = false;

  while (!deps.isShuttingDown()) {
    const organization = await deps.orgRepo.resolveOptionalBrandingTenant({
      purpose: "public_branding",
    });

    if (organization) {
      deps.log("info", "resolved default organization", {
        organizationId: organization.id,
      });
      return organization;
    }

    try {
      await deps.heartbeatRepo.upsert({
        workerName: WORKER_NAME,
        workerInstanceId: deps.workerInstanceId,
        lastPollAt: new Date(),
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: BOOTSTRAP_PENDING_MESSAGE,
      });
    } catch (err) {
      deps.log("warn", "heartbeat write failed (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (!pendingLogged) {
      deps.log("warn", "waiting for initial organization bootstrap");
      pendingLogged = true;
    }

    await deps.sleep(deps.pollIntervalMs);
  }

  return null;
}

// ── Main ────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
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

  // Register signal handlers early so SIGTERM during migration or bootstrap
  // wait is still observed.
  setupShutdown();

  // 1. Database connection
  log("info", "connecting to database", {
    databaseUrl: config.database.url.replace(/\/\/.*@/, "//***@"),
  });
  const conn = await createDatabase(config.database.url);
  const { db, sql } = conn;
  let sender: EmailSender | undefined;

  try {
    // Run migrations (the worker needs the latest schema)
    log("info", "running migrations");
    await migratePostgres(db);

    // 2. Wait for the single internal organization to be bootstrapped.
    const orgRepo = createOrganizationRepo(db);
    const heartbeatRepo = createWorkerHeartbeatRepo(db);
    const organization = await waitForSingleOrganization({
      orgRepo,
      heartbeatRepo,
      workerInstanceId,
      pollIntervalMs: POLL_INTERVAL_MS,
      isShuttingDown: () => shuttingDown,
      sleep,
      log,
    });

    if (!organization) {
      log("info", "shutting down before initial organization was bootstrapped");
      return;
    }

    const organizationId = organization.id;
    const orgScope = { organizationId };

    // 3. Build sender
    log("info", "creating email sender", {
      enabled: config.email.enabled,
      transport: config.email.transport,
    });
    sender = createEmailSender({
      enabled: config.email.enabled,
      transport: config.email.transport,
      from: config.email.from,
      fromName: config.email.fromName,
      fakeMode: config.email.fakeMode,
      smtp: config.email.smtp,
    });

    // 4. Create repositories and service
    const outboxRepo = createEmailOutboxRepo(db);
    const outboxService = new EmailOutboxService({
      repo: outboxRepo,
      ctx: orgScope,
      sender,
      retryBaseSeconds: config.email.retryBaseSeconds,
      scrubSecrets: config.email.smtp?.password
        ? [config.email.smtp.password]
        : [],
    });

    // 5. Main poll loop
    log("info", "starting poll loop", {
      pollIntervalMs: POLL_INTERVAL_MS,
      batchSize: DEFAULT_BATCH_SIZE,
      lockTimeoutMs: LOCK_TIMEOUT_MS,
    });

    while (!shuttingDown) {
      const pollStart = new Date();

      try {
        // 5a. Recover abandoned processing rows
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

        // 5b. Claim and process due rows
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

        // 5c. Persist heartbeat (lastSuccessAt = every successful poll)
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

      // 5d. Wait for next poll interval (unless shutting down)
      if (!shuttingDown) {
        await sleep(POLL_INTERVAL_MS);
      }
    }
  } finally {
    // 6. Shutdown: close sender (best-effort) then DB connection.
    if (sender) {
      try {
        await sender.close?.();
      } catch (err) {
        log("error", "sender close error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    log("info", "closing database connection");
    await sql.end();
    log("info", "shutdown complete");
  }
}

export function interruptibleSleep(
  ms: number,
  isShuttingDown: () => boolean,
): Promise<void> {
  return new Promise((resolvePromise) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shutdownCheck: ReturnType<typeof setInterval> | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;

      if (timer !== undefined) clearTimeout(timer);
      if (shutdownCheck !== undefined) clearInterval(shutdownCheck);

      resolvePromise();
    };

    timer = setTimeout(finish, ms);
    shutdownCheck = setInterval(() => {
      if (isShuttingDown()) finish();
    }, 200);

    timer.unref?.();
    shutdownCheck.unref?.();
  });
}

function sleep(ms: number): Promise<void> {
  return interruptibleSleep(ms, () => shuttingDown);
}

// ── Entry ───────────────────────────────────────────────────────────

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  void main().catch((err) => {
    log("error", "worker failed to start", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
  });
}
