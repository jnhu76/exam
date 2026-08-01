import { randomUUID } from "node:crypto";
import type { ExamProctorAssignment, RequestContext } from "@exam/domain";
import {
  IdempotencyConflictError,
  NotFoundError,
  ValidationError,
} from "@exam/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignProctorToExam,
  revokeProctorFromExam,
  type ProctorAssignmentRepo,
} from "./proctorAssignmentCommands.js";

function ctx(organizationId = "org-1", actorId = "actor-1"): RequestContext {
  return {
    actorId,
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

function makeAssignment(
  overrides: Partial<ExamProctorAssignment> = {},
): ExamProctorAssignment {
  return {
    id: randomUUID(),
    organizationId: "org-1",
    examId: "exam-1",
    proctorUserId: "proctor-1",
    status: "active",
    assignedBy: "actor-1",
    assignedAt: new Date("2026-01-01T00:00:00.000Z"),
    revokedBy: null,
    revokedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<ProctorAssignmentRepo> = {}): {
  repo: ProctorAssignmentRepo;
  calls: { inserted: unknown[]; events: unknown[]; audits: unknown[] };
} {
  const calls: { inserted: unknown[]; events: unknown[]; audits: unknown[] } = {
    inserted: [],
    events: [],
    audits: [],
  };
  const repo: ProctorAssignmentRepo = {
    insertAssignment: vi.fn(async (_ctx, input) => {
      calls.inserted.push(input);
      return makeAssignment({
        id: randomUUID(),
        examId: input.examId,
        proctorUserId: input.proctorUserId,
        assignedBy: input.assignedBy,
        assignedAt: input.assignedAt,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      });
    }),
    findById: vi.fn(async () => null),
    findActiveByExamAndProctor: vi.fn(async () => null),
    findMostRecentRevoked: vi.fn(async () => null),
    resolveRevokeTarget: vi.fn(async () => null),
    revokeAssignment: vi.fn(async (_ctx, _id, input) =>
      makeAssignment({ status: "revoked", ...input }),
    ),
    appendEvent: vi.fn(async (_ctx, input) => {
      calls.events.push(input);
      return { id: randomUUID(), ...input } as never;
    }),
    findEventByOperationId: vi.fn(async () => null),
    ...overrides,
  };
  return { repo, calls };
}

const NOW = new Date("2026-02-01T00:00:00.000Z");
const noopAudit = vi.fn(async () => {});

beforeEach(() => {
  noopAudit.mockClear();
});

function lookupExamInOrg(examId = "exam-1", organizationId = "org-1") {
  return vi.fn(async (id: string) =>
    id === examId ? { organizationId, id: examId } : null,
  );
}

function lookupProctorUser(
  proctorUserId = "proctor-1",
  options: { isActive?: boolean; hasActiveProctorRole?: boolean } = {},
) {
  const { isActive = true, hasActiveProctorRole = true } = options;
  return vi.fn(async (id: string) =>
    id === proctorUserId
      ? { organizationId: "org-1", isActive, hasActiveProctorRole }
      : null,
  );
}

function assignmentDeps(overrides: Record<string, unknown> = {}) {
  return {
    now: NOW,
    audit: noopAudit,
    lookupExam: lookupExamInOrg(),
    lookupProctorUser: lookupProctorUser(),
    ...overrides,
  };
}

describe("assignProctorToExam — applied path", () => {
  it("new assignment: inserts an active episode, writes an applied event, audits once", async () => {
    const { repo, calls } = makeRepo();
    const result = await assignProctorToExam(
      repo,
      ctx(),
      {
        operationId: "11111111-1111-4111-8111-111111111111",
        examId: "exam-1",
        proctorUserId: "proctor-1",
      },
      assignmentDeps(),
    );

    expect(result.outcome).toBe("applied");
    expect(result.assignment.status).toBe("active");
    expect(calls.inserted).toHaveLength(1);
    expect(calls.events).toHaveLength(1);
    expect(calls.events[0]).toMatchObject({
      commandType: "assign",
      outcome: "applied",
      operationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(noopAudit).toHaveBeenCalledTimes(1);
    expect(noopAudit).toHaveBeenCalledWith(
      "exam.proctor_assigned",
      expect.objectContaining({
        examId: "exam-1",
        proctorUserId: "proctor-1",
        assignmentId: result.assignment.id,
        operationId: "11111111-1111-4111-8111-111111111111",
      }),
    );
  });

  it("reasonCode is trimmed and null-normalized inside the canonical payload only", async () => {
    const { repo, calls } = makeRepo();
    const result = await assignProctorToExam(
      repo,
      ctx(),
      {
        operationId: "11111111-1111-4111-8111-111111111111",
        examId: "exam-1",
        proctorUserId: "proctor-1",
        reasonCode: "  prep  ",
      },
      assignmentDeps(),
    );
    expect(result.outcome).toBe("applied");
    expect(
      (calls.events[0] as { canonicalPayload: unknown }).canonicalPayload,
    ).toEqual({
      examId: "exam-1",
      proctorUserId: "proctor-1",
      reasonCode: "prep",
    });
    expect(noopAudit).toHaveBeenCalledWith(
      "exam.proctor_assigned",
      expect.objectContaining({ reasonCode: "prep" }),
    );
  });

  it("empty reasonCode normalizes to null", async () => {
    const { repo, calls } = makeRepo();
    await assignProctorToExam(
      repo,
      ctx(),
      {
        operationId: "11111111-1111-4111-8111-111111111111",
        examId: "exam-1",
        proctorUserId: "proctor-1",
        reasonCode: "   ",
      },
      assignmentDeps(),
    );
    expect(
      (calls.events[0] as { canonicalPayload: { reasonCode: unknown } })
        .canonicalPayload.reasonCode,
    ).toBeNull();
  });

  it("reasonCode over 100 chars is rejected (400 VALIDATION_ERROR)", async () => {
    const { repo } = makeRepo();
    await expect(
      assignProctorToExam(
        repo,
        ctx(),
        {
          operationId: "11111111-1111-4111-8111-111111111111",
          examId: "exam-1",
          proctorUserId: "proctor-1",
          reasonCode: "x".repeat(101),
        },
        assignmentDeps(),
      ),
    ).rejects.toThrow(ValidationError);
    expect(noopAudit).not.toHaveBeenCalled();
  });
});

describe("assignProctorToExam — validation (ADR-015 §12)", () => {
  it("missing exam → 404", async () => {
    const { repo } = makeRepo();
    await expect(
      assignProctorToExam(
        repo,
        ctx(),
        {
          operationId: "11111111-1111-4111-8111-111111111111",
          examId: "missing-exam",
          proctorUserId: "proctor-1",
        },
        assignmentDeps(),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("cross-organization exam → 404 (fail closed, no existence leak)", async () => {
    const { repo } = makeRepo();
    await expect(
      assignProctorToExam(
        repo,
        ctx(),
        {
          operationId: "11111111-1111-4111-8111-111111111111",
          examId: "exam-1",
          proctorUserId: "proctor-1",
        },
        assignmentDeps({ lookupExam: lookupExamInOrg("exam-1", "other-org") }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("missing proctor user → 404", async () => {
    const { repo } = makeRepo();
    await expect(
      assignProctorToExam(
        repo,
        ctx(),
        {
          operationId: "11111111-1111-4111-8111-111111111111",
          examId: "exam-1",
          proctorUserId: "missing-user",
        },
        assignmentDeps(),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("cross-organization proctor user → 404", async () => {
    const { repo } = makeRepo();
    const lookup = vi.fn(async () => ({
      organizationId: "other-org",
      isActive: true,
      hasActiveProctorRole: true,
    }));
    await expect(
      assignProctorToExam(
        repo,
        ctx(),
        {
          operationId: "11111111-1111-4111-8111-111111111111",
          examId: "exam-1",
          proctorUserId: "proctor-1",
        },
        assignmentDeps({ lookupProctorUser: lookup }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("inactive target user → 400 VALIDATION_ERROR", async () => {
    const { repo } = makeRepo();
    await expect(
      assignProctorToExam(
        repo,
        ctx(),
        {
          operationId: "11111111-1111-4111-8111-111111111111",
          examId: "exam-1",
          proctorUserId: "proctor-1",
        },
        assignmentDeps({
          lookupProctorUser: lookupProctorUser("proctor-1", {
            isActive: false,
          }),
        }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("target without an active Proctor role → 400 VALIDATION_ERROR", async () => {
    const { repo } = makeRepo();
    await expect(
      assignProctorToExam(
        repo,
        ctx(),
        {
          operationId: "11111111-1111-4111-8111-111111111111",
          examId: "exam-1",
          proctorUserId: "proctor-1",
        },
        assignmentDeps({
          lookupProctorUser: lookupProctorUser("proctor-1", {
            hasActiveProctorRole: false,
          }),
        }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("validation failure writes nothing and audits nothing", async () => {
    const { repo, calls } = makeRepo();
    await expect(
      assignProctorToExam(
        repo,
        ctx(),
        {
          operationId: "11111111-1111-4111-8111-111111111111",
          examId: "exam-1",
          proctorUserId: "proctor-1",
        },
        assignmentDeps({
          lookupProctorUser: lookupProctorUser("proctor-1", {
            isActive: false,
          }),
        }),
      ),
    ).rejects.toThrow(ValidationError);
    expect(calls.inserted).toHaveLength(0);
    expect(calls.events).toHaveLength(0);
    expect(noopAudit).not.toHaveBeenCalled();
  });
});

describe("assignProctorToExam — idempotency (ADR-015 §6)", () => {
  it("duplicate assign with a NEW operationId and already-active → no_change receipt, no mutation, no audit", async () => {
    const active = makeAssignment({ id: "episode-active" });
    const { repo, calls } = makeRepo({
      findActiveByExamAndProctor: vi.fn(async () => active),
    });
    const result = await assignProctorToExam(
      repo,
      ctx(),
      {
        operationId: "22222222-2222-4222-8222-222222222222",
        examId: "exam-1",
        proctorUserId: "proctor-1",
      },
      assignmentDeps(),
    );

    expect(result.outcome).toBe("no_change");
    expect(result.assignment.id).toBe("episode-active");
    expect(calls.inserted).toHaveLength(0);
    expect(calls.events).toHaveLength(1);
    expect(calls.events[0]).toMatchObject({
      commandType: "assign",
      outcome: "no_change",
      assignmentId: "episode-active",
    });
    expect(noopAudit).not.toHaveBeenCalled();
  });

  it("exact replay: same operationId + same payload → idempotent_replayed, returns the ORIGINAL episode, no write", async () => {
    const original = makeAssignment({ id: "episode-original" });
    const { repo, calls } = makeRepo({
      findEventByOperationId: vi.fn(async () => ({
        assignmentId: "episode-original",
        commandType: "assign",
        canonicalPayload: {
          examId: "exam-1",
          proctorUserId: "proctor-1",
          reasonCode: null,
        },
      })),
      findById: vi.fn(async () => original),
    });
    const result = await assignProctorToExam(
      repo,
      ctx(),
      {
        operationId: "11111111-1111-4111-8111-111111111111",
        examId: "exam-1",
        proctorUserId: "proctor-1",
      },
      assignmentDeps(),
    );

    expect(result.outcome).toBe("idempotent_replayed");
    expect(result.assignment.id).toBe("episode-original");
    expect(calls.inserted).toHaveLength(0);
    expect(calls.events).toHaveLength(0);
    expect(noopAudit).not.toHaveBeenCalled();
  });

  it("same operationId with a DIFFERENT canonical payload → 409 IDEMPOTENCY_CONFLICT", async () => {
    const { repo, calls } = makeRepo({
      findEventByOperationId: vi.fn(async () => ({
        assignmentId: "episode-original",
        commandType: "assign",
        canonicalPayload: {
          examId: "exam-1",
          proctorUserId: "proctor-1",
          reasonCode: "original-reason",
        },
      })),
    });
    await expect(
      assignProctorToExam(
        repo,
        ctx(),
        {
          operationId: "11111111-1111-4111-8111-111111111111",
          examId: "exam-1",
          proctorUserId: "proctor-1",
          reasonCode: "different-reason",
        },
        assignmentDeps(),
      ),
    ).rejects.toThrow(IdempotencyConflictError);
    expect(calls.inserted).toHaveLength(0);
    expect(calls.events).toHaveLength(0);
    expect(noopAudit).not.toHaveBeenCalled();
  });

  it("same operationId reused across command types (assign then revoke) → 409 IDEMPOTENCY_CONFLICT", async () => {
    const { repo } = makeRepo({
      findEventByOperationId: vi.fn(async () => ({
        assignmentId: "episode-original",
        commandType: "revoke",
        canonicalPayload: {
          examId: "exam-1",
          proctorUserId: "proctor-1",
          reasonCode: null,
        },
      })),
    });
    await expect(
      assignProctorToExam(
        repo,
        ctx(),
        {
          operationId: "11111111-1111-4111-8111-111111111111",
          examId: "exam-1",
          proctorUserId: "proctor-1",
        },
        assignmentDeps(),
      ),
    ).rejects.toThrow(IdempotencyConflictError);
  });
});

describe("revokeProctorFromExam — applied path", () => {
  it("active episode: sets revoked, writes an applied event, audits once", async () => {
    const active = makeAssignment({ id: "episode-active" });
    const { repo, calls } = makeRepo({
      resolveRevokeTarget: vi.fn(async () => active),
      revokeAssignment: vi.fn(async (_ctx, _id, input) =>
        makeAssignment({
          id: "episode-active",
          status: "revoked",
          revokedBy: input.revokedBy,
          revokedAt: input.revokedAt,
          updatedAt: input.updatedAt,
        }),
      ),
    });
    const result = await revokeProctorFromExam(
      repo,
      ctx(),
      {
        operationId: "33333333-3333-4333-8333-333333333333",
        examId: "exam-1",
        proctorUserId: "proctor-1",
      },
      { now: NOW, audit: noopAudit },
    );

    expect(result.outcome).toBe("applied");
    expect(result.assignment.status).toBe("revoked");
    expect(result.assignment.revokedBy).toBe("actor-1");
    expect(result.assignment.revokedAt).toEqual(NOW);
    expect(calls.events).toHaveLength(1);
    expect(calls.events[0]).toMatchObject({
      commandType: "revoke",
      outcome: "applied",
      assignmentId: "episode-active",
    });
    expect(noopAudit).toHaveBeenCalledTimes(1);
    expect(noopAudit).toHaveBeenCalledWith(
      "exam.proctor_revoked",
      expect.objectContaining({
        examId: "exam-1",
        proctorUserId: "proctor-1",
        assignmentId: "episode-active",
      }),
    );
  });

  it("already revoked under a NEW operationId → no_change receipt referencing the most-recent revoked episode, no mutation, no audit", async () => {
    const revoked = makeAssignment({
      id: "episode-revoked",
      status: "revoked",
      revokedBy: "actor-0",
      revokedAt: new Date("2026-01-15T00:00:00.000Z"),
    });
    const { repo, calls } = makeRepo({
      resolveRevokeTarget: vi.fn(async () => revoked),
    });
    const result = await revokeProctorFromExam(
      repo,
      ctx(),
      {
        operationId: "44444444-4444-4444-8444-444444444444",
        examId: "exam-1",
        proctorUserId: "proctor-1",
      },
      { now: NOW, audit: noopAudit },
    );

    expect(result.outcome).toBe("no_change");
    expect(result.assignment.id).toBe("episode-revoked");
    expect(calls.events).toHaveLength(1);
    expect(calls.events[0]).toMatchObject({
      commandType: "revoke",
      outcome: "no_change",
      assignmentId: "episode-revoked",
    });
    expect(noopAudit).not.toHaveBeenCalled();
  });

  it("no episode of any kind → 404 RESOURCE_NOT_FOUND", async () => {
    const { repo, calls } = makeRepo();
    await expect(
      revokeProctorFromExam(
        repo,
        ctx(),
        {
          operationId: "55555555-5555-4555-8555-555555555555",
          examId: "exam-1",
          proctorUserId: "proctor-1",
        },
        { now: NOW, audit: noopAudit },
      ),
    ).rejects.toThrow(NotFoundError);
    expect(calls.events).toHaveLength(0);
    expect(noopAudit).not.toHaveBeenCalled();
  });

  it("revoke replay returns the ORIGINAL episode referenced by the event, no write", async () => {
    const original = makeAssignment({
      id: "episode-original",
      status: "revoked",
      revokedBy: "actor-1",
      revokedAt: new Date("2026-01-10T00:00:00.000Z"),
    });
    const { repo, calls } = makeRepo({
      findEventByOperationId: vi.fn(async () => ({
        assignmentId: "episode-original",
        commandType: "revoke",
        canonicalPayload: {
          examId: "exam-1",
          proctorUserId: "proctor-1",
          reasonCode: null,
        },
      })),
      findById: vi.fn(async () => original),
    });
    const result = await revokeProctorFromExam(
      repo,
      ctx(),
      {
        operationId: "33333333-3333-4333-8333-333333333333",
        examId: "exam-1",
        proctorUserId: "proctor-1",
      },
      { now: NOW, audit: noopAudit },
    );

    expect(result.outcome).toBe("idempotent_replayed");
    expect(result.assignment.id).toBe("episode-original");
    expect(calls.events).toHaveLength(0);
    expect(noopAudit).not.toHaveBeenCalled();
  });
});

describe("episode history semantics (ADR-015 §4.3 / §6)", () => {
  it("old assign replay returns the OLD episode, never a later reassign episode", async () => {
    const oldEpisode = makeAssignment({ id: "episode-old" });
    const { repo, calls } = makeRepo({
      findEventByOperationId: vi.fn(async () => ({
        assignmentId: "episode-old",
        commandType: "assign",
        canonicalPayload: {
          examId: "exam-1",
          proctorUserId: "proctor-1",
          reasonCode: null,
        },
      })),
      findById: vi.fn(async () => oldEpisode),
      // A later reassign created a NEW active episode — the replay must NOT
      // return it.
      findActiveByExamAndProctor: vi.fn(async () =>
        makeAssignment({ id: "episode-new" }),
      ),
    });
    const result = await assignProctorToExam(
      repo,
      ctx(),
      {
        operationId: "11111111-1111-4111-8111-111111111111",
        examId: "exam-1",
        proctorUserId: "proctor-1",
      },
      assignmentDeps(),
    );
    expect(result.outcome).toBe("idempotent_replayed");
    expect(result.assignment.id).toBe("episode-old");
    expect(calls.inserted).toHaveLength(0);
  });
});
