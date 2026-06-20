import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { Permission, RequestContext } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import { markDisrupted } from "@exam/exam-engine";
import { createAttemptRepoAdapter } from "../adapters/repoAdapters.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

const DEFAULT_SCAN_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;
const SYSTEM_ACTOR_ID = "system:heartbeat";

/**
 * Minimal representation of an active exam attempt used by the heartbeat
 * scanner. Only the fields required to evaluate staleness are included.
 */
export interface DisruptedCandidate {
  id: string;
  status: string;
  lastActivityAt?: Date | null;
}

/**
 * Result returned by the heartbeat scan.
 * - `markedCount`: attempts actually transitioned to disrupted this cycle.
 * - `failedCount`: attempts the scanner tried to disrupt but whose handler
 *   threw; these are retried on the next scan.
 */
export interface ScanResult {
  markedCount: number;
  failedCount: number;
}

/**
 * Scans a list of active attempts and invokes `onDisrupted` for each
 * in-progress attempt whose `lastActivityAt` is older than
 * `heartbeatTimeoutMs` relative to the provided `now` timestamp.
 *
 * `onDisrupted` returns whether the attempt's state actually changed
 * (`true`/`void` = disrupted, `false` = no-op race, e.g. the row was no
 * longer `in_progress` under the row lock). Throws propagate to `onError`
 * and increment `failedCount` so the attempt is retried on the next scan.
 */
export async function scanForDisruptedAttempts(
  activeAttempts: DisruptedCandidate[],
  now: Date,
  heartbeatTimeoutMs: number,
  onDisrupted: (attemptId: string) => Promise<boolean | void>,
  options: { onError?: (attemptId: string, err: unknown) => void } = {},
): Promise<ScanResult> {
  let markedCount = 0;
  let failedCount = 0;

  for (const attempt of activeAttempts) {
    if (attempt.status !== "in_progress") continue;
    if (!attempt.lastActivityAt) continue;

    const elapsed = now.getTime() - attempt.lastActivityAt.getTime();
    if (elapsed >= heartbeatTimeoutMs) {
      try {
        const result = await onDisrupted(attempt.id);
        if (result !== false) {
          markedCount++;
        }
      } catch (err) {
        failedCount++;
        options.onError?.(attempt.id, err);
      }
    }
  }

  return { markedCount, failedCount };
}

/**
 * Parses an environment variable as a positive integer. Returns `fallback`
 * if the value is undefined, not a number, or not a positive integer.
 */
function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Creates a synthetic `RequestContext` representing the system heartbeat
 * actor, used when the background scanner needs to interact with
 * repositories that require a context.
 */
function createSystemContext(organizationId: string): RequestContext {
  return {
    actorId: SYSTEM_ACTOR_ID,
    organizationId,
    role: "Admin",
    permissions: [] as Permission[],
    sessionId: SYSTEM_ACTOR_ID,
    targetOrganizationId: organizationId,
  };
}

/**
 * Marks a single attempt as disrupted inside a transaction with a
 * `FOR UPDATE` row lock, then writes a best-effort `attempt.disrupted`
 * audit entry. Mirrors the deadline scanner's `autoSubmitAndGrade` shape.
 *
 * @returns `true` when the attempt was transitioned `in_progress` →
 *   `disrupted`; `false` for a no-op race (the locked row was no longer
 *   `in_progress`, or it vanished). The audit write never fails the
 *   disruption — its errors are swallowed (logged by the caller's
 *   `onError` is intentionally not used here, matching the deadline scanner).
 */
export async function markAttemptDisrupted(
  db: Database,
  ctx: RequestContext,
  attemptId: string,
): Promise<boolean> {
  const stateChanged = await executeInTransaction(db, async (tx) => {
    const txAttemptRepo = createAttemptRepo(tx);
    const locked = await txAttemptRepo.findByIdForUpdate(ctx, attemptId);
    if (!locked) return false;
    // Re-check under the row lock: a concurrent submit/restore/grade may
    // have moved the row out of in_progress between the scan and the lock.
    if (locked.status !== "in_progress") return false;

    await markDisrupted(
      createAttemptRepoAdapter(txAttemptRepo, ctx),
      attemptId,
    );
    return true;
  });

  if (!stateChanged) return false;

  try {
    await createAuditLogRepo(db).create(ctx, {
      actorId: SYSTEM_ACTOR_ID,
      action: "attempt.disrupted",
      targetType: "attempt",
      targetId: attemptId,
      metadata: { source: "heartbeat-scanner" },
    });
  } catch {
    // Audit is best-effort; the disruption must succeed regardless.
  }

  return true;
}

/**
 * Iterates over all organizations and scans their in-progress attempts for
 * staleness. Each stale attempt is marked as disrupted in its own transaction
 * with a row lock and a best-effort `attempt.disrupted` audit entry.
 *
 * Failed disruptions are not counted in `markedCount` and are retried on the
 * next scan (the stale attempt remains `in_progress`). Returns aggregate
 * counts across all organizations.
 */
export async function scanDatabaseForDisruptedAttempts(
  fastify: Parameters<FastifyPluginAsync>[0],
  // ADR-006: the scanner tick captures one operation now from the time
  // authority and threads it through the whole scan; defaulting to
  // fastify.now() keeps call sites that omit it on the authority clock.
  now: Date = fastify.now(),
  heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
): Promise<ScanResult> {
  const db = fastify.db as Database;
  const organizationRepo = createOrganizationRepo(db);
  const organizations = await organizationRepo.list(
    createSystemContext("system"),
  );
  let markedCount = 0;
  let failedCount = 0;

  for (const organization of organizations) {
    const ctx = createSystemContext(organization.id);
    const attemptRepo = createAttemptRepo(db);
    const attempts = await attemptRepo.listInProgress(ctx);
    const result = await scanForDisruptedAttempts(
      attempts,
      now,
      heartbeatTimeoutMs,
      async (attemptId) => {
        return markAttemptDisrupted(db, ctx, attemptId);
      },
      {
        onError: (attemptId, err) => {
          fastify.log.error(
            { err, attemptId, organizationId: organization.id },
            "Failed to mark stale attempt as disrupted",
          );
        },
      },
    );
    markedCount += result.markedCount;
    failedCount += result.failedCount;
  }

  return { markedCount, failedCount };
}

/**
 * Fastify plugin that starts a periodic background scanner to detect
 * exam candidates whose heartbeat has timed out and marks their attempts
 * as disrupted. The scan interval is read from `HEARTBEAT_SCAN_INTERVAL_MS`
 * (falling back to runtime config, then the default); the heartbeat timeout
 * is read from runtime config (`HEARTBEAT_TIMEOUT_MS`). The timer is unref'd
 * so it does not keep the process alive.
 */
const heartbeatPlugin: FastifyPluginAsync = async (fastify) => {
  const config = getRuntimeConfig();
  const scanIntervalMs = readPositiveInteger(
    process.env.HEARTBEAT_SCAN_INTERVAL_MS,
    config.heartbeat.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS,
  );
  const heartbeatTimeoutMs = config.heartbeat.timeoutMs;

  let scanRunning = false;
  const interval = setInterval(async () => {
    if (scanRunning) return;
    scanRunning = true;
    try {
      // ADR-006: one operation now per tick, from the time authority.
      const result = await scanDatabaseForDisruptedAttempts(
        fastify,
        fastify.now(),
        heartbeatTimeoutMs,
      );
      if (result.markedCount > 0) {
        fastify.log.info(
          {
            markedCount: result.markedCount,
            failedCount: result.failedCount,
          },
          "Marked stale exam attempts as disrupted",
        );
      }
    } catch (err) {
      fastify.log.error({ err }, "Error scanning for disrupted attempts");
    } finally {
      scanRunning = false;
    }
  }, scanIntervalMs);
  interval.unref();

  fastify.addHook("onClose", async () => {
    clearInterval(interval);
  });
};

export default fp(heartbeatPlugin);
