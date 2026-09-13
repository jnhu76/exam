/**
 * System-only incident creation from heartbeat-disruption episodes (#304).
 *
 * FROZEN AUTHORITY (ADR-014 §8 Gate A + EXAM-304 freeze F1–F10/F4A):
 * - internal-only seam (F9): the command rejects every non-System context and
 *   every System actor id other than `system:incident-detector`; no HTTP
 *   surface may select System identity;
 * - `operationId` = deterministic UUID-v5 of the interruption episode id
 *   (F4): the existing `exam_incident_events_org_operation_unique
 *   (organization_id, operation_id)` arbiter is the SOLE dedupe authority —
 *   one episode ⇒ at most one System-created incident; a later episode is a
 *   distinct source fact (F5, PER_EPISODE); never process memory, no second
 *   fingerprint/claim authority;
 * - incident + interruption evidence link commit as ONE command transaction
 *   (F4A): operation committed ⟺ the System link exists; a human-created
 *   incident or human link neither satisfies, cancels, nor replaces this
 *   completion;
 * - creation-only (F6): no time grant, no punishment, no
 *   `source=system_incident` write; human resolve/dismiss stays terminal (F7);
 * - audit reuses canonical `incident.created` with the detector actor
 *   identity (F8); no `incident.system_created` action exists.
 */
import { createHash } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@exam/domain";
import { IncidentSeverity, IncidentType, Role } from "@exam/domain";
import { SYSTEM_ACTOR_IDS } from "@exam/authz";
import type {
  AttemptScopeRow,
  IncidentAuditFn,
  IncidentCommandResult,
  IncidentRepo,
} from "./incidentCommands.js";
import { preReadOperationId } from "./incidentCommands.js";

/** Canonical command identity stored on the `incident_created` event. */
export const SYSTEM_INCIDENT_CREATE_COMMAND =
  "createSystemIncidentFromHeartbeatEpisode";

/**
 * Repo-owned UUID-v5 namespace for episode-derived System create operations.
 * Any fixed namespace satisfies RFC 4122; this value is frozen so every
 * consumer and every restart derives the same operationId for an episode.
 */
const SYSTEM_INCIDENT_OPERATION_NAMESPACE =
  "e710e942-731b-4016-a784-debcc5e02e59";

/**
 * Deterministic System-create operationId for one interruption episode (F4).
 * Pure function of the episode id: every legitimate consumer of an episode
 * carries the SAME operationId into the op-unique arbiter, so retry and
 * reconciliation converge on at most one System-created incident.
 */
export function systemIncidentOperationId(episodeId: string): string {
  const namespaceBytes = Buffer.from(
    SYSTEM_INCIDENT_OPERATION_NAMESPACE.replace(/-/g, ""),
    "hex",
  );
  const digest = createHash("sha1")
    .update(namespaceBytes)
    .update(episodeId, "utf8")
    .digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50; // version 5
  digest[8] = (digest[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Fixed v1 detector mapping for the heartbeat-disruption detector (F2:
 * exactly one detector). `network_interruption` is the closest closed-enum
 * classification for connection loss (mirrors the proctor marker mapping in
 * ADR-014 §15); the precise trigger fact lives in the description and the
 * linked episode. Severity informs prioritization only (ADR-014 §4) and can
 * never trigger an automated effect.
 */
export const SYSTEM_INCIDENT_TYPE: IncidentType = "network_interruption";
export const SYSTEM_INCIDENT_SEVERITY: IncidentSeverity = "info";

/**
 * The immutable per-episode facts the System incident is derived from — all
 * read from authoritative rows (episode ledger + `detected` event + attempt),
 * never from request input (F9). `interruptionId` is the source fingerprint
 * the operationId is derived from.
 */
export interface HeartbeatEpisodeFact {
  interruptionId: string;
  examId: string;
  attemptId: string;
  candidateId: string | null;
  detected: {
    occurredAt: Date;
    observedLastActivityAt: Date | null;
    timeoutSeconds: number | null;
  };
}

function systemIncidentDescription(fact: HeartbeatEpisodeFact): string {
  const lastActivity = fact.detected.observedLastActivityAt
    ? fact.detected.observedLastActivityAt.toISOString()
    : "unknown";
  const timeout =
    fact.detected.timeoutSeconds != null
      ? `${fact.detected.timeoutSeconds}s`
      : "the configured window";
  return (
    `System detected a heartbeat disruption (heartbeat_timeout): no candidate ` +
    `heartbeat for ${timeout}, last activity observed at ${lastActivity}. ` +
    `Interruption episode ${fact.interruptionId}.`
  );
}

/**
 * The canonical event payload for one episode's System create operation —
 * pure and deterministic per episode so the engine's replay check and the
 * recovery wrapper's fresh-transaction comparison always agree. Every value
 * is derived from the durable episode facts; nothing is caller-chosen.
 */
export function deriveSystemIncidentCanonicalPayload(
  fact: HeartbeatEpisodeFact,
): Record<string, unknown> {
  return {
    examId: fact.examId,
    attemptId: fact.attemptId,
    candidateId: fact.candidateId,
    type: SYSTEM_INCIDENT_TYPE,
    severity: SYSTEM_INCIDENT_SEVERITY,
    occurredAt: fact.detected.occurredAt.toISOString(),
    description: systemIncidentDescription(fact),
    interruptionId: fact.interruptionId,
  };
}

/**
 * Create the one System incident for a committed heartbeat-detected episode.
 *
 * The command is append-only (no incident row lock): incident insert →
 * `incident_created` event (the operation-unique arbiter) → interruption
 * evidence link, all inside the caller's ONE transaction (F4A biconditional).
 * All authority is re-derived here from authoritative rows via the injected
 * lookups; a missing fact is fail-closed (404/400), never defaulted.
 */
export async function createSystemIncidentFromHeartbeatEpisode(
  repo: IncidentRepo,
  ctx: RequestContext,
  fact: HeartbeatEpisodeFact,
  deps: {
    now: Date;
    audit: IncidentAuditFn;
    lookupEpisode: (
      interruptionId: string,
    ) => Promise<{ attemptId: string } | null>;
    lookupDetectedEvent: (interruptionId: string) => Promise<{
      occurredAt: Date;
      observedLastActivityAt: Date | null;
      timeoutSeconds: number | null;
      detectionSource: string | null;
    } | null>;
    lookupAttempt: (attemptId: string) => Promise<AttemptScopeRow | null>;
  },
): Promise<IncidentCommandResult> {
  // F9 anti-spoofing: the seam is bound to the single detector actor id from
  // the closed SYSTEM_ACTOR_IDS set. A human context (or any other System
  // actor) can never mint a System incident through this command.
  if (
    ctx.role !== Role.System ||
    ctx.actorId !== SYSTEM_ACTOR_IDS.IncidentDetector
  ) {
    throw new PermissionDeniedError(
      "System incident creation is restricted to system:incident-detector",
    );
  }

  const episodeId = fact.interruptionId;

  // Server-derived authority: episode → detected event → attempt (org-scoped).
  const episode = await deps.lookupEpisode(episodeId);
  if (!episode) throw new NotFoundError("Interruption episode not found");

  const detected = await deps.lookupDetectedEvent(episodeId);
  if (!detected) {
    throw new NotFoundError("Interruption episode detected event not found");
  }
  if (detected.detectionSource !== "heartbeat_timeout") {
    // The v1 detector set is exactly the heartbeat-disruption detector (F2);
    // a non-heartbeat episode is not a valid source fact for this command.
    throw new ValidationError(
      "Interruption episode is not a heartbeat-detected episode",
    );
  }

  const attempt = await deps.lookupAttempt(episode.attemptId);
  if (!attempt || attempt.organizationId !== ctx.organizationId) {
    throw new NotFoundError("Attempt not found");
  }

  const factChecked: HeartbeatEpisodeFact = {
    interruptionId: episodeId,
    examId: attempt.examId,
    attemptId: episode.attemptId,
    candidateId: attempt.candidateId,
    detected: {
      occurredAt: detected.occurredAt,
      observedLastActivityAt: detected.observedLastActivityAt,
      timeoutSeconds: detected.timeoutSeconds,
    },
  };
  const canonicalPayload = deriveSystemIncidentCanonicalPayload(factChecked);
  const operationId = systemIncidentOperationId(episodeId);

  // Replay/conflict resolution precedes every write (ADR-014 §9).
  const replay = await preReadOperationId(
    repo,
    ctx,
    operationId,
    SYSTEM_INCIDENT_CREATE_COMMAND,
    canonicalPayload,
  );
  if (replay) return replay;

  const incident = await repo.insert(ctx, {
    examId: factChecked.examId,
    attemptId: factChecked.attemptId,
    candidateId: factChecked.candidateId,
    type: SYSTEM_INCIDENT_TYPE,
    severity: SYSTEM_INCIDENT_SEVERITY,
    occurredAt: factChecked.detected.occurredAt,
    description: canonicalPayload.description as string,
    reportedBy: ctx.actorId,
    createdAt: deps.now,
    updatedAt: deps.now,
  });

  await repo.appendEvent(ctx, {
    incidentId: incident.id,
    eventType: "incident_created",
    commandType: SYSTEM_INCIDENT_CREATE_COMMAND,
    operationId,
    actorId: ctx.actorId,
    beforeVersion: 0,
    afterVersion: 1,
    payload: canonicalPayload,
    createdAt: deps.now,
  });

  // Evidence link in the SAME transaction: operation committed ⟺ link exists.
  await repo.insertInterruptionLink(ctx, {
    incidentId: incident.id,
    attemptId: factChecked.attemptId,
    interruptionId: episodeId,
    linkedBy: ctx.actorId,
    operationId,
    linkedAt: deps.now,
  });

  await deps.audit("incident.created", {
    incidentId: incident.id,
    examId: factChecked.examId,
    attemptId: factChecked.attemptId,
    type: SYSTEM_INCIDENT_TYPE,
    version: 1,
  });

  return { outcome: "applied", incident };
}
