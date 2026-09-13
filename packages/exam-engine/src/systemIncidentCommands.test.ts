import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamIncident, RequestContext } from "@exam/domain";
import {
  IdempotencyConflictError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@exam/domain";
import {
  createSystemIncidentFromHeartbeatEpisode,
  deriveSystemIncidentCanonicalPayload,
  SYSTEM_INCIDENT_CREATE_COMMAND,
  systemIncidentOperationId,
  type HeartbeatEpisodeFact,
} from "./systemIncidentCommands.js";
import type { IncidentRepo } from "./incidentCommands.js";

const NOW = new Date("2026-01-01T12:00:00.000Z");
const ORG_ID = "org-1";
const EXAM_ID = "exam-1";
const ATTEMPT_ID = "attempt-1";
const CANDIDATE_ID = "candidate-1";
const EPISODE_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

function systemCtx(actorId = "system:incident-detector"): RequestContext {
  return {
    actorId,
    organizationId: ORG_ID,
    role: "System",
    permissions: [],
    sessionId: actorId,
  };
}

const DETECTED_AT = new Date("2026-01-01T11:58:30.000Z");
const LAST_ACTIVITY_AT = new Date("2026-01-01T11:57:00.000Z");

function makeFact(
  overrides: Partial<HeartbeatEpisodeFact> = {},
): HeartbeatEpisodeFact {
  return {
    interruptionId: EPISODE_ID,
    examId: EXAM_ID,
    attemptId: ATTEMPT_ID,
    candidateId: CANDIDATE_ID,
    detected: {
      occurredAt: DETECTED_AT,
      observedLastActivityAt: LAST_ACTIVITY_AT,
      timeoutSeconds: 60,
    },
    ...overrides,
  };
}

function makeIncident(overrides: Partial<ExamIncident> = {}): ExamIncident {
  return {
    id: randomUUID(),
    organizationId: ORG_ID,
    examId: EXAM_ID,
    attemptId: ATTEMPT_ID,
    candidateId: CANDIDATE_ID,
    type: "network_interruption",
    severity: "info",
    status: "open",
    occurredAt: DETECTED_AT,
    description: "system incident",
    resolutionSummary: null,
    resolvedAt: null,
    resolvedBy: null,
    reportedBy: "system:incident-detector",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<IncidentRepo> = {}): IncidentRepo {
  const noop = vi.fn().mockResolvedValue(undefined) as never;
  return {
    insert: vi.fn().mockResolvedValue(makeIncident()) as never,
    findById: vi.fn().mockResolvedValue(null) as never,
    findByIdForUpdate: vi.fn().mockResolvedValue(null) as never,
    listByExam: vi.fn().mockResolvedValue([]) as never,
    update: vi.fn().mockResolvedValue(makeIncident()) as never,
    appendEvent: vi.fn().mockResolvedValue({ id: randomUUID() }) as never,
    findEventByOperationId: vi.fn().mockResolvedValue(null) as never,
    listEventsByIncident: vi.fn().mockResolvedValue([]) as never,
    insertActionLink: noop,
    findActionLinkByOperationId: vi.fn().mockResolvedValue(null) as never,
    findActionLinkByAction: vi.fn().mockResolvedValue(null) as never,
    listActionsByIncident: vi.fn().mockResolvedValue([]) as never,
    insertAttemptMembership: noop,
    findAttemptMembershipByOperationId: vi
      .fn()
      .mockResolvedValue(null) as never,
    listAttemptsByIncident: vi.fn().mockResolvedValue([]) as never,
    insertInterruptionLink: vi.fn().mockResolvedValue(undefined) as never,
    findInterruptionLinkByOperationId: vi.fn().mockResolvedValue(null) as never,
    listInterruptionLinksByIncident: vi.fn().mockResolvedValue([]) as never,
    ...overrides,
  };
}

function makeDeps(
  overrides: {
    fact?: Partial<HeartbeatEpisodeFact>;
    repo?: Partial<IncidentRepo>;
  } = {},
) {
  const fact = makeFact(overrides.fact);
  const audit = vi.fn().mockResolvedValue(undefined);
  return {
    fact,
    audit,
    deps: {
      now: NOW,
      audit,
      lookupEpisode: vi
        .fn()
        .mockResolvedValue({ attemptId: fact.attemptId }) as never,
      lookupDetectedEvent: vi.fn().mockResolvedValue({
        occurredAt: fact.detected.occurredAt,
        observedLastActivityAt: fact.detected.observedLastActivityAt,
        timeoutSeconds: fact.detected.timeoutSeconds,
        detectionSource: "heartbeat_timeout",
      }) as never,
      lookupAttempt: vi.fn().mockResolvedValue({
        examId: fact.examId,
        candidateId: fact.candidateId,
        organizationId: ORG_ID,
      }) as never,
    },
  };
}

describe("systemIncidentCommands — deterministic operation identity (F4)", () => {
  it("derives a stable UUID from the episode id (same episode → same operationId)", () => {
    const a = systemIncidentOperationId(EPISODE_ID);
    const b = systemIncidentOperationId(EPISODE_ID);
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("derives DIFFERENT operationIds for distinct episodes (no cross-episode dedupe)", () => {
    const other = systemIncidentOperationId(randomUUID());
    expect(other).not.toBe(systemIncidentOperationId(EPISODE_ID));
  });
});

describe("systemIncidentCommands — internal-only seam (F9 anti-spoofing)", () => {
  it("rejects a human context", async () => {
    const { deps } = makeDeps();
    const human: RequestContext = {
      actorId: "admin-1",
      organizationId: ORG_ID,
      role: "Admin",
      permissions: [],
      sessionId: randomUUID(),
    };
    await expect(
      createSystemIncidentFromHeartbeatEpisode(
        makeRepo(),
        human,
        makeFact(),
        deps,
      ),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("rejects a System context with a non-detector actor id", async () => {
    const { deps } = makeDeps();
    await expect(
      createSystemIncidentFromHeartbeatEpisode(
        makeRepo(),
        systemCtx("system:heartbeat"),
        makeFact(),
        deps,
      ),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe("systemIncidentCommands — createSystemIncidentFromHeartbeatEpisode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits incident + interruption link as ONE command (F4A) and audits canonical incident.created (F8)", async () => {
    const { deps, audit } = makeDeps();
    const repo = makeRepo();
    const result = await createSystemIncidentFromHeartbeatEpisode(
      repo,
      systemCtx(),
      makeFact(),
      deps,
    );

    expect(result.outcome).toBe("applied");

    // Anchored to the episode's attempt; candidate derived server-side.
    expect(repo.insert).toHaveBeenCalledOnce();
    const insertInput = vi.mocked(repo.insert).mock.calls[0]![1];
    expect(insertInput.attemptId).toBe(ATTEMPT_ID);
    expect(insertInput.candidateId).toBe(CANDIDATE_ID);
    expect(insertInput.examId).toBe(EXAM_ID);
    expect(insertInput.reportedBy).toBe("system:incident-detector");
    expect(insertInput.occurredAt).toEqual(DETECTED_AT);

    // Canonical incident.created event carrying the episode-derived operationId.
    expect(repo.appendEvent).toHaveBeenCalledOnce();
    const eventInput = vi.mocked(repo.appendEvent).mock.calls[0]![1];
    expect(eventInput.eventType).toBe("incident_created");
    expect(eventInput.commandType).toBe(SYSTEM_INCIDENT_CREATE_COMMAND);
    expect(eventInput.operationId).toBe(systemIncidentOperationId(EPISODE_ID));
    expect(eventInput.actorId).toBe("system:incident-detector");
    expect(eventInput.beforeVersion).toBe(0);
    expect(eventInput.afterVersion).toBe(1);

    // Evidence link to the episode, same deterministic operationId (biconditional:
    // operation committed ⟺ link exists).
    expect(repo.insertInterruptionLink).toHaveBeenCalledOnce();
    const linkInput = vi.mocked(repo.insertInterruptionLink).mock.calls[0]![1];
    expect(linkInput.incidentId).toBe(result.incident.id);
    expect(linkInput.attemptId).toBe(ATTEMPT_ID);
    expect(linkInput.interruptionId).toBe(EPISODE_ID);
    expect(linkInput.linkedBy).toBe("system:incident-detector");
    expect(linkInput.operationId).toBe(systemIncidentOperationId(EPISODE_ID));

    // Audit: canonical incident.created, identifiers only (no free text).
    expect(audit).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith("incident.created", {
      incidentId: expect.any(String),
      examId: EXAM_ID,
      attemptId: ATTEMPT_ID,
      type: "network_interruption",
      version: 1,
    });
  });

  it("replays the SAME incident on a committed identical operation (C2 semantics)", async () => {
    const { deps } = makeDeps();
    const committedIncident = makeIncident();
    const payload = deriveSystemIncidentCanonicalPayload(makeFact());
    const repo = makeRepo({
      findEventByOperationId: vi.fn().mockResolvedValue({
        id: randomUUID(),
        incidentId: committedIncident.id,
        eventType: "incident_created",
        commandType: SYSTEM_INCIDENT_CREATE_COMMAND,
        operationId: systemIncidentOperationId(EPISODE_ID),
        beforeVersion: 0,
        afterVersion: 1,
        payload,
      }) as never,
      findById: vi.fn().mockResolvedValue(committedIncident) as never,
    });

    const result = await createSystemIncidentFromHeartbeatEpisode(
      repo,
      systemCtx(),
      makeFact(),
      deps,
    );

    expect(result.outcome).toBe("idempotent_replayed");
    expect(result.incident.id).toBe(committedIncident.id);
    expect(repo.insert).not.toHaveBeenCalled();
    expect(repo.appendEvent).not.toHaveBeenCalled();
    expect(repo.insertInterruptionLink).not.toHaveBeenCalled();
  });

  it("throws IdempotencyConflictError when the operationId committed as a different command", async () => {
    const { deps } = makeDeps();
    const repo = makeRepo({
      findEventByOperationId: vi.fn().mockResolvedValue({
        id: randomUUID(),
        incidentId: randomUUID(),
        eventType: "incident_created",
        commandType: "createExamIncident",
        operationId: systemIncidentOperationId(EPISODE_ID),
        beforeVersion: 0,
        afterVersion: 1,
        payload: {},
      }) as never,
    });

    await expect(
      createSystemIncidentFromHeartbeatEpisode(
        repo,
        systemCtx(),
        makeFact(),
        deps,
      ),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("404s when the episode does not exist in the context organization", async () => {
    const { deps } = makeDeps();
    deps.lookupEpisode = vi.fn().mockResolvedValue(null) as never;
    await expect(
      createSystemIncidentFromHeartbeatEpisode(
        makeRepo(),
        systemCtx(),
        makeFact(),
        deps,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects an episode without a heartbeat_timeout detected event", async () => {
    const { deps } = makeDeps();
    deps.lookupDetectedEvent = vi.fn().mockResolvedValue(null) as never;
    await expect(
      createSystemIncidentFromHeartbeatEpisode(
        makeRepo(),
        systemCtx(),
        makeFact(),
        deps,
      ),
    ).rejects.toThrow(NotFoundError);

    const { deps: deps2 } = makeDeps();
    deps2.lookupDetectedEvent = vi.fn().mockResolvedValue({
      occurredAt: DETECTED_AT,
      observedLastActivityAt: LAST_ACTIVITY_AT,
      timeoutSeconds: 60,
      detectionSource: "migration_backfill",
    }) as never;
    await expect(
      createSystemIncidentFromHeartbeatEpisode(
        makeRepo(),
        systemCtx(),
        makeFact(),
        deps2,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("404s when the episode's attempt is missing or cross-organization", async () => {
    const { deps } = makeDeps();
    deps.lookupAttempt = vi.fn().mockResolvedValue(null) as never;
    await expect(
      createSystemIncidentFromHeartbeatEpisode(
        makeRepo(),
        systemCtx(),
        makeFact(),
        deps,
      ),
    ).rejects.toThrow(NotFoundError);

    const { deps: deps2 } = makeDeps();
    deps2.lookupAttempt = vi.fn().mockResolvedValue({
      examId: EXAM_ID,
      candidateId: CANDIDATE_ID,
      organizationId: "org-other",
    }) as never;
    await expect(
      createSystemIncidentFromHeartbeatEpisode(
        makeRepo(),
        systemCtx(),
        makeFact(),
        deps2,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("derives a bounded, deterministic description from the detected event", () => {
    const p1 = deriveSystemIncidentCanonicalPayload(makeFact());
    const p2 = deriveSystemIncidentCanonicalPayload(makeFact());
    expect(p1).toEqual(p2);
    const description = p1.description as string;
    expect(description.length).toBeLessThanOrEqual(1000);
    expect(description).toContain("heartbeat_timeout");
    expect(description).toContain(EPISODE_ID);
    expect(p1.interruptionId).toBe(EPISODE_ID);
    expect(p1.occurredAt).toBe(DETECTED_AT.toISOString());
  });
});
