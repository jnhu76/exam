import type { ExamIncident, RequestContext } from "@exam/domain";
import {
  IdempotencyConflictError,
  IncidentActionAlreadyLinkedError,
  IncidentVersionConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from "@exam/domain";

// ── Repository interface ──

export interface IncidentRepo {
  insert(
    ctx: RequestContext,
    input: {
      examId: string;
      attemptId: string | null;
      candidateId: string | null;
      type: string;
      severity: string;
      occurredAt: Date | null;
      description: string;
      reportedBy: string;
      createdAt: Date;
      updatedAt: Date;
    },
  ): Promise<ExamIncident>;
  findById(
    ctx: RequestContext,
    incidentId: string,
  ): Promise<ExamIncident | null>;
  findByIdForUpdate(
    ctx: RequestContext,
    incidentId: string,
  ): Promise<ExamIncident | null>;
  listByExam(
    ctx: RequestContext,
    examId: string,
    statusFilter?: string[],
  ): Promise<ExamIncident[]>;
  update(
    ctx: RequestContext,
    incidentId: string,
    input: Record<string, unknown>,
  ): Promise<ExamIncident | null>;
  appendEvent(
    ctx: RequestContext,
    input: {
      incidentId: string;
      eventType: string;
      commandType: string;
      operationId: string;
      actorId: string | null;
      beforeVersion: number;
      afterVersion: number;
      payload: Record<string, unknown>;
      createdAt: Date;
    },
  ): Promise<{ id: string } & Record<string, unknown>>;
  findEventByOperationId(
    ctx: RequestContext,
    operationId: string,
  ): Promise<{
    id: string;
    incidentId: string;
    eventType: string;
    commandType: string;
    operationId: string;
    beforeVersion: number;
    afterVersion: number;
    payload: Record<string, unknown>;
  } | null>;
  listEventsByIncident(
    ctx: RequestContext,
    incidentId: string,
  ): Promise<unknown[]>;
  insertActionLink(
    ctx: RequestContext,
    input: {
      incidentId: string;
      actionType: string;
      actionId: string;
      attemptId: string;
      actorId: string | null;
      operationId: string;
      linkedAt: Date;
    },
  ): Promise<unknown>;
  findActionLinkByOperationId(
    ctx: RequestContext,
    operationId: string,
  ): Promise<unknown | null>;
  findActionLinkByAction(
    ctx: RequestContext,
    actionType: string,
    actionId: string,
  ): Promise<unknown | null>;
  listActionsByIncident(
    ctx: RequestContext,
    incidentId: string,
  ): Promise<unknown[]>;
  insertAttemptMembership(
    ctx: RequestContext,
    input: {
      incidentId: string;
      attemptId: string;
      relationshipType: string;
      linkedBy: string;
      operationId: string;
      linkedAt: Date;
    },
  ): Promise<unknown>;
  findAttemptMembershipByOperationId(
    ctx: RequestContext,
    operationId: string,
  ): Promise<unknown | null>;
  listAttemptsByIncident(
    ctx: RequestContext,
    incidentId: string,
  ): Promise<unknown[]>;
  insertInterruptionLink(
    ctx: RequestContext,
    input: {
      incidentId: string;
      attemptId: string;
      interruptionId: string;
      linkedBy: string;
      operationId: string;
      linkedAt: Date;
    },
  ): Promise<unknown>;
  findInterruptionLinkByOperationId(
    ctx: RequestContext,
    operationId: string,
  ): Promise<unknown | null>;
  listInterruptionLinksByIncident(
    ctx: RequestContext,
    incidentId: string,
  ): Promise<unknown[]>;
}

// ── Constants ──

const TERMINAL_STATUSES = ["resolved", "dismissed"] as const;
const VALID_INCIDENT_TYPES = [
  "network_interruption",
  "device_failure",
  "power_failure",
  "candidate_unable_to_continue",
  "suspected_misconduct",
  "operator_error",
  "system_outage",
  "environmental_disruption",
  "other",
] as const;
const VALID_SEVERITIES = ["info", "minor", "major", "critical"] as const;
const VALID_ACTION_TYPES = ["time_grant", "force_submit"] as const;
const VALID_RELATIONSHIP_TYPES = ["affected", "referenced"] as const;

const COMMAND_CREATE = "createExamIncident";
const COMMAND_INVESTIGATE = "startIncidentInvestigation";
const COMMAND_NOTE = "addIncidentNote";
const COMMAND_SEVERITY = "changeIncidentSeverity";
const COMMAND_RESOLVE = "resolveExamIncident";
const COMMAND_DISMISS = "dismissExamIncident";
const COMMAND_LINK_ACTION = "linkIncidentAction";
const COMMAND_LINK_ATTEMPT = "linkIncidentAttempt";
const COMMAND_LINK_INTERRUPTION = "linkIncidentInterruption";

// ── Command input types ──

export interface CreateIncidentInput {
  operationId: string;
  examId: string;
  attemptId?: string | null;
  candidateId?: string | null;
  type: string;
  severity?: string;
  occurredAt?: string | null;
  description: string;
}

export interface StartInvestigationInput {
  operationId: string;
  expectedVersion: number;
  reasonCode?: string | null;
  reasonText?: string | null;
}

export interface AddNoteInput {
  operationId: string;
  body: string;
}

export interface ChangeSeverityInput {
  operationId: string;
  expectedVersion: number;
  severity: string;
  reasonCode?: string | null;
  reasonText?: string | null;
}

export interface ResolveIncidentInput {
  operationId: string;
  expectedVersion: number;
  resolutionSummary: string;
  reasonCode?: string | null;
}

export interface DismissIncidentInput {
  operationId: string;
  expectedVersion: number;
  reasonText: string;
  reasonCode?: string | null;
}

export interface LinkActionInput {
  operationId: string;
  actionType: string;
  actionId: string;
}

export interface LinkAttemptInput {
  operationId: string;
  attemptId: string;
  relationshipType: string;
}

export interface LinkInterruptionInput {
  operationId: string;
  interruptionId: string;
}

// ── Command outcome ──

export type IncidentOutcome = "applied" | "idempotent_replayed";

export interface IncidentCommandResult {
  outcome: IncidentOutcome;
  incident: ExamIncident;
}

// ── Audit callback ──

export interface IncidentAuditFn {
  (action: string, metadata: Record<string, unknown>): Promise<void>;
}

// ── Lookup dependency shapes (fail-closed: server-derived authority) ──

/** Authoritative exam existence + org scope. Required by create. */
export interface ExamLookup {
  (examId: string): Promise<{ organizationId: string; id: string } | null>;
}

/** Authoritative attempt row for anchor/scope derivation. */
export interface AttemptLookup {
  (attemptId: string): Promise<AttemptScopeRow | null>;
}

/** Authoritative enrollment existence (candidate enrolled in exam). */
export interface EnrollmentLookup {
  (examId: string, candidateId: string): Promise<boolean>;
}

// ── Canonical payload helpers ──

/**
 * Trims a string and returns null when empty after trim. Used for OPTIONAL
 * string fields where empty === absent. Required fields use
 * {@link normalizeRequiredString} which throws on empty.
 */
function normalizeString(s: string | undefined | null): string | null {
  if (s == null) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Trims a REQUIRED string and throws ValidationError when empty after trim.
 * Bounds apply after trim. Used for description / note body / resolution
 * summary / dismiss reasonText. The DB CHECK is the last line of defense;
 * this is the engine-level fail-closed guard.
 */
function normalizeRequiredString(
  s: string | undefined | null,
  field: string,
  max: number,
): string {
  const trimmed = (s ?? "").trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`${field} must not be empty`);
  }
  if (trimmed.length > max) {
    throw new ValidationError(`${field} must be at most ${max} chars`);
  }
  return trimmed;
}

function payloadsEqual(a: unknown, b: unknown): boolean {
  // PostgreSQL jsonb canonicalizes key order, so compare canonically.
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

/** Recursively sort object keys for order-insensitive JSON comparison. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// ── Pre-read operationId ──

async function preReadOperationId(
  repo: IncidentRepo,
  ctx: RequestContext,
  operationId: string,
  commandType: string,
  canonicalPayload: unknown,
): Promise<IncidentCommandResult | null> {
  const existingEvent = await repo.findEventByOperationId(ctx, operationId);
  if (!existingEvent) return null;

  if (
    existingEvent.commandType === commandType &&
    payloadsEqual(
      existingEvent.payload,
      canonicalPayload as Record<string, unknown>,
    )
  ) {
    const incident = await repo.findById(ctx, existingEvent.incidentId);
    if (!incident) throw new NotFoundError("Incident not found");
    return { outcome: "idempotent_replayed", incident };
  }

  throw new IdempotencyConflictError(
    `Operation ${operationId} already used for ${existingEvent.commandType}`,
  );
}

/** Check if a DB error is a named unique constraint violation. */
function isConstraintViolation(err: unknown, constraintName: string): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as {
      code?: string;
      constraint?: string;
      constraint_name?: string;
      cause?: { code?: string; constraint?: string; constraint_name?: string };
    };
    const constraint =
      e.constraint ??
      e.constraint_name ??
      e.cause?.constraint ??
      e.cause?.constraint_name;
    return e.code === "23505" && constraint === constraintName;
  }
  return false;
}

// ── Scope quadruple validation ──

export interface AttemptScopeRow {
  examId: string;
  candidateId: string | null;
  organizationId: string;
}

export async function validateScopeQuadruple(
  incident: {
    organizationId: string;
    examId: string;
    attemptId: string | null;
    candidateId: string | null;
  },
  targetAttempt: AttemptScopeRow,
  targetAttemptId: string,
  ctxOrgId: string,
): Promise<void> {
  // Same organization
  if (targetAttempt.organizationId !== ctxOrgId) {
    throw new ValidationError("Cross-organization attempt reference");
  }

  // Same exam
  if (targetAttempt.examId !== incident.examId) {
    throw new ValidationError("Target attempt belongs to a different exam");
  }

  // AttemptId null-or-matching
  if (incident.attemptId != null && incident.attemptId !== targetAttemptId) {
    throw new ValidationError("Target attempt does not match incident anchor");
  }

  // CandidateId null-or-matching
  if (
    incident.candidateId != null &&
    targetAttempt.candidateId !== incident.candidateId
  ) {
    throw new ValidationError(
      "Target attempt candidate does not match incident candidate",
    );
  }
}

// ── Append-only commands ──

/**
 * Create an exam incident. Append-only: no row lock, event-first insert.
 *
 * Frozen creation matrix (ADR-014 §7):
 *   attemptId=null, candidateId=null  → exam-wide, no candidate focus
 *   attemptId=null, candidateId=set   → candidate MUST be enrolled in exam
 *   attemptId=set,   candidateId=null → candidate DERIVED from attempt (same org+exam)
 *   attemptId=set,   candidateId=set  → supplied candidate MUST equal attempt.candidateId
 *
 * Exam existence is REQUIRED (404 if missing/cross-org). Attempt/candidate
 * authority is server-derived from authoritative rows, never trusted from
 * the request beyond identifiers.
 */
export async function createExamIncident(
  repo: IncidentRepo,
  ctx: RequestContext,
  input: CreateIncidentInput,
  deps: {
    now: Date;
    audit: IncidentAuditFn;
    lookupExam: ExamLookup;
    lookupAttempt?: AttemptLookup;
    lookupEnrollment?: EnrollmentLookup;
  },
): Promise<IncidentCommandResult> {
  const commandType = COMMAND_CREATE;

  // 1. Validate type up front (cheap, before any authority lookup).
  if (!(VALID_INCIDENT_TYPES as readonly string[]).includes(input.type)) {
    throw new ValidationError(`Invalid incident type: ${input.type}`);
  }
  if (input.severity != null) {
    if (!(VALID_SEVERITIES as readonly string[]).includes(input.severity)) {
      throw new ValidationError(`Invalid severity: ${input.severity}`);
    }
  }

  // 2. Normalize description (fail closed) and build canonical payload.
  const description = normalizeRequiredString(
    input.description,
    "description",
    1000,
  );
  const severity = input.severity ?? "info";
  const occurredAtRaw = input.occurredAt ?? null;
  const occurredAtCanonical = occurredAtRaw
    ? new Date(occurredAtRaw).toISOString()
    : null;

  const canonicalPayload = {
    examId: input.examId,
    attemptId: input.attemptId ?? null,
    candidateId: input.candidateId ?? null,
    type: input.type,
    severity,
    occurredAt: occurredAtCanonical,
    description,
  };

  // 3. Pre-read operationId (replay / idempotency conflict).
  const replay = await preReadOperationId(
    repo,
    ctx,
    input.operationId,
    commandType,
    canonicalPayload,
  );
  if (replay) return replay;

  // 4. Exam existence + org scope (REQUIRED — 404 if missing/cross-org).
  //    A plain exam_id REFERENCES exams(id) FK cannot prove the Incident's
  //    organization matches the Exam's organization; this lookup does.
  const exam = await deps.lookupExam(input.examId);
  if (!exam || exam.organizationId !== ctx.organizationId) {
    throw new NotFoundError("Exam not found");
  }

  // 5. Freeze Attempt/Candidate creation matrix (server-derived authority).
  let resolvedAttemptId = input.attemptId ?? null;
  let resolvedCandidateId = input.candidateId ?? null;

  if (resolvedAttemptId != null) {
    // Anchored incident: Attempt MUST exist in ctx org (404 if missing),
    // belong to the same exam (400 if wrong exam), and candidateId is
    // DERIVED from the authoritative attempt row.
    if (!deps.lookupAttempt) {
      throw new Error("lookupAttempt is required when attemptId is set");
    }
    const attempt = await deps.lookupAttempt(resolvedAttemptId);
    if (!attempt) {
      throw new NotFoundError("Attempt not found");
    }
    if (attempt.examId !== input.examId) {
      throw new ValidationError("Anchored attempt belongs to a different exam");
    }
    if (
      input.candidateId != null &&
      attempt.candidateId !== input.candidateId
    ) {
      throw new ValidationError("Candidate does not match attempt enrollment");
    }
    // Derive candidateId from the authoritative attempt row.
    resolvedCandidateId = attempt.candidateId;
  } else if (resolvedCandidateId != null) {
    // Exam-wide, candidate-specific: candidate MUST hold an enrollment in
    // this exam (400 VALIDATION_ERROR if not enrolled).
    if (!deps.lookupEnrollment) {
      throw new Error(
        "lookupEnrollment is required when candidateId is set without attemptId",
      );
    }
    const enrolled = await deps.lookupEnrollment(
      input.examId,
      resolvedCandidateId,
    );
    if (!enrolled) {
      throw new ValidationError("Candidate is not enrolled in this exam");
    }
  }
  // else: exam-wide, no candidate focus — no further candidate validation.

  const now = deps.now;

  try {
    // Insert incident
    const incident = await repo.insert(ctx, {
      examId: input.examId,
      attemptId: resolvedAttemptId,
      candidateId: resolvedCandidateId,
      type: input.type,
      severity,
      occurredAt: occurredAtCanonical ? new Date(occurredAtCanonical) : null,
      description,
      reportedBy: ctx.actorId,
      createdAt: now,
      updatedAt: now,
    });

    // Append event
    await repo.appendEvent(ctx, {
      incidentId: incident.id,
      eventType: "incident_created",
      commandType,
      operationId: input.operationId,
      actorId: ctx.actorId,
      beforeVersion: 0,
      afterVersion: 1,
      payload: canonicalPayload as Record<string, unknown>,
      createdAt: now,
    });

    // Atomic audit (identifiers + type + version only; no free-text body).
    await deps.audit("incident.created", {
      incidentId: incident.id,
      examId: input.examId,
      ...(resolvedAttemptId ? { attemptId: resolvedAttemptId } : {}),
      type: input.type,
      version: 1,
    });

    return { outcome: "applied", incident };
  } catch (err: unknown) {
    // operation-unique 23505 propagates unchanged: the recovery wrapper
    // re-runs the command in a fresh transaction (same pattern as the
    // operator time-grant race recovery), where the pre-read resolves the
    // winner.
    throw err;
  }
}

/**
 * Add an incident note. Append-only: no row lock, no version bump.
 * The audit metadata references the REAL event id (captured from
 * appendEvent), never the operationId.
 */
export async function addIncidentNote(
  repo: IncidentRepo,
  ctx: RequestContext,
  incidentId: string,
  input: AddNoteInput,
  deps: {
    now: Date;
    audit: IncidentAuditFn;
  },
): Promise<IncidentCommandResult> {
  const commandType = COMMAND_NOTE;
  const body = normalizeRequiredString(input.body, "body", 500);
  const canonicalPayload = { incidentId, body };

  const replay = await preReadOperationId(
    repo,
    ctx,
    input.operationId,
    commandType,
    canonicalPayload,
  );
  if (replay) return replay;

  const incident = await repo.findById(ctx, incidentId);
  if (!incident) throw new NotFoundError("Incident not found");

  const now = deps.now;

  try {
    // Capture the real event id for audit identity (never use operationId).
    const event = await repo.appendEvent(ctx, {
      incidentId,
      eventType: "note_added",
      commandType,
      operationId: input.operationId,
      actorId: ctx.actorId,
      beforeVersion: incident.version,
      afterVersion: incident.version,
      payload: canonicalPayload as Record<string, unknown>,
      createdAt: now,
    });

    await deps.audit("incident.note_added", {
      incidentId,
      noteId: event.id,
      version: incident.version,
    });

    return { outcome: "applied", incident };
  } catch (err: unknown) {
    // operation-unique 23505 propagates unchanged (recovery wrapper).
    throw err;
  }
}

/**
 * Link an operator action to an incident. Append-only: no row lock.
 * Rejects misconduct_mark. Validates scope quadruple + force_submit audit.
 */
export async function linkIncidentAction(
  repo: IncidentRepo,
  ctx: RequestContext,
  incidentId: string,
  input: LinkActionInput,
  deps: {
    now: Date;
    audit: IncidentAuditFn;
    lookupAdjustmentAttempt?: (adjustmentId: string) => Promise<string | null>;
    lookupForceSubmitAudit?: (attemptId: string) => Promise<boolean>;
    lookupAttempt?: (attemptId: string) => Promise<AttemptScopeRow | null>;
    lookupActionLink?: (
      actionType: string,
      actionId: string,
    ) => Promise<boolean>;
  },
): Promise<IncidentCommandResult> {
  const commandType = COMMAND_LINK_ACTION;
  const canonicalPayload = {
    incidentId,
    actionType: input.actionType,
    actionId: input.actionId,
  };

  // Reject misconduct_mark (deferred per ADR-014 §7).
  if (input.actionType === "misconduct_mark") {
    throw new ValidationError("misconduct_mark action links are deferred");
  }

  // Validate action type
  if (!(VALID_ACTION_TYPES as readonly string[]).includes(input.actionType)) {
    throw new ValidationError(`Invalid action type: ${input.actionType}`);
  }

  const replay = await preReadOperationId(
    repo,
    ctx,
    input.operationId,
    commandType,
    canonicalPayload,
  );
  if (replay) return replay;

  const incident = await repo.findById(ctx, incidentId);
  if (!incident) throw new NotFoundError("Incident not found");

  // Pre-check action link uniqueness (the DB unique is the final arbiter).
  if (deps.lookupActionLink) {
    const existing = await deps.lookupActionLink(
      input.actionType,
      input.actionId,
    );
    if (existing) {
      throw new IncidentActionAlreadyLinkedError(undefined, {
        linkType: `action:${input.actionType}:${input.actionId}`,
      });
    }
  }

  // Derive attemptId from the authoritative action referent.
  let attemptId: string;
  if (input.actionType === "time_grant") {
    if (!deps.lookupAdjustmentAttempt) {
      throw new Error("lookupAdjustmentAttempt required for time_grant links");
    }
    const adjAttemptId = await deps.lookupAdjustmentAttempt(input.actionId);
    if (!adjAttemptId) throw new NotFoundError("Time adjustment not found");
    attemptId = adjAttemptId;
  } else {
    attemptId = input.actionId; // force_submit: actionId = attemptId
  }

  // Validate scope quadruple (non-locking read of authoritative attempt).
  if (deps.lookupAttempt) {
    const attempt = await deps.lookupAttempt(attemptId);
    if (!attempt) throw new NotFoundError("Target attempt not found");
    await validateScopeQuadruple(
      incident,
      attempt,
      attemptId,
      ctx.organizationId,
    );
  }

  // For force_submit, verify the audit existence fact (ADR-014 §7).
  if (input.actionType === "force_submit") {
    if (!deps.lookupForceSubmitAudit) {
      throw new Error("lookupForceSubmitAudit required for force_submit links");
    }
    const exists = await deps.lookupForceSubmitAudit(attemptId);
    if (!exists) {
      throw new ValidationError("Attempt was not force-submitted");
    }
  }

  const now = deps.now;

  try {
    // Append event first (carries the operation unique constraint).
    await repo.appendEvent(ctx, {
      incidentId,
      eventType: "action_linked",
      commandType,
      operationId: input.operationId,
      actorId: ctx.actorId,
      beforeVersion: incident.version,
      afterVersion: incident.version,
      payload: canonicalPayload as Record<string, unknown>,
      createdAt: now,
    });

    // Insert action link
    await repo.insertActionLink(ctx, {
      incidentId,
      actionType: input.actionType,
      actionId: input.actionId,
      attemptId,
      actorId: ctx.actorId,
      operationId: input.operationId,
      linkedAt: now,
    });

    await deps.audit("incident.action_linked", {
      incidentId,
      actionType: input.actionType,
      actionId: input.actionId,
      attemptId,
      version: incident.version,
    });

    return { outcome: "applied", incident };
  } catch (err: unknown) {
    if (isConstraintViolation(err, "exam_incident_actions_org_action_unique")) {
      throw new IncidentActionAlreadyLinkedError(undefined, {
        linkType: `action:${input.actionType}:${input.actionId}`,
      });
    }
    // operation-unique 23505 propagates unchanged (recovery wrapper).
    throw err;
  }
}

/**
 * Link an attempt membership. Only for exam-wide incidents (attemptId IS NULL).
 */
export async function linkIncidentAttempt(
  repo: IncidentRepo,
  ctx: RequestContext,
  incidentId: string,
  input: LinkAttemptInput,
  deps: {
    now: Date;
    audit: IncidentAuditFn;
    lookupAttempt?: (attemptId: string) => Promise<AttemptScopeRow | null>;
  },
): Promise<IncidentCommandResult> {
  const commandType = COMMAND_LINK_ATTEMPT;
  const canonicalPayload = {
    incidentId,
    attemptId: input.attemptId,
    relationshipType: input.relationshipType,
  };

  const replay = await preReadOperationId(
    repo,
    ctx,
    input.operationId,
    commandType,
    canonicalPayload,
  );
  if (replay) return replay;

  const incident = await repo.findById(ctx, incidentId);
  if (!incident) throw new NotFoundError("Incident not found");

  // Anchor exclusivity
  if (incident.attemptId != null) {
    throw new InvalidStateTransitionError(
      "Cannot add attempt membership to an anchored incident",
    );
  }

  // Validate relationship type
  if (
    !(VALID_RELATIONSHIP_TYPES as readonly string[]).includes(
      input.relationshipType,
    )
  ) {
    throw new ValidationError(
      `Invalid relationship type: ${input.relationshipType}`,
    );
  }

  // Validate scope quadruple (non-locking read).
  if (deps.lookupAttempt) {
    const attempt = await deps.lookupAttempt(input.attemptId);
    if (!attempt) throw new NotFoundError("Target attempt not found");
    await validateScopeQuadruple(
      incident,
      attempt,
      input.attemptId,
      ctx.organizationId,
    );
  }

  const now = deps.now;

  try {
    await repo.appendEvent(ctx, {
      incidentId,
      eventType: "attempt_linked",
      commandType,
      operationId: input.operationId,
      actorId: ctx.actorId,
      beforeVersion: incident.version,
      afterVersion: incident.version,
      payload: canonicalPayload as Record<string, unknown>,
      createdAt: now,
    });

    await repo.insertAttemptMembership(ctx, {
      incidentId,
      attemptId: input.attemptId,
      relationshipType: input.relationshipType,
      linkedBy: ctx.actorId,
      operationId: input.operationId,
      linkedAt: now,
    });

    await deps.audit("incident.attempt_linked", {
      incidentId,
      attemptId: input.attemptId,
      relationshipType: input.relationshipType,
      version: incident.version,
    });

    return { outcome: "applied", incident };
  } catch (err: unknown) {
    if (
      isConstraintViolation(
        err,
        "exam_incident_attempts_incident_attempt_unique",
      )
    ) {
      throw new IncidentActionAlreadyLinkedError(undefined, {
        linkType: `attempt:${input.attemptId}`,
      });
    }
    // operation-unique 23505 propagates unchanged (recovery wrapper).
    throw err;
  }
}

/**
 * Link an interruption episode. Append-only: no row lock.
 */
export async function linkIncidentInterruption(
  repo: IncidentRepo,
  ctx: RequestContext,
  incidentId: string,
  input: LinkInterruptionInput,
  deps: {
    now: Date;
    audit: IncidentAuditFn;
    lookupInterruptionAttempt?: (
      interruptionId: string,
    ) => Promise<string | null>;
    lookupAttempt?: (attemptId: string) => Promise<AttemptScopeRow | null>;
  },
): Promise<IncidentCommandResult> {
  const commandType = COMMAND_LINK_INTERRUPTION;
  const canonicalPayload = {
    incidentId,
    interruptionId: input.interruptionId,
  };

  const replay = await preReadOperationId(
    repo,
    ctx,
    input.operationId,
    commandType,
    canonicalPayload,
  );
  if (replay) return replay;

  const incident = await repo.findById(ctx, incidentId);
  if (!incident) throw new NotFoundError("Incident not found");

  // Look up interruption episode to derive attemptId (404 if missing).
  let attemptId: string;
  if (deps.lookupInterruptionAttempt) {
    const epAttemptId = await deps.lookupInterruptionAttempt(
      input.interruptionId,
    );
    if (!epAttemptId) {
      throw new NotFoundError("Interruption episode not found");
    }
    attemptId = epAttemptId;
  } else {
    throw new Error("lookupInterruptionAttempt required");
  }

  // Validate scope quadruple (non-locking read).
  if (deps.lookupAttempt) {
    const attempt = await deps.lookupAttempt(attemptId);
    if (!attempt) throw new NotFoundError("Target attempt not found");
    await validateScopeQuadruple(
      incident,
      attempt,
      attemptId,
      ctx.organizationId,
    );
  }

  // Anchored incidents: require episode.attemptId == incident.attemptId.
  if (incident.attemptId != null && incident.attemptId !== attemptId) {
    throw new ValidationError(
      "Interruption episode does not belong to the incident's anchored attempt",
    );
  }

  const now = deps.now;

  try {
    await repo.appendEvent(ctx, {
      incidentId,
      eventType: "interruption_linked",
      commandType,
      operationId: input.operationId,
      actorId: ctx.actorId,
      beforeVersion: incident.version,
      afterVersion: incident.version,
      payload: canonicalPayload as Record<string, unknown>,
      createdAt: now,
    });

    await repo.insertInterruptionLink(ctx, {
      incidentId,
      attemptId,
      interruptionId: input.interruptionId,
      linkedBy: ctx.actorId,
      operationId: input.operationId,
      linkedAt: now,
    });

    await deps.audit("incident.interruption_linked", {
      incidentId,
      interruptionId: input.interruptionId,
      attemptId,
      version: incident.version,
    });

    return { outcome: "applied", incident };
  } catch (err: unknown) {
    if (
      isConstraintViolation(
        err,
        "exam_incident_interruption_links_incident_interruption_unique",
      )
    ) {
      throw new IncidentActionAlreadyLinkedError(undefined, {
        linkType: `interruption:${input.interruptionId}`,
      });
    }
    // operation-unique 23505 propagates unchanged (recovery wrapper).
    throw err;
  }
}

// ── Version-bumping commands ──

/**
 * Shared version-bumping command core. Locks the incident row FOR UPDATE,
 * re-checks operationId inside the lock, validates expectedVersion + status,
 * bumps version, appends a self-describing event, and records audit.
 *
 * The audit-metadata callback receives BOTH the before (locked) and after
 * (updated) incident rows so it can read authoritative before/after values
 * (e.g. severity before/after) — never re-derive "before" from the updated row.
 */
async function versionBumpCommand(
  repo: IncidentRepo,
  ctx: RequestContext,
  incidentId: string,
  input: { operationId: string; expectedVersion: number },
  commandType: string,
  bodyFields: Record<string, unknown>,
  deps: {
    now: Date;
    audit: IncidentAuditFn;
    allowedStatuses: readonly string[];
    eventType: string;
    auditAction: string;
    auditMetadata: (
      before: ExamIncident,
      after: ExamIncident,
      newVersion: number,
    ) => Record<string, unknown>;
    eventPayload: (
      before: ExamIncident,
      after: ExamIncident,
      newVersion: number,
    ) => Record<string, unknown>;
    updateFields: (
      incident: ExamIncident,
      newVersion: number,
      now: Date,
    ) => Record<string, unknown>;
  },
): Promise<IncidentCommandResult> {
  // Canonical payload includes incidentId + expectedVersion + body fields.
  const canonicalPayload = {
    incidentId,
    expectedVersion: input.expectedVersion,
    ...bodyFields,
  };

  const replay = await preReadOperationId(
    repo,
    ctx,
    input.operationId,
    commandType,
    canonicalPayload,
  );
  if (replay) return replay;

  const now = deps.now;

  // Lock incident row FOR UPDATE
  const locked = await repo.findByIdForUpdate(ctx, incidentId);
  if (!locked) throw new NotFoundError("Incident not found");

  // Inside lock, re-check operationId (T1 may have committed while T2 waited).
  const lockedEvent = await repo.findEventByOperationId(ctx, input.operationId);
  if (lockedEvent) {
    if (
      lockedEvent.commandType === commandType &&
      payloadsEqual(
        lockedEvent.payload,
        canonicalPayload as Record<string, unknown>,
      )
    ) {
      return { outcome: "idempotent_replayed", incident: locked };
    }
    throw new IdempotencyConflictError(
      `Operation ${input.operationId} already used for ${lockedEvent.commandType}`,
    );
  }

  // Check expectedVersion
  if (locked.version !== input.expectedVersion) {
    throw new IncidentVersionConflictError(undefined, {
      expectedVersion: input.expectedVersion,
      currentVersion: locked.version,
    });
  }

  // Check terminal status (any transition on a terminal incident is rejected).
  if ((TERMINAL_STATUSES as readonly string[]).includes(locked.status)) {
    throw new InvalidStateTransitionError(
      "Incident is already in a terminal state",
    );
  }

  // Check allowed source status
  if (!(deps.allowedStatuses as readonly string[]).includes(locked.status)) {
    throw new InvalidStateTransitionError(
      `Cannot transition incident from status: ${locked.status}`,
    );
  }

  const newVersion = locked.version + 1;
  const updates = deps.updateFields(locked, newVersion, now);
  const updated = await repo.update(ctx, incidentId, updates);
  if (!updated) throw new NotFoundError("Incident not found");

  // Append self-describing event (before/after where relevant).
  await repo.appendEvent(ctx, {
    incidentId,
    eventType: deps.eventType,
    commandType,
    operationId: input.operationId,
    actorId: ctx.actorId,
    beforeVersion: locked.version,
    afterVersion: newVersion,
    payload: {
      ...canonicalPayload,
      ...deps.eventPayload(locked, updated, newVersion),
    } as Record<string, unknown>,
    createdAt: now,
  });

  // Atomic audit (before/after + identifiers + reasonCode only; no free-text).
  await deps.audit(
    deps.auditAction,
    deps.auditMetadata(locked, updated, newVersion),
  );

  return { outcome: "applied", incident: updated };
}

export async function startIncidentInvestigation(
  repo: IncidentRepo,
  ctx: RequestContext,
  incidentId: string,
  input: StartInvestigationInput,
  deps: {
    now: Date;
    audit: IncidentAuditFn;
  },
): Promise<IncidentCommandResult> {
  return versionBumpCommand(
    repo,
    ctx,
    incidentId,
    input,
    COMMAND_INVESTIGATE,
    {
      reasonCode: normalizeString(input.reasonCode),
      reasonText: normalizeString(input.reasonText),
    },
    {
      ...deps,
      allowedStatuses: ["open"],
      eventType: "investigation_started",
      auditAction: "incident.investigated",
      auditMetadata: (_before, after, newVersion) => ({
        incidentId: after.id,
        version: newVersion,
        reasonCode: normalizeString(input.reasonCode),
      }),
      eventPayload: () => ({
        reasonCode: normalizeString(input.reasonCode),
        reasonText: normalizeString(input.reasonText),
      }),
      updateFields: (_incident, newVersion, now) => ({
        status: "investigating",
        version: newVersion,
        updatedAt: now,
      }),
    },
  );
}

export async function changeIncidentSeverity(
  repo: IncidentRepo,
  ctx: RequestContext,
  incidentId: string,
  input: ChangeSeverityInput,
  deps: {
    now: Date;
    audit: IncidentAuditFn;
  },
): Promise<IncidentCommandResult> {
  if (!(VALID_SEVERITIES as readonly string[]).includes(input.severity)) {
    throw new ValidationError(`Invalid severity: ${input.severity}`);
  }

  return versionBumpCommand(
    repo,
    ctx,
    incidentId,
    input,
    COMMAND_SEVERITY,
    {
      severity: input.severity,
      reasonCode: normalizeString(input.reasonCode),
      reasonText: normalizeString(input.reasonText),
    },
    {
      ...deps,
      allowedStatuses: ["open", "investigating"], // non-terminal
      eventType: "severity_changed",
      auditAction: "incident.severity_changed",
      // before/after severity from authoritative locked vs updated rows.
      auditMetadata: (before, after, newVersion) => ({
        incidentId: after.id,
        beforeSeverity: before.severity,
        afterSeverity: after.severity,
        version: newVersion,
        reasonCode: normalizeString(input.reasonCode),
      }),
      eventPayload: (before, after) => ({
        beforeSeverity: before.severity,
        afterSeverity: after.severity,
        reasonCode: normalizeString(input.reasonCode),
        reasonText: normalizeString(input.reasonText),
      }),
      updateFields: (_incident, newVersion, now) => ({
        severity: input.severity,
        version: newVersion,
        updatedAt: now,
      }),
    },
  );
}

export async function resolveExamIncident(
  repo: IncidentRepo,
  ctx: RequestContext,
  incidentId: string,
  input: ResolveIncidentInput,
  deps: {
    now: Date;
    audit: IncidentAuditFn;
  },
): Promise<IncidentCommandResult> {
  const resolutionSummary = normalizeRequiredString(
    input.resolutionSummary,
    "resolutionSummary",
    1000,
  );

  return versionBumpCommand(
    repo,
    ctx,
    incidentId,
    input,
    COMMAND_RESOLVE,
    {
      resolutionSummary,
      reasonCode: normalizeString(input.reasonCode),
    },
    {
      ...deps,
      allowedStatuses: ["open", "investigating"],
      eventType: "incident_resolved",
      auditAction: "incident.resolved",
      auditMetadata: (_before, after, newVersion) => ({
        incidentId: after.id,
        version: newVersion,
        reasonCode: normalizeString(input.reasonCode),
      }),
      eventPayload: () => ({
        resolutionSummary,
        reasonCode: normalizeString(input.reasonCode),
      }),
      updateFields: (_incident, newVersion, now) => ({
        status: "resolved",
        version: newVersion,
        resolutionSummary,
        resolvedBy: ctx.actorId,
        resolvedAt: now,
        updatedAt: now,
      }),
    },
  );
}

export async function dismissExamIncident(
  repo: IncidentRepo,
  ctx: RequestContext,
  incidentId: string,
  input: DismissIncidentInput,
  deps: {
    now: Date;
    audit: IncidentAuditFn;
  },
): Promise<IncidentCommandResult> {
  const reasonText = normalizeRequiredString(
    input.reasonText,
    "reasonText",
    1000,
  );

  return versionBumpCommand(
    repo,
    ctx,
    incidentId,
    input,
    COMMAND_DISMISS,
    {
      reasonText,
      reasonCode: normalizeString(input.reasonCode),
    },
    {
      ...deps,
      allowedStatuses: ["open", "investigating"],
      eventType: "incident_dismissed",
      auditAction: "incident.dismissed",
      auditMetadata: (_before, after, newVersion) => ({
        incidentId: after.id,
        version: newVersion,
        reasonCode: normalizeString(input.reasonCode),
      }),
      eventPayload: () => ({
        reasonText,
        reasonCode: normalizeString(input.reasonCode),
      }),
      updateFields: (_incident, newVersion, now) => ({
        status: "dismissed",
        version: newVersion,
        resolvedBy: ctx.actorId,
        resolvedAt: now,
        updatedAt: now,
      }),
    },
  );
}
