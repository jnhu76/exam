/**
 * Repository contract tests for `attempt_command_receipts`
 * (J5-I1C Slice 1 / J5-I1C0 audit §9, §11.9, §11.10).
 *
 * Verifies against real PostgreSQL:
 *   - `findByOperationId` is the cross-command conflict arbiter lookup: it
 *     MUST return a row regardless of commandType (audit §11.9);
 *   - `insertReceipt` surfaces the real 23505 (does NOT swallow it) with the
 *     exact constraint name;
 *   - `listByAttempt` is org- and attempt-isolated, honors the command-type
 *     filter, and orders deterministically by (created_at, id) even when many
 *     rows share the same timestamp (audit §11.10);
 *   - operationId scope is PER ORGANIZATION.
 */

import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../schema/pg.js";
import { getIsolatedTestDb } from "../testDb.js";
import type { Database } from "../types.js";
import {
  createAttemptCommandReceiptRepo,
  type AttemptCommandReceiptRow,
  type InsertAttemptCommandReceiptInput,
} from "./attemptCommandReceiptRepo.js";

function context(organizationId: string, actorId: string): RequestContext {
  return {
    actorId,
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

interface Fixture {
  organizationId: string;
  actorId: string;
  examId: string;
  attemptId: string;
  secondAttemptId: string;
  ctx: RequestContext;
}

async function createFixture(db: Database, suffix: string): Promise<Fixture> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const organizationId = randomUUID();
  const courseId = randomUUID();
  const examId = randomUUID();
  const actorId = randomUUID();
  const candidateUserId = randomUUID();
  const candidateId = randomUUID();
  const enrollmentId = randomUUID();
  const attemptId = randomUUID();
  const secondAttemptId = randomUUID();

  await db.insert(schema.organizations).values({
    id: organizationId,
    name: `Org ${suffix}`,
    displayName: `Org ${suffix}`,
    slug: `org-${suffix}-${organizationId}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId,
    name: "Course",
    code: `C-${suffix}-${courseId}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.users).values([
    {
      id: actorId,
      organizationId,
      username: `actor-${suffix}-${actorId}`,
      passwordHash: "hash",
      name: "Actor",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: candidateUserId,
      organizationId,
      username: `candidate-${suffix}-${candidateUserId}`,
      passwordHash: "hash",
      name: "Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.candidateProfiles).values({
    id: candidateId,
    organizationId,
    userId: candidateUserId,
    fields: {},
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.exams).values({
    id: examId,
    organizationId,
    title: "Exam",
    description: "",
    courseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: now,
    closeAt: new Date("2026-01-02T00:00:00.000Z"),
    passingScore: 60,
    totalScore: 100,
    questionSelectionMode: "manual",
    questionIds: [],
    questionSnapshot: [],
    controlFlags: {
      shuffleQuestions: false,
      shuffleOptions: false,
      detectTabSwitch: false,
      disableCopyPaste: false,
      requireQueue: false,
      batchSize: 10,
      batchInterval: 3,
      restrictIp: false,
      requireLockdown: false,
      showResultImmediately: true,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 1,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.examEnrollments).values({
    id: enrollmentId,
    organizationId,
    examId,
    candidateId,
    status: "started",
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  });
  for (const [id, attemptNo] of [
    [attemptId, 1],
    [secondAttemptId, 2],
  ] as const) {
    await db.insert(schema.examAttempts).values({
      id,
      organizationId,
      examId,
      enrollmentId,
      candidateId,
      attemptNo,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      startedAt: now,
      deadlineAt: new Date("2026-01-01T01:00:00.000Z"),
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  return {
    organizationId,
    actorId,
    examId,
    attemptId,
    secondAttemptId,
    ctx: context(organizationId, actorId),
  };
}

/** Extract the PostgreSQL constraint name from a 23505 error chain. */
function constraintNameOf(err: unknown): string | null {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current === "object" && current !== null) {
      const e = current as Record<string, unknown>;
      if (e.code === "23505") {
        return String(e.constraint ?? e.constraint_name ?? "");
      }
      current = "cause" in e ? e.cause : null;
    } else {
      current = null;
    }
  }
  return null;
}

describe("attempt command receipt persistence foundation", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let alpha: Fixture;
  let beta: Fixture;
  let repo: ReturnType<typeof createAttemptCommandReceiptRepo>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb(
      "attempt-command-receipt-persistence",
    );
    db = result.db;
    cleanup = result.cleanup;
    alpha = await createFixture(db, "alpha");
    beta = await createFixture(db, "beta");
    repo = createAttemptCommandReceiptRepo(db);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  const BASE_TIME = new Date("2026-01-01T00:00:00.000Z");

  /** Insert a receipt via the repo with sensible defaults. */
  async function insert(
    fix: Fixture,
    over: Partial<{
      attemptId: string;
      operationId: string;
      commandType: "force_submit" | "misconduct_mark";
      requestPayload: Record<string, unknown>;
      resultPayload: Record<string, unknown>;
      outcome: "applied" | "no_change";
      createdAt: Date;
    }> = {},
  ): Promise<AttemptCommandReceiptRow> {
    const commandType = over.commandType ?? "force_submit";
    const defaultResultPayload =
      commandType === "force_submit"
        ? {
            commandType: "force_submit" as const,
            beforeStatus: "in_progress" as const,
            afterStatus: "graded" as const,
            submittedAt: BASE_TIME.toISOString(),
            gradedAt: BASE_TIME.toISOString(),
            appliedAt: BASE_TIME.toISOString(),
          }
        : {
            commandType: "misconduct_mark" as const,
            misconduct: null,
            appliedAt: BASE_TIME.toISOString(),
          };
    // The `over` overrides are deliberately loose (Record<string, unknown>)
    // so the runtime guard tests can bypass the compile-time binding. The
    // per-branch input union is satisfied via an `as unknown as` cast at the
    // test↔repo boundary — the runtime guard is what the bypass tests
    // exercise, the union is what the @ts-expect-error tests below pin.
    return repo.insertReceipt(fix.ctx, {
      attemptId: over.attemptId ?? fix.attemptId,
      operationId: over.operationId ?? randomUUID(),
      commandType,
      requestPayload: (over.requestPayload ?? {
        reason: "forced",
      }) as unknown as InsertAttemptCommandReceiptInput["requestPayload"],
      resultPayload: (over.resultPayload ??
        defaultResultPayload) as unknown as InsertAttemptCommandReceiptInput["resultPayload"],
      outcome: over.outcome ?? "applied",
      actorId: fix.actorId,
      createdAt: over.createdAt ?? BASE_TIME,
    } as unknown as InsertAttemptCommandReceiptInput);
  }

  // ── §11.9 findByOperationId is the cross-command arbiter ──────────

  it("findByOperationId returns a misconduct receipt for a force_submit caller", async () => {
    const opId = randomUUID();
    await insert(alpha, {
      operationId: opId,
      commandType: "misconduct_mark",
      requestPayload: { severity: "warning", notes: "x" },
    });
    const found = await repo.findByOperationId(alpha.ctx, opId);
    expect(found).not.toBeNull();
    expect(found?.commandType).toBe("misconduct_mark");
    expect(found?.attemptId).toBe(alpha.attemptId);
  });

  it("findByOperationId is org-scoped (cross-org operationId reuse is invisible)", async () => {
    const opId = randomUUID();
    await insert(alpha, { operationId: opId });
    const found = await repo.findByOperationId(beta.ctx, opId);
    expect(found).toBeNull();
  });

  // ── insertReceipt surfaces the real 23505 ─────────────────────────

  it("insertReceipt surfaces a 23505 with the exact constraint name on a duplicate", async () => {
    const opId = randomUUID();
    await insert(alpha, { operationId: opId });
    let caught: unknown;
    try {
      await insert(alpha, { operationId: opId });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(constraintNameOf(caught)).toBe(
      "attempt_command_receipts_org_operation_unique",
    );
  });

  it("insertReceipt cross-command same operationId surfaces the same constraint", async () => {
    const opId = randomUUID();
    await insert(alpha, {
      operationId: opId,
      commandType: "force_submit",
      requestPayload: { reason: "forced" },
    });
    let caught: unknown;
    try {
      await insert(alpha, {
        operationId: opId,
        commandType: "misconduct_mark",
        attemptId: alpha.secondAttemptId,
        requestPayload: { severity: "warning", notes: "y" },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(constraintNameOf(caught)).toBe(
      "attempt_command_receipts_org_operation_unique",
    );
  });

  // ── §11.10 listByAttempt: isolation, filter, deterministic order ──

  it("listByAttempt is org + attempt isolated", async () => {
    const opA = randomUUID();
    const opB = randomUUID();
    await insert(alpha, { operationId: opA });
    await insert(beta, { operationId: opB });
    const aRows = await repo.listByAttempt(alpha.ctx, alpha.attemptId);
    const bRows = await repo.listByAttempt(beta.ctx, beta.attemptId);
    expect(aRows.some((r) => r.operationId === opA)).toBe(true);
    expect(aRows.some((r) => r.operationId === opB)).toBe(false);
    expect(bRows.some((r) => r.operationId === opB)).toBe(true);
    expect(bRows.some((r) => r.operationId === opA)).toBe(false);
  });

  it("listByAttempt honors the optional commandType filter", async () => {
    const opFs = randomUUID();
    const opMs = randomUUID();
    await insert(alpha, {
      operationId: opFs,
      commandType: "force_submit",
      requestPayload: { reason: "forced" },
    });
    await insert(alpha, {
      operationId: opMs,
      commandType: "misconduct_mark",
      requestPayload: { severity: "warning", notes: "z" },
    });
    const onlyFs = await repo.listByAttempt(
      alpha.ctx,
      alpha.attemptId,
      "force_submit",
    );
    expect(onlyFs.every((r) => r.commandType === "force_submit")).toBe(true);
    expect(onlyFs.some((r) => r.operationId === opFs)).toBe(true);
    expect(onlyFs.some((r) => r.operationId === opMs)).toBe(false);
    const onlyMs = await repo.listByAttempt(
      alpha.ctx,
      alpha.attemptId,
      "misconduct_mark",
    );
    expect(onlyMs.every((r) => r.commandType === "misconduct_mark")).toBe(true);
  });

  it("listByAttempt orders by (created_at, id) even with identical timestamps", async () => {
    // Three receipts on the SAME attempt at the SAME created_at. Deterministic
    // order must come from the id tie-breaker. Use distinct operationIds and
    // capture the inserted ids to assert ascending id order.
    const sameTime = new Date("2026-02-02T00:00:00.000Z");
    const r1 = await insert(alpha, {
      attemptId: alpha.secondAttemptId,
      operationId: randomUUID(),
      createdAt: sameTime,
    });
    const r2 = await insert(alpha, {
      attemptId: alpha.secondAttemptId,
      operationId: randomUUID(),
      createdAt: sameTime,
    });
    const r3 = await insert(alpha, {
      attemptId: alpha.secondAttemptId,
      operationId: randomUUID(),
      createdAt: sameTime,
    });
    const rows = await repo.listByAttempt(alpha.ctx, alpha.secondAttemptId);
    const ids = rows.map((r) => r.id);
    // All three are present.
    expect(ids).toContain(r1.id);
    expect(ids).toContain(r2.id);
    expect(ids).toContain(r3.id);
    // Subsequence of these three ids is ascending (sorted by id as tie-breaker).
    const these = ids.filter((id) => [r1.id, r2.id, r3.id].includes(id));
    expect([...these].sort()).toEqual(these);
    // And the created_at values are equal across them (sanity).
    const sameTimeRows = rows.filter((r) =>
      [r1.id, r2.id, r3.id].includes(r.id),
    );
    expect(
      sameTimeRows.every((r) => r.createdAt.getTime() === sameTime.getTime()),
    ).toBe(true);
  });

  // ── runtime payload↔commandType guard ────────────────────────────
  //
  // The discriminated-union input binds payload↔command at compile time; the
  // tests below bypass the types via `as unknown as InsertAttemptCommandReceiptInput`
  // to prove the runtime guard still holds (defense against `as unknown as`,
  // JS callers, and rows read back from the database).

  it("insertReceipt rejects a request payload that does not match the commandType", async () => {
    // The input union binds payload to command at compile time; this test
    // bypasses the types to prove the runtime guard still holds.
    await expect(
      repo.insertReceipt(alpha.ctx, {
        attemptId: alpha.attemptId,
        operationId: randomUUID(),
        commandType: "force_submit",
        requestPayload: {
          severity: "warning",
          notes: "x",
        },
        resultPayload: {
          commandType: "force_submit",
          beforeStatus: "in_progress",
          afterStatus: "graded",
          submittedAt: BASE_TIME.toISOString(),
          gradedAt: BASE_TIME.toISOString(),
          appliedAt: BASE_TIME.toISOString(),
        },
        outcome: "applied",
        actorId: alpha.actorId,
        createdAt: BASE_TIME,
      } as unknown as InsertAttemptCommandReceiptInput),
    ).rejects.toThrow(/requestPayload shape belongs to misconduct_mark/);
  });

  it("insertReceipt rejects a result payload whose commandType differs", async () => {
    await expect(
      repo.insertReceipt(alpha.ctx, {
        attemptId: alpha.attemptId,
        operationId: randomUUID(),
        commandType: "force_submit",
        requestPayload: { reason: "forced" },
        resultPayload: {
          commandType: "misconduct_mark",
          misconduct: null,
          appliedAt: BASE_TIME.toISOString(),
        },
        outcome: "applied",
        actorId: alpha.actorId,
        createdAt: BASE_TIME,
      } as unknown as InsertAttemptCommandReceiptInput),
    ).rejects.toThrow(/resultPayload\.commandType misconduct_mark/);
  });

  // ── compile-time payload↔commandType binding (P2-1) ──────────────
  // The @ts-expect-error directives fail typecheck (TS2578 unused) if the
  // discriminated-union input ever regresses to a loose payload union. The
  // calls are guarded by `if (false)` so they are type-checked but NEVER
  // executed (a mismatched input must not silently reach the runtime guard).

  it("rejects a misconduct request payload for a force_submit receipt (compile-time)", () => {
    const misconductRequest = { severity: "warning" as const, notes: "x" };
    const forceSubmitResult = {
      commandType: "force_submit" as const,
      beforeStatus: "in_progress" as const,
      afterStatus: "graded" as const,
      submittedAt: BASE_TIME.toISOString(),
      gradedAt: BASE_TIME.toISOString(),
      appliedAt: BASE_TIME.toISOString(),
    };
    if (false) {
      // @ts-expect-error — force_submit requires a ForceSubmitRequestPayload
      // (reason) and a ForceSubmitResultPayload; a misconduct request is a
      // compile-time error, not a runtime guard.
      repo.insertReceipt(alpha.ctx, {
        attemptId: alpha.attemptId,
        operationId: randomUUID(),
        commandType: "force_submit",
        requestPayload: misconductRequest,
        resultPayload: forceSubmitResult,
        outcome: "applied",
        actorId: alpha.actorId,
        createdAt: BASE_TIME,
      });
    }
  });

  it("rejects a misconduct result payload for a force_submit receipt (compile-time)", () => {
    const forceSubmitRequest = { reason: "forced" };
    const misconductResult = {
      commandType: "misconduct_mark" as const,
      misconduct: null,
      appliedAt: BASE_TIME.toISOString(),
    };
    if (false) {
      // @ts-expect-error — force_submit requires a ForceSubmitResultPayload;
      // a misconduct result is a compile-time error.
      repo.insertReceipt(alpha.ctx, {
        attemptId: alpha.attemptId,
        operationId: randomUUID(),
        commandType: "force_submit",
        requestPayload: forceSubmitRequest,
        resultPayload: misconductResult,
        outcome: "applied",
        actorId: alpha.actorId,
        createdAt: BASE_TIME,
      });
    }
  });

  it("rejects a force_submit request payload for a misconduct receipt (compile-time)", () => {
    const forceSubmitRequest = { reason: "forced" };
    const misconductResult = {
      commandType: "misconduct_mark" as const,
      misconduct: null,
      appliedAt: BASE_TIME.toISOString(),
    };
    if (false) {
      // @ts-expect-error — misconduct_mark requires a MisconductMarkRequestPayload;
      // a force_submit request is a compile-time error.
      repo.insertReceipt(alpha.ctx, {
        attemptId: alpha.attemptId,
        operationId: randomUUID(),
        commandType: "misconduct_mark",
        requestPayload: forceSubmitRequest,
        resultPayload: misconductResult,
        outcome: "applied",
        actorId: alpha.actorId,
        createdAt: BASE_TIME,
      });
    }
  });
});
