import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { createEmailOutboxRepo } from "@exam/db/src/repository/emailOutboxRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import {
  createWorkerHeartbeatRepo,
  type WorkerHeartbeatRepo,
} from "@exam/db/src/repository/workerHeartbeatRepo.js";
import { EmailOutboxService } from "../email/outboxService.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import {
  interruptibleSleep,
  waitForSingleOrganization,
  type LogFn,
} from "../workers/emailDeliveryWorker.js";

export const EMAIL_DELIVERY_WORKER_NAME = "email-delivery";

/**
 * In-process email outbox delivery loop (#320 convergence candidate).
 *
 * Runs the exact poll body of the standalone email delivery worker
 * (`workers/emailDeliveryWorker.ts`) inside the API process, reusing the same
 * PostgreSQL-backed semantics verbatim: `recoverAbandoned` lock-timeout
 * recovery, atomic `FOR UPDATE SKIP LOCKED` claiming, retry/backoff, a
 * `worker_heartbeats` row under the same worker name (so `buildEmailStatus`
 * diagnostics are unchanged), and at-least-once delivery.
 *
 * Failure containment differs from a dedicated process by design:
 *  - loop failures are supervised and retried after the poll interval, so a
 *    database hiccup degrades email delivery without crashing the API;
 *  - shutdown is bounded by `EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS`; rows left
 *    `processing` past the bound are redelivered via lock-timeout recovery
 *    (documented at-least-once), so SIGTERM latency never scales with batch
 *    size times SMTP latency.
 */
const emailOutboxLoopPlugin: FastifyPluginAsync = async (fastify) => {
  const config = getRuntimeConfig();
  const { pollIntervalMs, batchSize, lockTimeoutMs, shutdownTimeoutMs } =
    config.emailWorker;
  const workerInstanceId = `${hostname()}-${process.pid}-${randomUUID()}`;

  const log: LogFn = (level, msg, meta) => {
    const payload = {
      worker: EMAIL_DELIVERY_WORKER_NAME,
      workerInstanceId,
      ...meta,
    };
    if (level === "error") fastify.log.error(payload, msg);
    else if (level === "warn") fastify.log.warn(payload, msg);
    else fastify.log.info(payload, msg);
  };

  let stopping = false;
  const heartbeatRepo: Pick<WorkerHeartbeatRepo, "upsert"> =
    createWorkerHeartbeatRepo(fastify.db);

  const writeHeartbeat = async (lastError: string | null) => {
    try {
      const stampedAt = fastify.now();
      await heartbeatRepo.upsert({
        workerName: EMAIL_DELIVERY_WORKER_NAME,
        workerInstanceId,
        lastPollAt: stampedAt,
        lastSuccessAt: lastError === null ? stampedAt : null,
        lastErrorAt: lastError === null ? null : stampedAt,
        lastError,
      });
    } catch (err) {
      log("warn", "heartbeat write failed (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const runLoop = async (): Promise<void> => {
    const orgRepo = createOrganizationRepo(fastify.db);
    const organization = await waitForSingleOrganization({
      orgRepo,
      heartbeatRepo,
      workerInstanceId,
      pollIntervalMs,
      isShuttingDown: () => stopping,
      sleep: (ms) => interruptibleSleep(ms, () => stopping),
      log,
    });
    if (!organization || stopping) return;

    const orgScope = { organizationId: organization.id };
    const outboxRepo = createEmailOutboxRepo(fastify.db);
    const outboxService = new EmailOutboxService({
      repo: outboxRepo,
      ctx: orgScope,
      sender: fastify.emailSender,
      retryBaseSeconds: config.email.retryBaseSeconds,
      scrubSecrets: config.email.smtp?.password
        ? [config.email.smtp.password]
        : [],
    });

    log("info", "in-process email outbox loop started", {
      pollIntervalMs,
      batchSize,
      lockTimeoutMs,
      enabled: config.email.enabled,
    });

    while (!stopping) {
      const pollStart = fastify.now();
      try {
        const recovered = await outboxRepo.recoverAbandoned(
          orgScope,
          pollStart,
          lockTimeoutMs,
        );
        if (recovered > 0) {
          log("warn", "recovered abandoned processing rows", {
            count: recovered,
          });
        }

        const result = await outboxService.processDueEmails({
          now: pollStart,
          limit: batchSize,
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

        await writeHeartbeat(null);
      } catch (err) {
        log("error", "poll cycle failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        await writeHeartbeat(err instanceof Error ? err.message : String(err));
      }

      if (!stopping) {
        await interruptibleSleep(pollIntervalMs, () => stopping);
      }
    }
  };

  const supervised = (async () => {
    while (!stopping) {
      try {
        await runLoop();
        return;
      } catch (err) {
        log(
          "error",
          "email outbox loop crashed; retrying after poll interval",
          {
            error: err instanceof Error ? err.message : String(err),
          },
        );
        await writeHeartbeat(err instanceof Error ? err.message : String(err));
        await interruptibleSleep(pollIntervalMs, () => stopping);
      }
    }
  })();

  fastify.addHook("onClose", async () => {
    stopping = true;
    const drained = await Promise.race([
      supervised.then(
        () => true,
        (err) => {
          log("error", "email outbox loop failed during shutdown", {
            error: err instanceof Error ? err.message : String(err),
          });
          return true;
        },
      ),
      new Promise<void>((resolve) => setTimeout(resolve, shutdownTimeoutMs)),
    ]);
    if (drained) {
      log("info", "email outbox loop stopped cleanly");
    } else {
      log(
        "warn",
        "email outbox loop shutdown timeout; in-flight rows stay processing and are redelivered via lock-timeout recovery",
        { shutdownTimeoutMs },
      );
    }
  });
};

export default fp(emailOutboxLoopPlugin);
