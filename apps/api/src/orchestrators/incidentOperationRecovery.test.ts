/**
 * withIncidentOperationRecovery — Case 1 (operation-unique 23505) final
 * fallback matrix (P1-C). Deterministic unit tests: the primary and the fresh
 * re-run both lose the operation-unique race; the wrapper's final read-only
 * committed-operation lookup must decide the outcome. The command is never
 * executed more than twice (no recursion, no infinite retry).
 *
 * The real-PostgreSQL proof of the recovery path lives in
 * incidents.admin.concurrency.test.ts (version-race) and
 * incidents.admin.test.ts (23505 single-race + duplicate-link 409).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { IdempotencyConflictError } from "@exam/domain";
import type { RequestContext } from "@exam/domain";
import type { IncidentCommandResult } from "@exam/exam-engine";
import { withIncidentOperationRecovery } from "./incidentOperationRecovery.js";

const mocks = vi.hoisted(() => ({
  executeInTransaction: vi.fn(),
  createIncidentRepo: vi.fn(),
}));

vi.mock("@exam/db/src/types.js", () => ({
  executeInTransaction: mocks.executeInTransaction,
}));

vi.mock("@exam/db/src/repository/incidentRepo.js", () => ({
  createIncidentRepo: mocks.createIncidentRepo,
}));

const INCIDENT_OPERATION_UNIQUE = "exam_incident_events_org_operation_unique";

function operationUniqueError(): { code: string; constraint: string } {
  return { code: "23505", constraint: INCIDENT_OPERATION_UNIQUE };
}

const COMMAND = "linkIncidentAction";
const CANONICAL_PAYLOAD = {
  incidentId: "incident-1",
  actionType: "time_grant",
  actionId: "adjustment-1",
};

function makeIncident(): IncidentCommandResult["incident"] {
  return {
    id: "incident-1",
    organizationId: "org-1",
    examId: "exam-1",
    attemptId: null,
    candidateId: null,
    type: "other",
    severity: "info",
    status: "open",
    occurredAt: null,
    description: "test",
    resolutionSummary: null,
    resolvedAt: null,
    resolvedBy: null,
    reportedBy: "admin-1",
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

const ctx: RequestContext = {
  actorId: "admin-1",
  organizationId: "org-1",
  role: "Admin",
  permissions: [],
  sessionId: randomUUID(),
};

/**
 * The mocked executeInTransaction simply runs its callback (the command or
 * resolveCommittedOperation's body) against the fake tx. The command itself
 * (`run`) is the source of the thrown errors — faithful to production, where
 * the 23505 surfaces from inside the transaction.
 */
mocks.executeInTransaction.mockImplementation(
  async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
);

describe("withIncidentOperationRecovery — Case 1 final fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createIncidentRepo.mockReset();
  });

  it("primary + fresh rerun both lose the race → final lookup replays the matching committed op", async () => {
    mocks.createIncidentRepo.mockReturnValue({
      findEventByOperationId: vi.fn().mockResolvedValue({
        id: randomUUID(),
        incidentId: "incident-1",
        eventType: "action_linked",
        commandType: COMMAND,
        operationId: "op-1",
        beforeVersion: 1,
        afterVersion: 1,
        payload: CANONICAL_PAYLOAD,
      }),
      findById: vi.fn().mockResolvedValue(makeIncident()),
    });

    const run = vi
      .fn()
      .mockRejectedValueOnce(operationUniqueError())
      .mockRejectedValueOnce(operationUniqueError());

    const result = await withIncidentOperationRecovery(
      {} as never,
      ctx,
      "op-1",
      COMMAND,
      CANONICAL_PAYLOAD,
      run,
    );

    expect(result.outcome).toBe("idempotent_replayed");
    expect(result.incident.id).toBe("incident-1");
    // The command itself was executed at most twice (primary + one rerun).
    expect(run).toHaveBeenCalledTimes(2);
    // The final lookup is the third transaction (resolveCommittedOperation).
    expect(mocks.executeInTransaction).toHaveBeenCalledTimes(3);
  });

  it("final lookup finds the op committed with a DIFFERENT payload → IDEMPOTENCY_CONFLICT", async () => {
    mocks.createIncidentRepo.mockReturnValue({
      findEventByOperationId: vi.fn().mockResolvedValue({
        id: randomUUID(),
        incidentId: "incident-1",
        eventType: "action_linked",
        commandType: COMMAND,
        operationId: "op-1",
        beforeVersion: 1,
        afterVersion: 1,
        payload: { ...CANONICAL_PAYLOAD, actionId: "adjustment-2" },
      }),
      findById: vi.fn().mockResolvedValue(makeIncident()),
    });

    const run = vi
      .fn()
      .mockRejectedValueOnce(operationUniqueError())
      .mockRejectedValueOnce(operationUniqueError());

    await expect(
      withIncidentOperationRecovery(
        {} as never,
        ctx,
        "op-1",
        COMMAND,
        CANONICAL_PAYLOAD,
        run,
      ),
    ).rejects.toThrow(IdempotencyConflictError);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("fresh rerun fails an UNRELATED error and the final lookup is absent → the unrelated error is preserved", async () => {
    const unrelated = {
      code: "23505",
      constraint: "users_org_username_unique",
    };
    // No committed operation: the final lookup returns absent.
    mocks.createIncidentRepo.mockReturnValue({
      findEventByOperationId: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
    });

    const run = vi
      .fn()
      .mockRejectedValueOnce(operationUniqueError())
      .mockRejectedValueOnce(unrelated);

    await expect(
      withIncidentOperationRecovery(
        {} as never,
        ctx,
        "op-1",
        COMMAND,
        CANONICAL_PAYLOAD,
        run,
      ),
    ).rejects.toBe(unrelated);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("primary non-23505 error propagates unchanged (no rerun, no lookup)", async () => {
    const other = new Error("boom");
    mocks.createIncidentRepo.mockReturnValue({
      findEventByOperationId: vi.fn(),
      findById: vi.fn(),
    });

    const run = vi.fn().mockRejectedValueOnce(other);

    await expect(
      withIncidentOperationRecovery(
        {} as never,
        ctx,
        "op-1",
        COMMAND,
        CANONICAL_PAYLOAD,
        run,
      ),
    ).rejects.toBe(other);
    expect(run).toHaveBeenCalledTimes(1);
    expect(mocks.executeInTransaction).toHaveBeenCalledTimes(1);
  });
});
