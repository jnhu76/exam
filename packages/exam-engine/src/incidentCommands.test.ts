import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamIncident, RequestContext } from "@exam/domain";
import {
  IdempotencyConflictError,
  IncidentActionAlreadyLinkedError,
  IncidentVersionConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from "@exam/domain";
import type {
  IncidentActionType,
  IncidentRelationshipType,
  IncidentSeverity,
  IncidentType,
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
    appendEvent: vi.fn().mockResolvedValue({ id: randomUUID() }) as never,
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

/** lookupExam that resolves the exam in ctx org (fail-closed default). */
const lookupExamInOrg = vi.fn().mockResolvedValue({
  organizationId: ORG_ID,
  id: EXAM_ID,
});

describe("incidentCommands — createExamIncident", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookupExamInOrg.mockResolvedValue({ organizationId: ORG_ID, id: EXAM_ID });
  });

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
      { now: NOW, audit: noopAudit, lookupExam: lookupExamInOrg },
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
          type: "invalid_type" as IncidentType,
          description: "test",
        },
        { now: NOW, audit: noopAudit, lookupExam: lookupExamInOrg },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError when exam is missing (404 RESOURCE_NOT_FOUND)", async () => {
    const repo = makeRepo();
    const missing = vi.fn().mockResolvedValue(null);
    await expect(
      createExamIncident(
        repo,
        ctx(),
        {
          operationId: randomUUID(),
          examId: EXAM_ID,
          type: "other",
          description: "test",
        },
        { now: NOW, audit: noopAudit, lookupExam: missing },
      ),
    ).rejects.toThrow(NotFoundError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("throws NotFoundError on cross-org exam", async () => {
    const repo = makeRepo();
    const crossOrg = vi.fn().mockResolvedValue({
      organizationId: "other-org",
      id: EXAM_ID,
    });
    await expect(
      createExamIncident(
        repo,
        ctx(),
        {
          operationId: randomUUID(),
          examId: EXAM_ID,
          type: "other",
          description: "test",
        },
        { now: NOW, audit: noopAudit, lookupExam: crossOrg },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("derives candidateId from the authoritative attempt (set/null matrix)", async () => {
    const inserted = makeIncident({
      attemptId: ATTEMPT_ID,
      candidateId: CANDIDATE_ID,
    });
    const repo = makeRepo({
      insert: vi.fn().mockResolvedValue(inserted) as never,
    });
    const lookupAttempt = vi.fn().mockResolvedValue({
      examId: EXAM_ID,
      candidateId: CANDIDATE_ID,
      organizationId: ORG_ID,
    });
    await createExamIncident(
      repo,
      ctx(),
      {
        operationId: randomUUID(),
        examId: EXAM_ID,
        attemptId: ATTEMPT_ID,
        candidateId: null,
        type: "other",
        description: "anchored",
      },
      {
        now: NOW,
        audit: noopAudit,
        lookupExam: lookupExamInOrg,
        lookupAttempt,
      },
    );
    expect(repo.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attemptId: ATTEMPT_ID,
        candidateId: CANDIDATE_ID,
      }),
    );
  });

  it("rejects candidate not enrolled when attemptId null + candidateId set", async () => {
    const repo = makeRepo();
    const notEnrolled = vi.fn().mockResolvedValue(false);
    await expect(
      createExamIncident(
        repo,
        ctx(),
        {
          operationId: randomUUID(),
          examId: EXAM_ID,
          candidateId: CANDIDATE_ID,
          type: "other",
          description: "candidate focus",
        },
        {
          now: NOW,
          audit: noopAudit,
          lookupExam: lookupExamInOrg,
          lookupEnrollment: notEnrolled,
        },
      ),
    ).rejects.toThrow(ValidationError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("rejects when description is empty/whitespace (fail closed)", async () => {
    const repo = makeRepo();
    for (const bad of ["", "   ", "\n\t"]) {
      await expect(
        createExamIncident(
          repo,
          ctx(),
          {
            operationId: randomUUID(),
            examId: EXAM_ID,
            type: "other",
            description: bad,
          },
          { now: NOW, audit: noopAudit, lookupExam: lookupExamInOrg },
        ),
      ).rejects.toThrow(ValidationError);
    }
    expect(repo.insert).not.toHaveBeenCalled();
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
      { now: NOW, audit: noopAudit, lookupExam: lookupExamInOrg },
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
        { now: NOW, audit: noopAudit, lookupExam: lookupExamInOrg },
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
          severity: "catastrophic" as IncidentSeverity,
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
          actionType: "misconduct_mark" as IncidentActionType,
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
          actionType: "invalid_action" as IncidentActionType,
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
        { now: NOW, audit: noopAudit, lookupAttempt: vi.fn() },
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
          relationshipType: "invalid" as IncidentRelationshipType,
        },
        { now: NOW, audit: noopAudit, lookupAttempt: vi.fn() },
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
        { now: NOW, audit: noopAudit, lookupAttempt: vi.fn() },
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

describe("incidentCommands — required string normalization (fail closed)", () => {
  it("addIncidentNote rejects empty/whitespace body with no event", async () => {
    const incident = makeIncident({ version: 3 });
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
    });
    for (const bad of ["", "  ", "\n\t"]) {
      await expect(
        addIncidentNote(
          repo,
          ctx(),
          incident.id,
          { operationId: randomUUID(), body: bad },
          { now: NOW, audit: noopAudit },
        ),
      ).rejects.toThrow(ValidationError);
    }
    expect(repo.appendEvent).not.toHaveBeenCalled();
  });

  it("resolveExamIncident rejects empty/whitespace resolutionSummary", async () => {
    const incident = makeIncident({ status: "open", version: 1 });
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
      findByIdForUpdate: vi.fn().mockResolvedValue(incident) as never,
    });
    for (const bad of ["", "  "]) {
      await expect(
        resolveExamIncident(
          repo,
          ctx(),
          incident.id,
          {
            operationId: randomUUID(),
            expectedVersion: 1,
            resolutionSummary: bad,
          },
          { now: NOW, audit: noopAudit },
        ),
      ).rejects.toThrow(ValidationError);
    }
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("dismissExamIncident rejects empty/whitespace reasonText", async () => {
    const incident = makeIncident({ status: "open", version: 1 });
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
      findByIdForUpdate: vi.fn().mockResolvedValue(incident) as never,
    });
    for (const bad of ["", "  "]) {
      await expect(
        dismissExamIncident(
          repo,
          ctx(),
          incident.id,
          {
            operationId: randomUUID(),
            expectedVersion: 1,
            reasonText: bad,
          },
          { now: NOW, audit: noopAudit },
        ),
      ).rejects.toThrow(ValidationError);
    }
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe("incidentCommands — event/audit evidence accuracy", () => {
  it("addIncidentNote audit references the real event id, not operationId", async () => {
    const incident = makeIncident({ version: 3 });
    const eventId = randomUUID();
    const opId = randomUUID();
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
      appendEvent: vi.fn().mockResolvedValue({ id: eventId }) as never,
    });
    const audit = vi.fn().mockResolvedValue(undefined);
    await addIncidentNote(
      repo,
      ctx(),
      incident.id,
      { operationId: opId, body: "note" },
      { now: NOW, audit },
    );
    expect(audit).toHaveBeenCalledWith(
      "incident.note_added",
      expect.objectContaining({ noteId: eventId }),
    );
    // The operationId must NOT masquerade as noteId.
    const meta = audit.mock.calls[0]![1] as Record<string, unknown>;
    expect(meta.noteId).not.toBe(opId);
  });

  it("changeIncidentSeverity event payload carries before/after severity", async () => {
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
    const audit = vi.fn().mockResolvedValue(undefined);
    await changeIncidentSeverity(
      repo,
      ctx(),
      incident.id,
      {
        operationId: randomUUID(),
        expectedVersion: 2,
        severity: "critical",
      },
      { now: NOW, audit },
    );
    // Audit before/after come from authoritative locked vs updated rows.
    expect(audit).toHaveBeenCalledWith(
      "incident.severity_changed",
      expect.objectContaining({
        beforeSeverity: "info",
        afterSeverity: "critical",
      }),
    );
    // Event payload also self-describes before/after.
    expect(repo.appendEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "severity_changed",
        beforeVersion: 2,
        afterVersion: 3,
        payload: expect.objectContaining({
          beforeSeverity: "info",
          afterSeverity: "critical",
        }),
      }),
    );
  });

  it("audit metadata does not copy free-text bodies (privacy)", async () => {
    const incident = makeIncident({ status: "open", version: 1 });
    const updated = makeIncident({ status: "resolved", version: 2 });
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
      findByIdForUpdate: vi.fn().mockResolvedValue(incident) as never,
      update: vi.fn().mockResolvedValue(updated) as never,
    });
    const audit = vi.fn().mockResolvedValue(undefined);
    await resolveExamIncident(
      repo,
      ctx(),
      incident.id,
      {
        operationId: randomUUID(),
        expectedVersion: 1,
        resolutionSummary: "secret PII content",
      },
      { now: NOW, audit },
    );
    const meta = audit.mock.calls[0]![1] as Record<string, unknown>;
    expect(meta.resolutionSummary).toBeUndefined();
    expect(meta.reasonText).toBeUndefined();
  });
});

describe("incidentCommands — canonical operationId identity", () => {
  it("version command canonical payload includes incidentId + expectedVersion", async () => {
    const incident = makeIncident({ status: "open", version: 1 });
    const opId = randomUUID();
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(incident) as never,
      findByIdForUpdate: vi.fn().mockResolvedValue(incident) as never,
      update: vi
        .fn()
        .mockResolvedValue(
          makeIncident({ status: "investigating", version: 2 }),
        ) as never,
      // A prior commit with the SAME opId but a payload missing incidentId /
      // expectedVersion must count as a DIFFERENT payload → conflict.
      findEventByOperationId: vi.fn().mockResolvedValue({
        id: randomUUID(),
        incidentId: incident.id,
        eventType: "investigation_started",
        commandType: "startIncidentInvestigation",
        operationId: opId,
        beforeVersion: 1,
        afterVersion: 2,
        payload: { reasonCode: null, reasonText: null },
      }) as never,
    });
    await expect(
      startIncidentInvestigation(
        repo,
        ctx(),
        incident.id,
        { operationId: opId, expectedVersion: 1 },
        { now: NOW, audit: noopAudit },
      ),
    ).rejects.toThrow(IdempotencyConflictError);
  });
});

describe("incidentCommands — link scope authority (fail-closed lookupAttempt)", () => {
  /** Exam-wide incident fixture (no anchor, no candidate focus). */
  function examWideIncident(): ExamIncident {
    return makeIncident({ attemptId: null, candidateId: null });
  }

  describe("linkIncidentAction", () => {
    const deps = (overrides: Record<string, unknown> = {}) => ({
      now: NOW,
      audit: noopAudit,
      lookupAdjustmentAttempt: vi.fn().mockResolvedValue(ATTEMPT_ID),
      lookupAttempt: vi.fn().mockResolvedValue({
        examId: EXAM_ID,
        candidateId: CANDIDATE_ID,
        organizationId: ORG_ID,
      }),
      lookupActionLink: vi.fn().mockResolvedValue(false),
      ...overrides,
    });

    it("rejects a cross-exam target attempt (400)", async () => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWideIncident()) as never,
      });
      await expect(
        linkIncidentAction(
          repo,
          ctx(),
          examWideIncident().id,
          {
            operationId: randomUUID(),
            actionType: "time_grant",
            actionId: "adjustment-1",
          },
          deps({
            lookupAttempt: vi.fn().mockResolvedValue({
              examId: "other-exam",
              candidateId: CANDIDATE_ID,
              organizationId: ORG_ID,
            }),
          }),
        ),
      ).rejects.toThrow(ValidationError);
      expect(repo.insertActionLink).not.toHaveBeenCalled();
    });

    it("rejects a candidate mismatch against the incident candidate focus (400)", async () => {
      const repo = makeRepo({
        findById: vi
          .fn()
          .mockResolvedValue(
            makeIncident({ attemptId: null, candidateId: "candidate-A" }),
          ) as never,
      });
      await expect(
        linkIncidentAction(
          repo,
          ctx(),
          randomUUID(),
          {
            operationId: randomUUID(),
            actionType: "time_grant",
            actionId: "adjustment-1",
          },
          deps({
            lookupAttempt: vi.fn().mockResolvedValue({
              examId: EXAM_ID,
              candidateId: "candidate-B",
              organizationId: ORG_ID,
            }),
          }),
        ),
      ).rejects.toThrow(ValidationError);
      expect(repo.insertActionLink).not.toHaveBeenCalled();
    });

    it("rejects a cross-org target attempt (engine fail-closed; API 404 via org-scoped lookup)", async () => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWideIncident()) as never,
      });
      await expect(
        linkIncidentAction(
          repo,
          ctx(),
          examWideIncident().id,
          {
            operationId: randomUUID(),
            actionType: "time_grant",
            actionId: "adjustment-1",
          },
          deps({
            lookupAttempt: vi.fn().mockResolvedValue({
              examId: EXAM_ID,
              candidateId: CANDIDATE_ID,
              organizationId: "other-org",
            }),
          }),
        ),
      ).rejects.toThrow(ValidationError);
      expect(repo.insertActionLink).not.toHaveBeenCalled();
    });

    it("404s when the authoritative attempt is missing", async () => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWideIncident()) as never,
      });
      await expect(
        linkIncidentAction(
          repo,
          ctx(),
          examWideIncident().id,
          {
            operationId: randomUUID(),
            actionType: "time_grant",
            actionId: "adjustment-1",
          },
          deps({ lookupAttempt: vi.fn().mockResolvedValue(null) }),
        ),
      ).rejects.toThrow(NotFoundError);
      expect(repo.insertActionLink).not.toHaveBeenCalled();
    });

    it("unconditionally validates the scope quadruple (lookupAttempt cannot be skipped)", async () => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWideIncident()) as never,
      });
      const lookupAttempt = vi.fn().mockResolvedValue({
        examId: "other-exam",
        candidateId: null,
        organizationId: ORG_ID,
      });
      await expect(
        linkIncidentAction(
          repo,
          ctx(),
          examWideIncident().id,
          {
            operationId: randomUUID(),
            actionType: "time_grant",
            actionId: "adjustment-1",
          },
          {
            now: NOW,
            audit: noopAudit,
            lookupAdjustmentAttempt: vi.fn().mockResolvedValue(ATTEMPT_ID),
            lookupAttempt,
            lookupActionLink: vi.fn().mockResolvedValue(false),
          },
        ),
      ).rejects.toThrow(ValidationError);
      expect(lookupAttempt).toHaveBeenCalledWith(ATTEMPT_ID);
      expect(repo.insertActionLink).not.toHaveBeenCalled();
    });
  });

  describe("linkIncidentAttempt", () => {
    const deps = (overrides: Record<string, unknown> = {}) => ({
      now: NOW,
      audit: noopAudit,
      lookupAttempt: vi.fn().mockResolvedValue({
        examId: EXAM_ID,
        candidateId: CANDIDATE_ID,
        organizationId: ORG_ID,
      }),
      ...overrides,
    });

    it("rejects a target attempt from a different exam (400)", async () => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWideIncident()) as never,
      });
      await expect(
        linkIncidentAttempt(
          repo,
          ctx(),
          examWideIncident().id,
          {
            operationId: randomUUID(),
            attemptId: ATTEMPT_ID,
            relationshipType: "affected",
          },
          deps({
            lookupAttempt: vi.fn().mockResolvedValue({
              examId: "other-exam",
              candidateId: CANDIDATE_ID,
              organizationId: ORG_ID,
            }),
          }),
        ),
      ).rejects.toThrow(ValidationError);
      expect(repo.insertAttemptMembership).not.toHaveBeenCalled();
    });

    it("rejects a candidate mismatch against the incident candidate focus (400)", async () => {
      const repo = makeRepo({
        findById: vi
          .fn()
          .mockResolvedValue(
            makeIncident({ attemptId: null, candidateId: "candidate-A" }),
          ) as never,
      });
      await expect(
        linkIncidentAttempt(
          repo,
          ctx(),
          randomUUID(),
          {
            operationId: randomUUID(),
            attemptId: ATTEMPT_ID,
            relationshipType: "referenced",
          },
          deps({
            lookupAttempt: vi.fn().mockResolvedValue({
              examId: EXAM_ID,
              candidateId: "candidate-B",
              organizationId: ORG_ID,
            }),
          }),
        ),
      ).rejects.toThrow(ValidationError);
      expect(repo.insertAttemptMembership).not.toHaveBeenCalled();
    });

    it("404s when the target attempt is missing", async () => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWideIncident()) as never,
      });
      await expect(
        linkIncidentAttempt(
          repo,
          ctx(),
          examWideIncident().id,
          {
            operationId: randomUUID(),
            attemptId: ATTEMPT_ID,
            relationshipType: "affected",
          },
          deps({ lookupAttempt: vi.fn().mockResolvedValue(null) }),
        ),
      ).rejects.toThrow(NotFoundError);
      expect(repo.insertAttemptMembership).not.toHaveBeenCalled();
    });
  });

  describe("linkIncidentInterruption", () => {
    const deps = (overrides: Record<string, unknown> = {}) => ({
      now: NOW,
      audit: noopAudit,
      lookupInterruptionAttempt: vi.fn().mockResolvedValue(ATTEMPT_ID),
      lookupAttempt: vi.fn().mockResolvedValue({
        examId: EXAM_ID,
        candidateId: CANDIDATE_ID,
        organizationId: ORG_ID,
      }),
      ...overrides,
    });

    it("rejects an episode whose attempt scope does not match (400)", async () => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWideIncident()) as never,
      });
      await expect(
        linkIncidentInterruption(
          repo,
          ctx(),
          examWideIncident().id,
          {
            operationId: randomUUID(),
            interruptionId: randomUUID(),
          },
          deps({
            lookupAttempt: vi.fn().mockResolvedValue({
              examId: "other-exam",
              candidateId: CANDIDATE_ID,
              organizationId: ORG_ID,
            }),
          }),
        ),
      ).rejects.toThrow(ValidationError);
      expect(repo.insertInterruptionLink).not.toHaveBeenCalled();
    });

    it("404s when the target attempt is missing", async () => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWideIncident()) as never,
      });
      await expect(
        linkIncidentInterruption(
          repo,
          ctx(),
          examWideIncident().id,
          {
            operationId: randomUUID(),
            interruptionId: randomUUID(),
          },
          deps({ lookupAttempt: vi.fn().mockResolvedValue(null) }),
        ),
      ).rejects.toThrow(NotFoundError);
      expect(repo.insertInterruptionLink).not.toHaveBeenCalled();
    });
  });
});

describe("incidentCommands — wrapped PostgreSQL constraint detection (P1-B)", () => {
  const ACTION_UNIQUE = "exam_incident_actions_org_action_unique";
  const ATTEMPT_UNIQUE = "exam_incident_attempts_incident_attempt_unique";
  const INTERRUPTION_UNIQUE =
    "exam_incident_interruption_links_incident_interruption_unique";

  const examWide = makeIncident({ attemptId: null, candidateId: null });
  const matchAttempt = {
    examId: EXAM_ID,
    candidateId: CANDIDATE_ID,
    organizationId: ORG_ID,
  };

  describe("linkIncidentAction", () => {
    const baseDeps = {
      now: NOW,
      audit: noopAudit,
      lookupAdjustmentAttempt: vi.fn().mockResolvedValue(ATTEMPT_ID),
      lookupAttempt: vi.fn().mockResolvedValue(matchAttempt),
      lookupActionLink: vi.fn().mockResolvedValue(false),
    };
    const input = {
      operationId: randomUUID(),
      actionType: "time_grant" as IncidentActionType,
      actionId: "adjustment-1",
    };

    it.each([
      ["top-level 23505", { code: "23505", constraint: ACTION_UNIQUE }],
      [
        "one-level wrapped 23505",
        new Error("dup", {
          cause: { code: "23505", constraint_name: ACTION_UNIQUE },
        }),
      ],
      [
        "multi-level wrapped 23505",
        new Error("outer", {
          cause: new Error("mid", {
            cause: { code: "23505", constraint: ACTION_UNIQUE },
          }),
        }),
      ],
    ])("%s maps to INCIDENT_ACTION_ALREADY_LINKED", async (_label, err) => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWide) as never,
        insertActionLink: vi.fn().mockRejectedValue(err) as never,
      });
      await expect(
        linkIncidentAction(repo, ctx(), examWide.id, input, baseDeps),
      ).rejects.toThrow(IncidentActionAlreadyLinkedError);
    });

    it("an unrelated 23505 propagates unchanged", async () => {
      const err = { code: "23505", constraint: "users_org_username_unique" };
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWide) as never,
        insertActionLink: vi.fn().mockRejectedValue(err) as never,
      });
      await expect(
        linkIncidentAction(repo, ctx(), examWide.id, input, baseDeps),
      ).rejects.toBe(err);
    });

    it("a non-23505 error propagates unchanged", async () => {
      const err = { code: "42P01", message: "undefined_table" };
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWide) as never,
        insertActionLink: vi.fn().mockRejectedValue(err) as never,
      });
      await expect(
        linkIncidentAction(repo, ctx(), examWide.id, input, baseDeps),
      ).rejects.toBe(err);
    });
  });

  describe("linkIncidentAttempt", () => {
    const baseDeps = {
      now: NOW,
      audit: noopAudit,
      lookupAttempt: vi.fn().mockResolvedValue(matchAttempt),
    };
    const input = {
      operationId: randomUUID(),
      attemptId: ATTEMPT_ID,
      relationshipType: "affected" as IncidentRelationshipType,
    };

    it.each([
      [
        "multi-level wrapped 23505",
        new Error("outer", {
          cause: { code: "23505", constraint_name: ATTEMPT_UNIQUE },
        }),
      ],
    ])("%s maps to INCIDENT_ACTION_ALREADY_LINKED", async (_label, err) => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWide) as never,
        insertAttemptMembership: vi.fn().mockRejectedValue(err) as never,
      });
      await expect(
        linkIncidentAttempt(repo, ctx(), examWide.id, input, baseDeps),
      ).rejects.toThrow(IncidentActionAlreadyLinkedError);
    });

    it("an unrelated 23505 propagates unchanged", async () => {
      const err = { code: "23505", constraint: "other_unique" };
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWide) as never,
        insertAttemptMembership: vi.fn().mockRejectedValue(err) as never,
      });
      await expect(
        linkIncidentAttempt(repo, ctx(), examWide.id, input, baseDeps),
      ).rejects.toBe(err);
    });
  });

  describe("linkIncidentInterruption", () => {
    const baseDeps = {
      now: NOW,
      audit: noopAudit,
      lookupInterruptionAttempt: vi.fn().mockResolvedValue(ATTEMPT_ID),
      lookupAttempt: vi.fn().mockResolvedValue(matchAttempt),
    };
    const input = {
      operationId: randomUUID(),
      interruptionId: randomUUID(),
    };

    it.each([
      [
        "multi-level wrapped 23505",
        new Error("outer", {
          cause: new Error("mid", {
            cause: { code: "23505", constraint: INTERRUPTION_UNIQUE },
          }),
        }),
      ],
    ])("%s maps to INCIDENT_ACTION_ALREADY_LINKED", async (_label, err) => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWide) as never,
        insertInterruptionLink: vi.fn().mockRejectedValue(err) as never,
      });
      await expect(
        linkIncidentInterruption(repo, ctx(), examWide.id, input, baseDeps),
      ).rejects.toThrow(IncidentActionAlreadyLinkedError);
    });

    it("an unrelated 23505 propagates unchanged", async () => {
      const err = { code: "23505", constraint: "other_unique" };
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(examWide) as never,
        insertInterruptionLink: vi.fn().mockRejectedValue(err) as never,
      });
      await expect(
        linkIncidentInterruption(repo, ctx(), examWide.id, input, baseDeps),
      ).rejects.toBe(err);
    });
  });
});
