import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { RequestContext } from "@exam/domain";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { createClientEventRepo } from "@exam/db/src/repository/clientEventRepo.js";
import { SYSTEM_ACTOR_IDS, createSystemRequestContext } from "@exam/authz";
import type { Database } from "@exam/db/src/types.js";

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
 *   operational logs. Durable run evidence is reserved for authoritative
 *   data lifecycles (backup/WAL `retention_runs`); low-trust telemetry GC
 *   does not warrant an evidence contract, and `retention_runs` must NOT be
 *   reused for it (different subsystem semantics).
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
  const db = fastify.db as Database;
  const cutoff = retentionCutoff(now);
  const organizations = await createOrganizationRepo(db).list(
    createSystemContext("system"),
  );

  let deletedCount = 0;
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

  return { deletedCount, organizationCount: organizations.length };
}

const clientEventRetentionPlugin: FastifyPluginAsync = async (fastify) => {
  let activeRun: Promise<void> | null = null;
  let closing = false;

  const runPass = () => {
    if (closing || activeRun) return;
    activeRun = (async () => {
      try {
        await runClientEventRetentionOnce(fastify);
      } catch (err) {
        fastify.log.error(
          { err, subsystem: "client_event_retention" },
          "Client-event retention pass failed",
        );
      }
    })().finally(() => {
      activeRun = null;
    });
  };

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
