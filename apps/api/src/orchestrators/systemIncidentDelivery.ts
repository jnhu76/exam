/**
 * System incident delivery — the #304 reconciliation leg (freeze F4A).
 *
 * DURABLE COMPLETION: a committed heartbeat-detected episode stays
 * reconcilable until its episode-derived deterministic System create
 * operation has durably committed in the `exam_incident_events`
 * operation-unique arbiter. The discovery read is stateless per cycle and
 * the probe is a batch check on that arbiter — process memory, the one-shot
 * `marked` return value, and human incident links are NEVER completion
 * authority (`FIELD/LINK EXISTS ≠ SYSTEM COMMAND COMPLETED`).
 */
import type { RequestContext } from "@exam/domain";
import type { IncidentCommandResult, IncidentRepo } from "@exam/exam-engine";
import {
  createSystemIncidentFromHeartbeatEpisode,
  deriveSystemIncidentCanonicalPayload,
  SYSTEM_INCIDENT_CREATE_COMMAND,
  systemIncidentOperationId,
  type HeartbeatEpisodeFact,
} from "@exam/exam-engine";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createIncidentRepo } from "@exam/db/src/repository/incidentRepo.js";
import type { Database } from "@exam/db/src/types.js";
import { recordAtomicSystemAudit } from "../audit/auditWriter.js";
import { withIncidentOperationRecovery } from "./incidentOperationRecovery.js";

export interface SystemIncidentDeliveryCounts {
  createdCount: number;
  replayedCount: number;
  failedCount: number;
}

/**
 * Runs the idempotent System create command for one episode's fact set with
 * full ADR-014 §9 operation recovery. The episode facts parameter feeds the
 * recovery wrapper's canonical-payload comparison; the engine command
 * re-derives the identical payload from authoritative rows inside the
 * transaction (episodes and their `detected` facts are immutable once
 * committed, so the two derivations always agree).
 */
export async function deliverSystemIncidentForHeartbeatEpisode(
  db: Database,
  ctx: RequestContext,
  fact: HeartbeatEpisodeFact,
  opts: { now: Date },
): Promise<IncidentCommandResult> {
  const operationId = systemIncidentOperationId(fact.interruptionId);
  const canonicalPayload = deriveSystemIncidentCanonicalPayload(fact);

  return withIncidentOperationRecovery(
    db,
    ctx,
    operationId,
    SYSTEM_INCIDENT_CREATE_COMMAND,
    canonicalPayload,
    async (tx) => {
      const repo = createIncidentRepo(tx) as unknown as IncidentRepo;
      const audit = async (
        action: string,
        metadata: Record<string, unknown>,
      ) => {
        await recordAtomicSystemAudit(
          tx,
          { tenant: ctx, correlationId: operationId },
          {
            action: action as never,
            targetType: "incident",
            targetId: metadata.incidentId as string,
            metadata,
          },
        );
      };

      return createSystemIncidentFromHeartbeatEpisode(repo, ctx, fact, {
        now: opts.now,
        audit,
        lookupEpisode: async (episodeId) => {
          const episode = await createAttemptInterruptionRepo(tx).findById(
            ctx,
            episodeId,
          );
          return episode ? { attemptId: episode.attemptId } : null;
        },
        lookupDetectedEvent: async (episodeId) => {
          const event = await createAttemptInterruptionEventRepo(
            tx,
          ).findDetected(ctx, episodeId);
          return event
            ? {
                occurredAt: event.occurredAt,
                observedLastActivityAt: event.observedLastActivityAt,
                timeoutSeconds: event.timeoutSeconds,
                detectionSource: event.detectionSource,
              }
            : null;
        },
        lookupAttempt: async (attemptId) => {
          const attempt = await createAttemptRepo(tx).findById(ctx, attemptId);
          return attempt
            ? {
                examId: attempt.examId,
                candidateId: attempt.candidateId,
                organizationId: attempt.organizationId,
              }
            : null;
        },
      });
    },
  );
}

/**
 * One bounded reconciliation pass for one organization (F4A): re-derive the
 * work from the durable episode ledger, probe the operation-unique arbiter,
 * and invoke the idempotent System create for every pending episode, oldest
 * first. A per-episode failure is counted and retried on the next cycle; it
 * never aborts the pass (the arbiter makes every retry converge).
 */
export async function reconcileSystemIncidents(
  db: Database,
  ctx: RequestContext,
  opts: { now: Date; onError?: (interruptionId: string, err: unknown) => void },
): Promise<SystemIncidentDeliveryCounts> {
  const episodes =
    await createAttemptInterruptionEventRepo(db).listHeartbeatDetectedEpisodes(
      ctx,
    );

  const committed = await createIncidentRepo(db).listCommittedOperationIds(
    ctx,
    episodes.map((episode) =>
      systemIncidentOperationId(episode.interruptionId),
    ),
  );

  const counts: SystemIncidentDeliveryCounts = {
    createdCount: 0,
    replayedCount: 0,
    failedCount: 0,
  };

  for (const episode of episodes) {
    const operationId = systemIncidentOperationId(episode.interruptionId);
    if (committed.has(operationId)) continue;

    const fact: HeartbeatEpisodeFact = {
      interruptionId: episode.interruptionId,
      examId: episode.examId,
      attemptId: episode.attemptId,
      candidateId: episode.candidateId,
      detected: {
        occurredAt: episode.occurredAt,
        observedLastActivityAt: episode.observedLastActivityAt,
        timeoutSeconds: episode.timeoutSeconds,
      },
    };

    try {
      const result = await deliverSystemIncidentForHeartbeatEpisode(
        db,
        ctx,
        fact,
        { now: opts.now },
      );
      if (result.outcome === "applied") {
        counts.createdCount++;
      } else {
        counts.replayedCount++;
      }
    } catch (err) {
      counts.failedCount++;
      try {
        opts.onError?.(episode.interruptionId, err);
      } catch {
        /* error-reporting failure is non-fatal */
      }
    }
  }

  return counts;
}
