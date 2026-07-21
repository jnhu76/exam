import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { RequestContext } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import { markDisrupted } from "@exam/exam-engine";
import { SYSTEM_ACTOR_IDS, createSystemRequestContext } from "@exam/authz";
import { createAttemptRepoAdapter } from "../adapters/repoAdapters.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

const DEFAULT_SCAN_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;
const SYSTEM_ACTOR_ID = SYSTEM_ACTOR_IDS.Heartbeat;

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
 * In-memory metrics for the heartbeat scanner, updated after each scan cycle.
 * These are single-instance counters reset on server restart.
 */
export const heartbeatMetrics = {
  lastScanAt: null as Date | null,
  disruptedCount: 0,
};

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
        // Guard the error callback itself: a throwing onError must not abort
        // the scan loop and skip the remaining stale attempts.
        try {
          options.onError?.(attempt.id, err);
        } catch {
          /* error-reporting failure is non-fatal */
        }
      }
    }
  }

  return { markedCount, failedCount };
}

/**
 * Creates a synthetic `RequestContext` representing the system heartbeat
 * actor, used when the background scanner needs to interact with
 * repositories that require a context.
 */
// SYSTEM-M1: system actor context built by the shared @exam/authz factory
// (role=System, actorId=system:heartbeat). Replaces the prior role:"Admin"
// synthetic context. Scanner code never reads ctx.permissions.
function createSystemContext(organizationId: string): RequestContext {
  return createSystemRequestContext(organizationId, SYSTEM_ACTOR_ID);
}

/**
 * Marks a single attempt as disrupted inside a transaction with a
 * `FOR UPDATE` row lock and writes its audit entry in that transaction.
 * Mirrors the deadline scanner's `autoSubmitAndGrade` shape.
 *
 * @returns `true` when the attempt was transitioned `in_progress` →
 *   `disrupted`; `false` for a no-op race (the locked row was no longer
 *   `in_progress`, or it vanished).
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

  return true;
}

/**
 * Iterates over all organizations and scans their in-progress attempts for
 * staleness. Each stale attempt is marked as disrupted in its own transaction
 * with a row lock. The attempt row is the canonical domain-state owner; this
 * runtime transition does not depend on the compliance audit table.
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
 * as disrupted. The scan interval and heartbeat timeout come from runtime
 * config (`HEARTBEAT_SCAN_INTERVAL_MS` / `HEARTBEAT_TIMEOUT_MS`), parsed and
 * cached once at startup. The timer is unref'd so it does not keep the
 * process alive.
 */
const heartbeatPlugin: FastifyPluginAsync = async (fastify) => {
  const config = getRuntimeConfig();
  const scanIntervalMs =
    config.heartbeat.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS;
  const heartbeatTimeoutMs = config.heartbeat.timeoutMs;

  let activeScan: Promise<void> | null = null;
  let closing = false;
  const interval = setInterval(() => {
    if (closing || activeScan) return;
    activeScan = (async () => {
      try {
        // ADR-006: one operation now per tick, from the time authority.
        const result = await scanDatabaseForDisruptedAttempts(
          fastify,
          fastify.now(),
          heartbeatTimeoutMs,
        );
        heartbeatMetrics.lastScanAt = fastify.now();
        heartbeatMetrics.disruptedCount += result.markedCount;
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
      }
    })().finally(() => {
      activeScan = null;
    });
  }, scanIntervalMs);
  interval.unref();

  fastify.addHook("onClose", async () => {
    closing = true;
    clearInterval(interval);
    await activeScan;
  });
};

export default fp(heartbeatPlugin);
