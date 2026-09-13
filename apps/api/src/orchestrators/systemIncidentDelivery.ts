/**
 * System incident delivery — the #304 reconciliation leg (freeze F4A).
 *
 * DURABLE COMPLETION: a committed heartbeat-detected episode stays
 * reconcilable until its episode-derived deterministic System create
 * operation has durably committed in the `exam_incident_events`
 * operation-unique arbiter WITH the System command identity and the
 * episode's canonical payload — the engine's `isMatchingCommittedOperation`
 * predicate, the same comparison as `preReadOperationId`. A bare
 * operationId hit is NOT completion: an operation committed under the same
 * operationId with a different command/payload (e.g. a caller-supplied
 * human operationId colliding with the derived one) falls through to
 * delivery, whose pre-read raises `IdempotencyConflictError` — counted in
 * `conflictCount` and reported via `onError`, never silently skipped. The
 * discovery read is stateless per cycle and the probe is a batch check on
 * that arbiter — process memory, the one-shot `marked` return value, and
 * human incident links are NEVER completion authority
 * (`FIELD/LINK EXISTS ≠ SYSTEM COMMAND COMPLETED`).
 */
import type { RequestContext } from "@exam/domain";
import { IdempotencyConflictError } from "@exam/domain";
import type { IncidentCommandResult, IncidentRepo } from "@exam/exam-engine";
import {
  createSystemIncidentFromHeartbeatEpisode,
  deriveSystemIncidentCanonicalPayload,
  isMatchingCommittedOperation,
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
  /** Subset of `failedCount`: the arbiter holds a different operation under
   * the episode's derived operationId (visible conflict, retried next cycle). */
  conflictCount: number;
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

  const committed = await createIncidentRepo(db).listCommittedOperations(
    ctx,
    episodes.map((episode) =>
      systemIncidentOperationId(episode.interruptionId),
    ),
  );

  const counts: SystemIncidentDeliveryCounts = {
    createdCount: 0,
    replayedCount: 0,
    failedCount: 0,
    conflictCount: 0,
  };

  for (const episode of episodes) {
    const operationId = systemIncidentOperationId(episode.interruptionId);
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

    // Completion = the committed operation matches THIS System command and
    // the episode's canonical payload (preReadOperationId's replay
    // predicate). An operationId committed with a different command/payload
    // falls through to delivery, whose pre-read raises the
    // IdempotencyConflictError a bare-existence probe used to hide.
    if (
      isMatchingCommittedOperation(
        committed.get(operationId),
        SYSTEM_INCIDENT_CREATE_COMMAND,
        deriveSystemIncidentCanonicalPayload(fact),
      )
    ) {
      continue;
    }

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
      if (err instanceof IdempotencyConflictError) {
        counts.conflictCount++;
      }
      try {
        opts.onError?.(episode.interruptionId, err);
      } catch {
        /* error-reporting failure is non-fatal */
      }
    }
  }

  return counts;
}
