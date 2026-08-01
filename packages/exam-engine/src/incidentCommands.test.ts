import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ExamIncident, RequestContext } from "@exam/domain";
import {
  IdempotencyConflictError,
  IncidentActionAlreadyLinkedError,
  IncidentVersionConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from "@exam/domain";
import {
  addIncidentNote,
  changeIncidentSeverity,
  createExamIncident,
  dismissExamIncident,
  linkIncidentAction,
  linkIncidentAttempt,
  linkIncidentInterruption,
  resolveExamIncident,
  startIncidentInvestigation,
  type IncidentRepo,
} from "./incidentCommands.js";

const NOW = new Date("2026-01-01T12:00:00.000Z");
const ORG_ID = "org-1";
const ACTOR_ID = "admin-1";
const EXAM_ID = "exam-1";
const ATTEMPT_ID = "attempt-1";
const CANDIDATE_ID = "candidate-1";

function ctx(): RequestContext {
  return {
    actorId: ACTOR_ID,
    organizationId: ORG_ID,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

function makeIncident(overrides: Partial<ExamIncident> = {}): ExamIncident {
  return {
    id: randomUUID(),
    organizationId: ORG_ID,
    examId: EXAM_ID,
    attemptId: null,
    candidateId: null,
    type: "other",
    severity: "info",
    status: "open",
    occurredAt: null,
    description: "test incident",
    resolutionSummary: null,
    resolvedAt: null,
    resolvedBy: null,
    reportedBy: ACTOR_ID,
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
    appendEvent: vi.fn().mockResolvedValue(undefined) as never,
    findEventByOperationId: vi.fn().mockResolvedValue(null) as never,
    listEventsByIncident: vi.fn().mockResolvedValue([]) as never,
    insertActionLink: vi.fn().mockResolvedValue(undefined) as never,
    findActionLinkByOperationId: vi.fn().mockResolvedValue(null) as never,
    findActionLinkByAction: vi.fn().mockResolvedValue(null) as never,
    listActionsByIncident: vi.fn().mockResolvedValue([]) as never,
    insertAttemptMembership: vi.fn().mockResolvedValue(undefined) as never,
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

const noopAudit = vi.fn().mockResolvedValue(undefined);

describe("incidentCommands — createExamIncident", () => {
  it("creates an incident and returns applied outcome", async () => {
    const repo = makeRepo();
    const result = await createExamIncident(
      repo,
      ctx(),
      {
        operationId: randomUUID(),
        examId: EXAM_ID,
        attemptId: null,
        candidateId: null,
        type: "network_interruption",
        description: "Network down",
      },
      { now: NOW, audit: noopAudit },
    );

    expect(result.outcome).toBe("applied");
    expect(repo.insert).toHaveBeenCalledOnce();
    expect(repo.appendEvent).toHaveBeenCalledOnce();
  });

  it("rejects an invalid incident type", async () => {
    const repo = makeRepo();
    await expect(
      createExamIncident(
        repo,
        ctx(),
        {
          operationId: randomUUID(),
          examId: EXAM_ID,
          type: "invalid_type",
          description: "test",
        },
        { now: NOW, audit: noopAudit },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("replays same operationId + same payload as idempotent_replayed", async () => {
    const opId = randomUUID();
    const incident = makeIncident();
    const repo = makeRepo({
      findEventByOperationId: vi.fn().mockResolvedValue({
        id: randomUUID(),
        incidentId: incident.id,
        eventType: "incident_created",
        commandType: "createExamIncident",
        operationId: opId,
        beforeVersion: 0,
        afterVersion: 1,
        payload: {
          examId: EXAM_ID,
          attemptId: null,
          candidateId: null,
          type: "other",
          severity: "info",
          occurredAt: null,
          description: "test",
        },
      }) as never,
      findById: vi.fn().mockResolvedValue(incident) as never,
    });

    const result = await createExamIncident(
      repo,
      ctx(),
      {
        operationId: opId,
        examId: EXAM_ID,
        type: "other",
        description: "test",
      },
      { now: NOW, audit: noopAudit },
    );

    expect(result.outcome).toBe("idempotent_replayed");
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("throws IdempotencyConflictError on same operationId + different payload", async () => {
    const opId = randomUUID();
    const repo = makeRepo({
      findEventByOperationId: vi.fn().mockResolvedValue({
        id: randomUUID(),
        incidentId: randomUUID(),
        eventType: "incident_created",
        commandType: "createExamIncident",
        operationId: opId,
        beforeVersion: 0,
        afterVersion: 1,
        payload: { examId: EXAM_ID, type: "other", description: "different" },
      }) as never,
    });

    await expect(
      createExamIncident(
        repo,
        ctx(),
        {
          operationId: opId,
          examId: EXAM_ID,
          type: "other",
          description: "test",
        },
        { now: NOW, audit: noopAudit },
      ),
    ).rejects.toThrow(IdempotencyConflictError);
  });
});

describe("incidentCommands — addIncidentNote", () => {
  it("appends a note event without bumping version", async () => {
    const incident = makeIncident({ version: 3 });
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
    });
    const result = await addIncidentNote(
      repo,
      ctx(),
      incident.id,
      {
        operationId: randomUUID(),
        body: "a note",
      },
      { now: NOW, audit: noopAudit },
    );

    expect(result.outcome).toBe("applied");
    expect(repo.appendEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        beforeVersion: 3,
        afterVersion: 3,
        eventType: "note_added",
      }),
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when incident does not exist", async () => {
    const repo = makeRepo();
    await expect(
      addIncidentNote(
        repo,
        ctx(),
        randomUUID(),
        {
          operationId: randomUUID(),
          body: "note",
        },
        { now: NOW, audit: noopAudit },
      ),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("incidentCommands — startIncidentInvestigation", () => {
  it("transitions open → investigating and bumps version", async () => {
    const incident = makeIncident({ status: "open", version: 1 });
    const updated = makeIncident({ status: "investigating", version: 2 });
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
      findByIdForUpdate: vi.fn().mockResolvedValue(incident) as never,
      update: vi.fn().mockResolvedValue(updated) as never,
    });

    const result = await startIncidentInvestigation(
      repo,
      ctx(),
      incident.id,
      {
        operationId: randomUUID(),
        expectedVersion: 1,
      },
      { now: NOW, audit: noopAudit },
    );

    expect(result.outcome).toBe("applied");
    expect(repo.update).toHaveBeenCalledWith(
      expect.anything(),
      incident.id,
      expect.objectContaining({ status: "investigating", version: 2 }),
    );
  });

  it("throws IncidentVersionConflictError on stale expectedVersion", async () => {
    const incident = makeIncident({ status: "open", version: 5 });
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
      findByIdForUpdate: vi.fn().mockResolvedValue(incident) as never,
    });

    await expect(
      startIncidentInvestigation(
        repo,
        ctx(),
        incident.id,
        {
          operationId: randomUUID(),
          expectedVersion: 1,
        },
        { now: NOW, audit: noopAudit },
      ),
    ).rejects.toThrow(IncidentVersionConflictError);
  });

  it("throws InvalidStateTransitionError on terminal status", async () => {
    const incident = makeIncident({ status: "resolved", version: 2 });
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
      findByIdForUpdate: vi.fn().mockResolvedValue(incident) as never,
    });

    await expect(
      startIncidentInvestigation(
        repo,
        ctx(),
        incident.id,
        {
          operationId: randomUUID(),
          expectedVersion: 2,
        },
        { now: NOW, audit: noopAudit },
      ),
    ).rejects.toThrow(InvalidStateTransitionError);
  });
});

describe("incidentCommands — changeIncidentSeverity", () => {
  it("rejects an invalid severity", async () => {
    const repo = makeRepo();
    await expect(
      changeIncidentSeverity(
        repo,
        ctx(),
        randomUUID(),
        {
          operationId: randomUUID(),
          expectedVersion: 1,
          severity: "catastrophic",
        },
        { now: NOW, audit: noopAudit },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("changes severity and bumps version on non-terminal incident", async () => {
    const incident = makeIncident({
      status: "investigating",
      version: 2,
      severity: "info",
    });
    const updated = makeIncident({
      status: "investigating",
      version: 3,
      severity: "critical",
    });
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
      findByIdForUpdate: vi.fn().mockResolvedValue(incident) as never,
      update: vi.fn().mockResolvedValue(updated) as never,
    });

    const result = await changeIncidentSeverity(
      repo,
      ctx(),
      incident.id,
      {
        operationId: randomUUID(),
        expectedVersion: 2,
        severity: "critical",
      },
      { now: NOW, audit: noopAudit },
    );

    expect(result.outcome).toBe("applied");
    expect(result.incident.severity).toBe("critical");
  });
});

describe("incidentCommands — resolveExamIncident", () => {
  it("transitions open → resolved with resolution summary", async () => {
    const incident = makeIncident({ status: "open", version: 1 });
    const updated = makeIncident({
      status: "resolved",
      version: 2,
      resolutionSummary: "Fixed",
    });
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
      findByIdForUpdate: vi.fn().mockResolvedValue(incident) as never,
      update: vi.fn().mockResolvedValue(updated) as never,
    });

    const result = await resolveExamIncident(
      repo,
      ctx(),
      incident.id,
      {
        operationId: randomUUID(),
        expectedVersion: 1,
        resolutionSummary: "Fixed",
      },
      { now: NOW, audit: noopAudit },
    );

    expect(result.outcome).toBe("applied");
    expect(result.incident.status).toBe("resolved");
  });
});

describe("incidentCommands — dismissExamIncident", () => {
  it("transitions investigating → dismissed", async () => {
    const incident = makeIncident({ status: "investigating", version: 3 });
    const updated = makeIncident({ status: "dismissed", version: 4 });
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
      findByIdForUpdate: vi.fn().mockResolvedValue(incident) as never,
      update: vi.fn().mockResolvedValue(updated) as never,
    });

    const result = await dismissExamIncident(
      repo,
      ctx(),
      incident.id,
      {
        operationId: randomUUID(),
        expectedVersion: 3,
        reasonText: "Duplicate",
      },
      { now: NOW, audit: noopAudit },
    );

    expect(result.outcome).toBe("applied");
    expect(result.incident.status).toBe("dismissed");
  });
});

describe("incidentCommands — linkIncidentAction", () => {
  it("rejects misconduct_mark action type", async () => {
    const repo = makeRepo();
    await expect(
      linkIncidentAction(
        repo,
        ctx(),
        randomUUID(),
        {
          operationId: randomUUID(),
          actionType: "misconduct_mark",
          actionId: "attempt-1",
        },
        {
          now: NOW,
          audit: noopAudit,
          lookupAdjustmentAttempt: vi.fn(),
          lookupForceSubmitAudit: vi.fn(),
          lookupAttempt: vi.fn(),
          lookupActionLink: vi.fn(),
        },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an invalid action type", async () => {
    const repo = makeRepo();
    await expect(
      linkIncidentAction(
        repo,
        ctx(),
        randomUUID(),
        {
          operationId: randomUUID(),
          actionType: "invalid_action",
          actionId: "x",
        },
        {
          now: NOW,
          audit: noopAudit,
          lookupAdjustmentAttempt: vi.fn(),
          lookupForceSubmitAudit: vi.fn(),
          lookupAttempt: vi.fn(),
          lookupActionLink: vi.fn(),
        },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError when incident does not exist", async () => {
    const repo = makeRepo();
    await expect(
      linkIncidentAction(
        repo,
        ctx(),
        randomUUID(),
        {
          operationId: randomUUID(),
          actionType: "force_submit",
          actionId: ATTEMPT_ID,
        },
        {
          now: NOW,
          audit: noopAudit,
          lookupForceSubmitAudit: vi.fn().mockResolvedValue(true),
          lookupAttempt: vi.fn().mockResolvedValue({
            examId: EXAM_ID,
            candidateId: CANDIDATE_ID,
            organizationId: ORG_ID,
          }),
          lookupActionLink: vi.fn().mockResolvedValue(false),
        },
      ),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("incidentCommands — linkIncidentAttempt", () => {
  it("rejects membership on an anchored incident", async () => {
    const incident = makeIncident({ attemptId: ATTEMPT_ID });
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
    });

    await expect(
      linkIncidentAttempt(
        repo,
        ctx(),
        incident.id,
        {
          operationId: randomUUID(),
          attemptId: "other-attempt",
          relationshipType: "affected",
        },
        { now: NOW, audit: noopAudit },
      ),
    ).rejects.toThrow(InvalidStateTransitionError);
  });

  it("rejects an invalid relationship type", async () => {
    const incident = makeIncident({ attemptId: null });
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
    });

    await expect(
      linkIncidentAttempt(
        repo,
        ctx(),
        incident.id,
        {
          operationId: randomUUID(),
          attemptId: ATTEMPT_ID,
          relationshipType: "invalid",
        },
        { now: NOW, audit: noopAudit },
      ),
    ).rejects.toThrow(ValidationError);
  });
});

describe("incidentCommands — linkIncidentInterruption", () => {
  it("requires lookupInterruptionAttempt dep", async () => {
    const incident = makeIncident();
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
    });

    await expect(
      linkIncidentInterruption(
        repo,
        ctx(),
        incident.id,
        {
          operationId: randomUUID(),
          interruptionId: randomUUID(),
        },
        { now: NOW, audit: noopAudit },
      ),
    ).rejects.toThrow();
  });
});

describe("incidentCommands — scope quadruple validation", () => {
  it("rejects cross-organization attempt", async () => {
    const { validateScopeQuadruple } = await import("./incidentCommands.js");
    const incident = {
      organizationId: ORG_ID,
      examId: EXAM_ID,
      attemptId: null,
      candidateId: null,
    };
    const target = {
      examId: EXAM_ID,
      candidateId: null,
      organizationId: "other-org",
    };
    await expect(
      validateScopeQuadruple(incident, target, ATTEMPT_ID, ORG_ID),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects cross-exam attempt", async () => {
    const { validateScopeQuadruple } = await import("./incidentCommands.js");
    const incident = {
      organizationId: ORG_ID,
      examId: EXAM_ID,
      attemptId: null,
      candidateId: null,
    };
    const target = {
      examId: "other-exam",
      candidateId: null,
      organizationId: ORG_ID,
    };
    await expect(
      validateScopeQuadruple(incident, target, ATTEMPT_ID, ORG_ID),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects anchored attempt mismatch", async () => {
    const { validateScopeQuadruple } = await import("./incidentCommands.js");
    const incident = {
      organizationId: ORG_ID,
      examId: EXAM_ID,
      attemptId: "anchored-attempt",
      candidateId: null,
    };
    const target = {
      examId: EXAM_ID,
      candidateId: null,
      organizationId: ORG_ID,
    };
    await expect(
      validateScopeQuadruple(incident, target, "different-attempt", ORG_ID),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects candidate mismatch when incident.candidateId is set", async () => {
    const { validateScopeQuadruple } = await import("./incidentCommands.js");
    const incident = {
      organizationId: ORG_ID,
      examId: EXAM_ID,
      attemptId: null,
      candidateId: "candidate-A",
    };
    const target = {
      examId: EXAM_ID,
      candidateId: "candidate-B",
      organizationId: ORG_ID,
    };
    await expect(
      validateScopeQuadruple(incident, target, ATTEMPT_ID, ORG_ID),
    ).rejects.toThrow(ValidationError);
  });

  it("accepts matching scope quadruple", async () => {
    const { validateScopeQuadruple } = await import("./incidentCommands.js");
    const incident = {
      organizationId: ORG_ID,
      examId: EXAM_ID,
      attemptId: null,
      candidateId: null,
    };
    const target = {
      examId: EXAM_ID,
      candidateId: null,
      organizationId: ORG_ID,
    };
    await expect(
      validateScopeQuadruple(incident, target, ATTEMPT_ID, ORG_ID),
    ).resolves.toBeUndefined();
  });
});
