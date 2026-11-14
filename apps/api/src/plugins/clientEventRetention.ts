import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { RequestContext } from "@exam/domain";
import { createOrganizationRepo } from "@exam/db/repository/organizationRepo";
import { createClientEventRepo } from "@exam/db/repository/clientEventRepo";
import { SYSTEM_ACTOR_IDS, createSystemRequestContext } from "@exam/authz";
import type { Database } from "@exam/db/types";
import { withLoopCycleSpan } from "../telemetry/backgroundLoopSpan.js";
import {
  LOOP_CLIENT_EVENT_RETENTION,
  LOOP_OUTCOME_EMPTY,
  LOOP_OUTCOME_FAILED,
  LOOP_OUTCOME_SUCCESS,
  WORK_DELETED,
  WORK_FAILED_ORG,
  type LoopCycleOutcome,
} from "../telemetry/backgroundLoopVocabulary.js";

/**
 * Client-event retention executor (#544).
 *
 * Bounded lifecycle for the LOW-TRUST `client_events` telemetry table:
 * rows older than {@link CLIENT_EVENT_RETENTION_DAYS} (measured on the
 * server-owned `receivedAt`) are deleted. The policy is fixed by product
 * decision — NOT per-tenant configurable, no retention DSL, no archive tier.
 *
 * Deliberate NON-goals (#544 §9):
 * - No durable database evidence: no `client_event_cleanup_runs` table, no
 *   generic `maintenance_runs` table. Cleanup runs leave only structured
 *   operational logs; low-trust telemetry GC does not warrant an evidence
 *   contract (ADR-023 removed the backup-evidence evidence tables; no
 *   replacement evidence subsystem is authorized).
 * - No generic scheduler framework: this is a dedicated executor following
 *   the proven `deadlineScanner` plugin shape (startup run for convergence +
 *   unref'd daily interval with an in-flight guard + awaited onClose).
 *
 * Convergence/restart safety: the primitive is an idempotent org-scoped
 * `DELETE ... WHERE received_at < cutoff`; any missed window is recovered by
 * the next tick or the next process start, with no in-memory state.
 */

/** Fixed retention horizon in days (product decision, #544 — not configurable). */
export const CLIENT_EVENT_RETENTION_DAYS = 30;

/** Sweep frequency. Daily-scale is sufficient for a 30-day horizon. */
export const CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * #547 stall facts + #862/#871 escalation input for the retention loop —
 * the same shape the heartbeat and deadline-scanner loops already expose,
 * so the operability monitor consumes all three uniformly. Before #871 this
 * loop had NO activity facts at all: a never-fired or hung sweep was
 * indistinguishable from a quiet-but-healthy one in the log stream.
 *
 * `consecutiveFailedTicks`: consecutive SETTLED passes with at least one
 * failed organization; reset by the first fully-clean pass. A pass that
 * THROWS (org discovery) neither increments nor resets it (frozen — the
 * same ownership boundary as the other loops). Process-local; reset on
 * restart.
 */
export const clientEventRetentionMetrics = {
  /** Effective sweep interval (registration placeholder 0; plugin writes it). */
  scanIntervalMs: 0,
  startedAt: null as Date | null,
  lastStartedAt: null as Date | null,
  lastSettledAt: null as Date | null,
  activeSince: null as Date | null,
  consecutiveFailedTicks: 0,
};

/** Pure cutoff computation: `receivedAt < cutoff` deletes; `== cutoff` is kept. */
export function retentionCutoff(now: Date): Date {
  return new Date(
    now.getTime() - CLIENT_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
}

/** Result of one full retention pass across all organizations. */
export interface ClientEventRetentionResult {
  deletedCount: number;
  organizationCount: number;
  /** #871 escalation input: orgs whose cleanup threw in this pass. */
  failedOrganizationCount: number;
}

/**
 * Deletes expired client events for ONE organization. Org boundary comes from
 * the context (same resolution as every repository call) — there is no
 * tenant-less cleanup API. Exported for deterministic single-org invocation.
 */
export async function cleanupOrganizationClientEvents(
  db: Database,
  ctx: RequestContext,
  cutoff: Date,
): Promise<number> {
  return createClientEventRepo(db).deleteOlderThan(ctx, cutoff);
}

function createSystemContext(organizationId: string): RequestContext {
  return createSystemRequestContext(
    organizationId,
    SYSTEM_ACTOR_IDS.ClientEventRetention,
  );
}

/**
 * Runs one full retention pass: enumerates organizations, deletes each org's
 * expired rows, and emits structured operational logs (not durable evidence).
 * Deterministically invocable — tests and ops never wait for the interval.
 */
export async function runClientEventRetentionOnce(
  fastify: FastifyInstance,
  now: Date = fastify.now(),
): Promise<ClientEventRetentionResult> {
  // #964 W4: the pass is one rooted `exam.loop.client_event_retention` cycle
  // span with its projected work metrics; the plugin's start/settle
  // bookkeeping in runPass stays the settle owner (unmodified).
  return withLoopCycleSpan(
    LOOP_CLIENT_EVENT_RETENTION,
    async (
      cycle,
    ): Promise<{
      outcome: LoopCycleOutcome;
      result: ClientEventRetentionResult;
    }> => {
      const db = fastify.db as Database;
      const cutoff = retentionCutoff(now);
      const organizations = await createOrganizationRepo(db).list(
        createSystemContext("system"),
      );

      let deletedCount = 0;
      let failedOrganizationCount = 0;
      for (const organization of organizations) {
        // ADR-006: fastify.now() is the sanctioned plugin-layer clock — the pass
        // `now` stays fixed for the cutoff, per-org durations use a live read.
        const startedAt = fastify.now();
        try {
          const deleted = await cleanupOrganizationClientEvents(
            db,
            createSystemContext(organization.id),
            cutoff,
          );
          deletedCount += deleted;
          if (deleted > 0) {
            fastify.log.info(
              {
                subsystem: "client_event_retention",
                organizationId: organization.id,
                cutoff: cutoff.toISOString(),
                deletedCount: deleted,
                durationMs: fastify.now().getTime() - startedAt.getTime(),
              },
              "Client-event retention deleted expired rows",
            );
          }
        } catch (err) {
          // One org's failure must not block the others; the next pass converges.
          failedOrganizationCount += 1;
          fastify.log.error(
            {
              err,
              subsystem: "client_event_retention",
              organizationId: organization.id,
              cutoff: cutoff.toISOString(),
            },
            "Client-event retention pass failed for organization",
          );
        }
      }

      cycle.countWork(WORK_DELETED, deletedCount);
      cycle.countWork(WORK_FAILED_ORG, failedOrganizationCount);
      const outcome =
        failedOrganizationCount > 0
          ? LOOP_OUTCOME_FAILED
          : deletedCount > 0
            ? LOOP_OUTCOME_SUCCESS
            : LOOP_OUTCOME_EMPTY;
      return {
        outcome,
        result: {
          deletedCount,
          organizationCount: organizations.length,
          failedOrganizationCount,
        },
      };
    },
  );
}

const clientEventRetentionPlugin: FastifyPluginAsync = async (fastify) => {
  let activeRun: Promise<void> | null = null;
  let closing = false;

  const runPass = () => {
    if (closing || activeRun) return;
    // #547/#871: same start/settle bookkeeping as the heartbeat and
    // deadline-scanner loops — settle stamps in .finally (success or error
    // alike), so a hung pass holds activeSince and a dead timer goes STALLED
    // by absence of new starts.
    const startedAt = fastify.now();
    clientEventRetentionMetrics.lastStartedAt = startedAt;
    clientEventRetentionMetrics.activeSince = startedAt;
    activeRun = (async () => {
      try {
        const result = await runClientEventRetentionOnce(fastify);
        // #871 escalation input: a settled pass with any failed org extends
        // the consecutive run; the first fully-clean pass (zero deleted is
        // still clean — no expired data is not a failure) resets it.
        clientEventRetentionMetrics.consecutiveFailedTicks =
          result.failedOrganizationCount > 0
            ? clientEventRetentionMetrics.consecutiveFailedTicks + 1
            : 0;
      } catch (err) {
        // Tick-level throw (org discovery): settles via the catch path with
        // NO business-failure evidence — the counter freezes, never resets
        // (a throw is not recovery) and never advances. Same frozen rule as
        // the heartbeat/deadline loops (#862).
        fastify.log.error(
          { err, subsystem: "client_event_retention" },
          "Client-event retention pass failed",
        );
      }
    })().finally(() => {
      activeRun = null;
      clientEventRetentionMetrics.activeSince = null;
      clientEventRetentionMetrics.lastSettledAt = fastify.now();
    });
  };

  clientEventRetentionMetrics.scanIntervalMs =
    CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS;
  // #547: WARMING grace origin — recorded once, at registration.
  clientEventRetentionMetrics.startedAt = fastify.now();

  // Startup convergence: a process that was down across one or more sweep
  // windows catches up immediately instead of waiting a full interval.
  runPass();

  const interval = setInterval(
    runPass,
    CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS,
  );
  interval.unref();

  fastify.addHook("onClose", async () => {
    closing = true;
    clearInterval(interval);
    await activeRun;
  });
};

export default fp(clientEventRetentionPlugin);
