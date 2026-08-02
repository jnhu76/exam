import type {
  ExamProctorAssignment,
  ExamProctorAssignmentCommandOutcome,
  ExamProctorAssignmentCommandResult,
  ExamProctorAssignmentEvent,
  RequestContext,
} from "@exam/domain";
import {
  IdempotencyConflictError,
  NotFoundError,
  ValidationError,
} from "@exam/domain";
import { payloadsEqual } from "./incidentCommands.js";

// ── Repository interface ──

export interface ProctorAssignmentRepo {
  insertAssignment(
    ctx: RequestContext,
    input: {
      examId: string;
      proctorUserId: string;
      assignedBy: string;
      assignedAt: Date;
      createdAt: Date;
      updatedAt: Date;
    },
  ): Promise<ExamProctorAssignment>;
  findById(
    ctx: RequestContext,
    assignmentId: string,
  ): Promise<ExamProctorAssignment | null>;
  findActiveByExamAndProctor(
    ctx: RequestContext,
    examId: string,
    proctorUserId: string,
  ): Promise<ExamProctorAssignment | null>;
  /**
   * Most-recent episode of ANY status under the frozen order
   * `(created_at DESC, id DESC)` — the §7 loser-receipt fallback when no
   * active episode is visible in the recovery snapshot (ADR-015 §7
   * Amendment A1).
   */
  findMostRecentEpisodeByExamAndProctor(
    ctx: RequestContext,
    examId: string,
    proctorUserId: string,
  ): Promise<ExamProctorAssignment | null>;
  findMostRecentRevoked(
    ctx: RequestContext,
    examId: string,
    proctorUserId: string,
  ): Promise<ExamProctorAssignment | null>;
  resolveRevokeTarget(
    ctx: RequestContext,
    examId: string,
    proctorUserId: string,
    forUpdate: boolean,
  ): Promise<ExamProctorAssignment | null>;
  revokeAssignment(
    ctx: RequestContext,
    assignmentId: string,
    input: {
      revokedBy: string;
      revokedAt: Date;
      updatedAt: Date;
    },
  ): Promise<ExamProctorAssignment | null>;
  appendEvent(
    ctx: RequestContext,
    input: {
      assignmentId: string;
      commandType: "assign" | "revoke";
      operationId: string;
      canonicalPayload: Record<string, unknown>;
      outcome: "applied" | "no_change";
      actorId: string;
      createdAt: Date;
    },
  ): Promise<ExamProctorAssignmentEvent>;
  findEventByOperationId(
    ctx: RequestContext,
    operationId: string,
  ): Promise<{
    assignmentId: string;
    commandType: string;
    canonicalPayload: Record<string, unknown>;
  } | null>;
}

// ── Constants ──

const COMMAND_ASSIGN = "assign";
const COMMAND_REVOKE = "revoke";
const REASON_CODE_MAX_LENGTH = 100;

/**
 * The `(organization_id, exam_id, proctor_user_id) WHERE status='active'`
 * partial unique — the one-active-episode arbiter (ADR-015 §7).
 */
export const PROCTOR_ASSIGNMENT_ACTIVE_UNIQUE_CONSTRAINT =
  "exam_proctor_assignments_active_unique";

/**
 * The `(organization_id, operation_id)` unique on the events table — the
 * sole idempotency arbiter (ADR-015 §4.2 / §7).
 */
export const PROCTOR_ASSIGNMENT_EVENTS_OPERATION_UNIQUE_CONSTRAINT =
  "exam_proctor_assignment_events_org_operation_unique";

// ── Command input types ──

export interface AssignProctorToExamInput {
  operationId: string;
  examId: string;
  proctorUserId: string;
  reasonCode?: string | null;
}

export interface RevokeProctorFromExamInput {
  operationId: string;
  examId: string;
  proctorUserId: string;
  reasonCode?: string | null;
}

// ── Command outcome ──

export type {
  ExamProctorAssignmentCommandOutcome,
  ExamProctorAssignmentCommandResult,
};

// ── Audit callback ──

export interface ProctorAssignmentAuditFn {
  (action: string, metadata: Record<string, unknown>): Promise<void>;
}

// ── Lookup dependency shapes (fail-closed: server-derived authority) ──

/** Authoritative exam existence + org scope. Required by assign. */
export interface ExamLookup {
  (examId: string): Promise<{ organizationId: string; id: string } | null>;
}

/**
 * Authoritative target-user qualification (ADR-015 §12). `hasActiveProctorRole`
 * is the assignment-backed Proctor role check (a user_role_assignments row,
 * role='Proctor', is_active=true) — never `users.role`.
 */
export interface ProctorUserLookup {
  (userId: string): Promise<{
    organizationId: string;
    isActive: boolean;
    hasActiveProctorRole: boolean;
  } | null>;
}

// ── Canonical payload helpers ──

/**
 * Trims an optional reasonCode and null-normalizes empty values (ADR-015
 * §3.5): `reasonCode` is trimmed, empty → null, max length 100. It lives ONLY
 * inside the canonical payload — never a second column.
 */
export function normalizeReasonCode(
  reasonCode: string | null | undefined,
): string | null {
  if (reasonCode == null) return null;
  const trimmed = reasonCode.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > REASON_CODE_MAX_LENGTH) {
    throw new ValidationError(
      `reasonCode must be at most ${REASON_CODE_MAX_LENGTH} chars`,
    );
  }
  return trimmed;
}

/**
 * Canonical assign/revoke payload (ADR-015 §3.5). `operationId` is NOT part
 * of the payload — it is the unique key on the event row. Comparison is
 * `commandType + canonicalPayload` via {@link payloadsEqual}.
 */
export function canonicalAssignmentPayload(
  examId: string,
  proctorUserId: string,
  reasonCode: string | null,
): Record<string, unknown> {
  return { examId, proctorUserId, reasonCode };
}

// ── Pre-read operationId ──

async function preReadOperationId(
  repo: ProctorAssignmentRepo,
  ctx: RequestContext,
  operationId: string,
  commandType: string,
  canonicalPayload: Record<string, unknown>,
): Promise<ExamProctorAssignmentCommandResult | null> {
  const existing = await repo.findEventByOperationId(ctx, operationId);
  if (!existing) return null;

  if (
    existing.commandType === commandType &&
    payloadsEqual(existing.canonicalPayload, canonicalPayload)
  ) {
    // Replay returns the ORIGINAL episode the operation created/resolved —
    // the event row's assignment_id (never a later reassign episode).
    const assignment = await repo.findById(ctx, existing.assignmentId);
    if (!assignment) throw new NotFoundError("Assignment not found");
    return { outcome: "idempotent_replayed", assignment };
  }

  throw new IdempotencyConflictError(
    `Operation ${operationId} already used for ${existing.commandType}`,
  );
}

/**
 * Checks if a DB error is a named unique constraint violation. Walks the
 * error cause chain (postgres-js wraps the original error as `cause`) and
 * matches only when SQLSTATE is exactly 23505 AND the constraint name matches
 * — an unrelated unique violation or any non-23505 error propagates unchanged.
 */
export function isConstraintViolation(
  err: unknown,
  constraintName: string,
): boolean {
  let current: unknown = err;
  const visited = new Set<unknown>();

  while (current && !visited.has(current)) {
    visited.add(current);

    if (typeof current === "object" && current !== null) {
      const e = current as Record<string, unknown>;
      if (e.code === "23505") {
        const constraint = String(e.constraint ?? e.constraint_name ?? "");
        if (constraint === constraintName) return true;
      }

      current = "cause" in e ? e.cause : null;
    } else {
      current = null;
    }
  }
  return false;
}

// ── Commands ──

/**
 * Assign a Proctor to an Exam (ADR-015 §5 / §6). One transaction:
 * validate → INSERT active episode → read id → INSERT assign event
 * (outcome=applied) → audit `exam.proctor_assigned`. Idempotent by
 * `operationId`; an already-active (exam, proctor) under a NEW operationId
 * writes a `no_change` receipt referencing the current active episode with
 * NO episode mutation and NO compliance audit.
 *
 * The caller layer (route preHandler) authorizes the actor; the command never
 * trusts organization, actor, or role details from the request body.
 */
export async function assignProctorToExam(
  repo: ProctorAssignmentRepo,
  ctx: RequestContext,
  input: AssignProctorToExamInput,
  deps: {
    now: Date;
    audit: ProctorAssignmentAuditFn;
    lookupExam: ExamLookup;
    lookupProctorUser: ProctorUserLookup;
  },
): Promise<ExamProctorAssignmentCommandResult> {
  const commandType = COMMAND_ASSIGN;
  const reasonCode = normalizeReasonCode(input.reasonCode);
  const canonicalPayload = canonicalAssignmentPayload(
    input.examId,
    input.proctorUserId,
    reasonCode,
  );

  // Pre-read operationId (replay / idempotency conflict).
  const replay = await preReadOperationId(
    repo,
    ctx,
    input.operationId,
    commandType,
    canonicalPayload,
  );
  if (replay) return replay;

  // Exam existence + org scope (404 if missing/cross-org).
  const exam = await deps.lookupExam(input.examId);
  if (!exam || exam.organizationId !== ctx.organizationId) {
    throw new NotFoundError("Exam not found");
  }

  // Target-user qualification (ADR-015 §12). Missing/cross-org → 404;
  // inactive / lacking active Proctor role → 400.
  const proctor = await deps.lookupProctorUser(input.proctorUserId);
  if (!proctor || proctor.organizationId !== ctx.organizationId) {
    throw new NotFoundError("Proctor user not found");
  }
  if (!proctor.isActive) {
    throw new ValidationError("Target user is inactive");
  }
  if (!proctor.hasActiveProctorRole) {
    throw new ValidationError(
      "Target user does not have an active Proctor role",
    );
  }

  // Already active under a NEW operationId → no_change receipt referencing
  // the current active episode; no mutation, no audit (ADR-015 §6).
  const existing = await repo.findActiveByExamAndProctor(
    ctx,
    input.examId,
    input.proctorUserId,
  );
  if (existing) {
    await repo.appendEvent(ctx, {
      assignmentId: existing.id,
      commandType,
      operationId: input.operationId,
      canonicalPayload,
      outcome: "no_change",
      actorId: ctx.actorId,
      createdAt: deps.now,
    });
    return { outcome: "no_change", assignment: existing };
  }

  // New active episode + applied receipt + atomic compliance audit.
  // The active-unique 23505 propagates unchanged: the recovery orchestrator
  // rolls back and forms the loser's own no_change receipt in a fresh
  // transaction (ADR-015 §7).
  const assignment = await repo.insertAssignment(ctx, {
    examId: input.examId,
    proctorUserId: input.proctorUserId,
    assignedBy: ctx.actorId,
    assignedAt: deps.now,
    createdAt: deps.now,
    updatedAt: deps.now,
  });

  await repo.appendEvent(ctx, {
    assignmentId: assignment.id,
    commandType,
    operationId: input.operationId,
    canonicalPayload,
    outcome: "applied",
    actorId: ctx.actorId,
    createdAt: deps.now,
  });

  await deps.audit("exam.proctor_assigned", {
    organizationId: ctx.organizationId,
    examId: input.examId,
    proctorUserId: input.proctorUserId,
    assignmentId: assignment.id,
    actorId: ctx.actorId,
    operationId: input.operationId,
    assignedAt: deps.now.toISOString(),
    reasonCode,
  });

  return { outcome: "applied", assignment };
}

/**
 * Revoke a Proctor from an Exam (ADR-015 §5 / §6). Canonical identity is
 * `{ operationId, examId, proctorUserId }` — assignmentId is never an
 * alternative command identity. One transaction: resolve and lock the active
 * episode if one exists, otherwise the most-recent revoked episode
 * (revoked_at DESC, id DESC); active → set revoked + applied receipt + audit
 * `exam.proctor_revoked`; already revoked → no_change receipt referencing
 * that episode; no episode of any kind → 404.
 */
export async function revokeProctorFromExam(
  repo: ProctorAssignmentRepo,
  ctx: RequestContext,
  input: RevokeProctorFromExamInput,
  deps: {
    now: Date;
    audit: ProctorAssignmentAuditFn;
  },
): Promise<ExamProctorAssignmentCommandResult> {
  const commandType = COMMAND_REVOKE;
  const reasonCode = normalizeReasonCode(input.reasonCode);
  const canonicalPayload = canonicalAssignmentPayload(
    input.examId,
    input.proctorUserId,
    reasonCode,
  );

  // Pre-read operationId (replay / idempotency conflict).
  const replay = await preReadOperationId(
    repo,
    ctx,
    input.operationId,
    commandType,
    canonicalPayload,
  );
  if (replay) return replay;

  // Resolve + lock the target episode (active if present, else most-recent
  // revoked by the frozen tie-break). Missing episode of any kind → 404.
  const target = await repo.resolveRevokeTarget(
    ctx,
    input.examId,
    input.proctorUserId,
    true,
  );
  if (!target) {
    throw new NotFoundError("Proctor assignment not found");
  }

  if (target.status === "active") {
    // Applied revocation: mutation + applied receipt + atomic audit.
    const updated = await repo.revokeAssignment(ctx, target.id, {
      revokedBy: ctx.actorId,
      revokedAt: deps.now,
      updatedAt: deps.now,
    });
    const revoked = updated ?? target;

    await repo.appendEvent(ctx, {
      assignmentId: revoked.id,
      commandType,
      operationId: input.operationId,
      canonicalPayload,
      outcome: "applied",
      actorId: ctx.actorId,
      createdAt: deps.now,
    });

    await deps.audit("exam.proctor_revoked", {
      organizationId: ctx.organizationId,
      examId: input.examId,
      proctorUserId: input.proctorUserId,
      assignmentId: revoked.id,
      actorId: ctx.actorId,
      operationId: input.operationId,
      revokedAt: deps.now.toISOString(),
      reasonCode,
    });

    return { outcome: "applied", assignment: revoked };
  }

  // Already revoked under a NEW operationId → no_change receipt referencing
  // the most-recent revoked episode; no mutation, no audit (ADR-015 §6).
  await repo.appendEvent(ctx, {
    assignmentId: target.id,
    commandType,
    operationId: input.operationId,
    canonicalPayload,
    outcome: "no_change",
    actorId: ctx.actorId,
    createdAt: deps.now,
  });
  return { outcome: "no_change", assignment: target };
}
