import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { RequestContext } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import { markDisrupted } from "@exam/exam-engine";
import { SYSTEM_ACTOR_IDS, createSystemRequestContext } from "@exam/authz";
import {
  createAttemptRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../adapters/repoAdapters.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { reconcileSystemIncidents } from "../orchestrators/systemIncidentDelivery.js";

const DEFAULT_SCAN_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;
const SYSTEM_ACTOR_ID = SYSTEM_ACTOR_IDS.Heartbeat;
const INCIDENT_DETECTOR_ACTOR_ID = SYSTEM_ACTOR_IDS.IncidentDetector;

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
 *
 * #547 stall facts: `lastSettledAt` is the STALL AUTHORITY (settled = the
 * tick body finished, success OR error — a cycle failing loudly every
 * interval is NOT stalled). `lastScanAt` keeps its existing contract (the
 * tick's operation `now`, set after the disruption leg) for diagnostics.
 */
export const heartbeatMetrics = {
  startedAt: null as Date | null,
  lastStartedAt: null as Date | null,
  lastSettledAt: null as Date | null,
  activeSince: null as Date | null,
  lastScanAt: null as Date | null,
  disruptedCount: 0,
  systemIncidentsCreated: 0,
  systemIncidentConflicts: 0,
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
 * Marks a single attempt as disrupted inside a transaction using the
 * Attempt-only locking protocol (R12). Creates the interruption episode
 * parent, inserts a `detected` event, and transitions the attempt to
 * `disrupted` with the active pointer atomically.
 *
 * Only the attempt + interruption repos are constructed — no enrollment or
 * exam repos (R12). The heartbeat timeout in whole seconds is read from
 * runtime config.
 *
 * @returns `true` when the attempt was transitioned `in_progress` →
 *   `disrupted`; `false` for a no-op (fresh under lock, state changed before
 *   lock, or missing).
 */
export async function markAttemptDisrupted(
  db: Database,
  ctx: RequestContext,
  attemptId: string,
  heartbeatTimeoutSeconds: number,
  now: Date,
): Promise<boolean> {
  const result = await executeInTransaction(db, async (tx) => {
    const txAttemptRepo = createAttemptRepo(tx);
    const txInterruptionRepo = createAttemptInterruptionRepo(tx);
    const txEventRepo = createAttemptInterruptionEventRepo(tx);

    const disruptionResult = await markDisrupted(
      createAttemptRepoAdapter(txAttemptRepo, ctx),
      createInterruptionEpisodeRepoAdapter(txInterruptionRepo, ctx),
      createInterruptionEventRepoAdapter(txEventRepo, ctx),
      attemptId,
      now,
      heartbeatTimeoutSeconds,
    );

    return disruptionResult.outcome === "marked";
  });

  return result;
}

/**
 * System incident reconciliation leg (#304 F4A): iterates organizations and,
 * per org, runs the durable System-create reconciliation for every committed
 * heartbeat-detected episode whose episode-derived operation has not yet
 * committed in the op-unique arbiter. Runs AFTER the disruption scan in the
 * same tick, so an episode marked this cycle gets its System incident in the
 * same pass — but the scan outcome is never the completion authority: the
 * arbiter probe inside {@link reconcileSystemIncidents} is, and every missed
 * delivery is retried on a later cycle until it commits.
 */
export async function reconcileSystemIncidentsAcrossOrgs(
  fastify: Parameters<FastifyPluginAsync>[0],
  now: Date = fastify.now(),
): Promise<{
  createdCount: number;
  replayedCount: number;
  failedCount: number;
  conflictCount: number;
}> {
  const db = fastify.db as Database;
  const organizationRepo = createOrganizationRepo(db);
  const organizations = await organizationRepo.list(
    createSystemContext("system"),
  );
  let createdCount = 0;
  let replayedCount = 0;
  let failedCount = 0;
  let conflictCount = 0;

  for (const organization of organizations) {
    const detectorCtx = createSystemRequestContext(
      organization.id,
      INCIDENT_DETECTOR_ACTOR_ID,
    );
    try {
      const counts = await reconcileSystemIncidents(db, detectorCtx, {
        now,
        onError: (interruptionId, err) => {
          fastify.log.error(
            { err, interruptionId, organizationId: organization.id },
            "Failed to create System incident for heartbeat episode",
          );
        },
      });
      createdCount += counts.createdCount;
      replayedCount += counts.replayedCount;
      failedCount += counts.failedCount;
      conflictCount += counts.conflictCount;
    } catch (err) {
      // Discovery-level failure (e.g. ledger read): skip this org this cycle;
      // the arbiter makes the next cycle converge.
      failedCount++;
      fastify.log.error(
        { err, organizationId: organization.id },
        "System incident reconciliation failed for organization",
      );
    }
  }

  return { createdCount, replayedCount, failedCount, conflictCount };
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
  heartbeatTimeoutSeconds: number = Math.floor(
    DEFAULT_HEARTBEAT_TIMEOUT_MS / 1000,
  ),
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
      heartbeatTimeoutSeconds * 1000,
      async (attemptId) => {
        return markAttemptDisrupted(
          db,
          ctx,
          attemptId,
          heartbeatTimeoutSeconds,
          now,
        );
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
  const heartbeatTimeoutSeconds = config.heartbeat.heartbeatTimeoutSeconds;

  // #547: WARMING grace origin — recorded once, at registration.
  heartbeatMetrics.startedAt = fastify.now();

  let activeScan: Promise<void> | null = null;
  let closing = false;
  const interval = setInterval(() => {
    if (closing || activeScan) return;
    activeScan = (async () => {
      // #547 stall facts: record the in-flight window; settle (success or
      // error) clears activeSince and stamps lastSettledAt in .finally.
      const startedAt = fastify.now();
      heartbeatMetrics.lastStartedAt = startedAt;
      heartbeatMetrics.activeSince = startedAt;
      try {
        // ADR-006: one operation now per tick, from the time authority.
        const tickNow = fastify.now();
        const result = await scanDatabaseForDisruptedAttempts(
          fastify,
          tickNow,
          heartbeatTimeoutSeconds,
        );
        heartbeatMetrics.lastScanAt = tickNow;
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
        // #304 F4A: after the disruption scan, reconcile System incidents for
        // every committed heartbeat episode still missing its create
        // operation. Best-effort per cycle; the op-unique arbiter guarantees
        // convergence, never duplication.
        const incidentCounts = await reconcileSystemIncidentsAcrossOrgs(
          fastify,
          tickNow,
        );
        heartbeatMetrics.systemIncidentsCreated += incidentCounts.createdCount;
        heartbeatMetrics.systemIncidentConflicts +=
          incidentCounts.conflictCount;
        if (incidentCounts.createdCount > 0) {
          fastify.log.info(
            {
              createdCount: incidentCounts.createdCount,
              replayedCount: incidentCounts.replayedCount,
              failedCount: incidentCounts.failedCount,
            },
            "Created System incidents from heartbeat episodes",
          );
        }
        if (incidentCounts.conflictCount > 0) {
          fastify.log.error(
            { conflictCount: incidentCounts.conflictCount },
            "Conflicting operations occupy heartbeat-derived System incident operationIds",
          );
        }
      } catch (err) {
        fastify.log.error({ err }, "Error scanning for disrupted attempts");
      }
    })().finally(() => {
      activeScan = null;
      heartbeatMetrics.activeSince = null;
      heartbeatMetrics.lastSettledAt = fastify.now();
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
