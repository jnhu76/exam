/**
 * Email Delivery Worker — independent process entrypoint (`node
 * dist/workers/emailDeliveryWorker.js`).
 *
 * It does NOT import or start Fastify, does NOT use HTTP or Redis, holds no
 * process-local shared state, and never auto-creates the initial organization:
 * `bootstrap-admin` is the single source of truth for first organization + first
 * Admin creation.
 *
 * Build entry: `node dist/workers/emailDeliveryWorker.js`
 * Package script: `pnpm --filter @exam/api worker:email`
 */
import { createDatabase } from "@exam/db/database";
import { createOrganizationRepo } from "@exam/db/repository/organizationRepo";
import { createEmailOutboxRepo } from "@exam/db/repository/emailOutboxRepo";
import {
  createWorkerHeartbeatRepo,
  type WorkerHeartbeatRepo,
} from "@exam/db/repository/workerHeartbeatRepo";
import type { EmailSender, Organization } from "@exam/domain";
import { createEmailSender } from "../email/senders.js";
import { EmailOutboxService } from "../email/outboxService.js";
import {
  BOOTSTRAP_PENDING_MESSAGE,
  sanitizeEmailError,
} from "../email/sanitizeError.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { migratePostgres } from "@exam/db/postgres";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Constants ──────────────────────────────────────────────────────

const WORKER_NAME = "email-delivery";

// #1012: the fixed bootstrap state label lives in the email privacy policy
// (email/sanitizeError.ts) so the diagnostics read-side projection can
// recognize it without importing this worker entry. Re-exported here for the
// existing importers.
export { BOOTSTRAP_PENDING_MESSAGE };

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
      // #1012: lifecycle failures carry the safe classification only.
      deps.log("warn", "heartbeat write failed (non-fatal)", {
        error: sanitizeEmailError(err),
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
  // #1012: the URL itself is not printed. Masking only the userinfo left the
  // database name, query, and path bytes in the log; a connection target is
  // deployment configuration, not an observable an unprivileged log reader
  // should see.
  log("info", "connecting to database");
  const conn = await createDatabase(config.database.url);
  const { db, sql } = conn;
  let sender: EmailSender | undefined;

  try {
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
      fakeDelayMs: config.email.fakeDelayMs,
      smtp: config.email.smtp,
    });

    // 4. Create repositories and service
    const outboxRepo = createEmailOutboxRepo(db);
    const outboxService = new EmailOutboxService({
      repo: outboxRepo,
      ctx: orgScope,
      sender,
      retryBaseSeconds: config.email.retryBaseSeconds,
      // #800: dead-letter transitions surface as error-level lines on the
      // worker's structured stdout log.
      logger: {
        error: (obj, msg) => log("error", msg, obj),
      },
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
            error: sanitizeEmailError(err),
          });
        }
      } catch (err) {
        // #1012: one safe representation feeds BOTH exits (the stderr JSON
        // line and the persisted heartbeat) so they cannot disagree.
        const safeError = sanitizeEmailError(err);
        log("error", "poll cycle failed", { error: safeError });

        // Persist error heartbeat
        try {
          await heartbeatRepo.upsert({
            workerName: WORKER_NAME,
            workerInstanceId,
            lastPollAt: new Date(),
            lastSuccessAt: null,
            lastErrorAt: new Date(),
            lastError: safeError,
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
          error: sanitizeEmailError(err),
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
    // #1012: the startup failure carries the safe classification only — no
    // raw message (config loaders interpolate raw env values into it) and no
    // stack (source paths). The non-zero exit code remains the failure signal.
    log("error", "worker failed to start", {
      error: sanitizeEmailError(err),
    });
    process.exit(1);
  });
}
