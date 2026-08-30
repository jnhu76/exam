import { z } from "zod";
import type { AttemptCommandType as DomainAttemptCommandType } from "@exam/domain";
import { AvailabilityStatusEnum, PrimaryActionEnum } from "./candidate.js";
import { GradingStatusEnum as GradingStatusFromScore } from "./score.js";
import { InterruptionTimePolicySchema } from "./interruption.js";
import { AnswerModeEnum, ContentDocumentV1Schema } from "./contentDocument.js";

// ── Attempt ───────────────────────────────────────────────────────

const MisconductSeverityEnum = z.enum(["warning", "serious"]);

/**
 * Schema for a misconduct flag recorded on an attempt (P2C-J4).
 */
export const MisconductFlagSchema = z.object({
  flaggedAt: z.string().datetime(),
  flaggedBy: z.string(),
  notes: z.string().min(1).max(1000),
  severity: MisconductSeverityEnum,
});
/** DTO for a misconduct flag. */
export type MisconductFlagDTO = z.infer<typeof MisconductFlagSchema>;

export const AttemptStatusEnum = z.enum([
  "not_started",
  "queued",
  "in_progress",
  "disrupted",
  "submitted",
  "grading",
  "graded",
  "voided",
]);
export type AttemptStatusValue = z.infer<typeof AttemptStatusEnum>;

/**
 * Zod enum of reasons a save-answer request may be rejected by the server.
 * INVALID_ANSWER (#301) is additive: the payload shape failed validation
 * against the frozen question's answer grammar (e.g. a rich text_response
 * answer that is not a valid ContentDocumentV1).
 */
export const SaveAnswerRejectReasonEnum = z.enum([
  "STALE_VERSION",
  "FUTURE_VERSION",
  "ATTEMPT_ALREADY_SUBMITTED",
  "ATTEMPT_CLOSED",
  "DEADLINE_EXCEEDED",
  "CONFLICTING_PAYLOAD",
  "INVALID_ANSWER",
] as const);

/** Discriminated reason why the server rejected a save-answer request. */
export type SaveAnswerRejectReason = z.infer<typeof SaveAnswerRejectReasonEnum>;

/**
 * Schema for a frozen snapshot of a question copied into an attempt at creation time.
 * Edits to the original question do not affect existing snapshots.
 *
 * Rich fields (#301): `contentDocument` freezes the authoritative rich prompt
 * and `options[].contentDocument` freezes rich option content; `answerMode`
 * freezes the author-defined answer input mode for text_response. Historical
 * JSONB rows predating these fields omit them — the transforms normalize
 * missing to null so legacy snapshots parse as Plain without migration
 * (same schema-evolution precedent as `rubric`).
 */
export const QuestionSnapshotSchema = z.object({
  originalQuestionId: z.string(),
  type: z.enum([
    "single_choice",
    "multiple_choice",
    "fill_blank",
    "true_false",
    "text_response",
  ]),
  content: z.string(),
  contentDocument: ContentDocumentV1Schema.nullish().transform(
    (v) => v ?? null,
  ),
  answerMode: AnswerModeEnum.nullish().transform((v) => v ?? null),
  attachments: z.array(
    z.object({
      url: z.string(),
      type: z.enum(["image", "file"]),
      name: z.string(),
    }),
  ),
  options: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
      contentDocument: ContentDocumentV1Schema.nullish().transform(
        (v) => v ?? null,
      ),
    }),
  ),
  standardAnswer: z.unknown(),
  score: z.number(),
  gradingRule: z.object({
    multiSelectScoring: z.enum(["all_correct_full", "partial_half"]),
    fillBlankMatchMode: z.enum(["exact", "keyword"]),
    fillBlankCaseSensitive: z.boolean().optional(),
  }),
  order: z.number().int(),
  // P3-L0-1: frozen grading source (dual-layer). Historical JSONB rows
  // predating this field omit the key; the transform normalizes missing
  // values to null so legacy snapshots parse without migration.
  rubric: z
    .string()
    .nullable()
    .nullish()
    .transform((v) => (v === undefined ? null : v)),
});

/**
 * Candidate-safe question snapshot that omits standardAnswer and rubric.
 * Used when returning attempt data to candidates. Per L0 §6.1, candidates
 * must never receive rubric or standardAnswer.
 */
export const CandidateQuestionSnapshotSchema = QuestionSnapshotSchema.omit({
  standardAnswer: true,
  rubric: true,
});

const AnswerRecordSchema = z.object({
  questionId: z.string(),
  answer: z.unknown(),
  version: z.number().int(),
  savedAt: z.string().datetime(),
});

/**
 * Schema for an exam attempt record, including status, question snapshots, answers, scores, and timing.
 */
export const AttemptSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  examId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  candidateId: z.string().uuid(),
  attemptNo: z.number().int(),
  status: AttemptStatusEnum,
  questionSnapshot: z.array(QuestionSnapshotSchema),
  answers: z.array(AnswerRecordSchema),
  score: z.number().optional(),
  passed: z.boolean().optional(),
  startedAt: z.string().datetime().optional(),
  submittedAt: z.string().datetime().optional(),
  deadlineAt: z.string().datetime().optional(),
  lastActivityAt: z.string().datetime().optional(),
  misconduct: MisconductFlagSchema.nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Represents a single exam attempt including all question snapshots, answers, and scoring data. */
export type AttemptDTO = z.infer<typeof AttemptSchema>;

/**
 * Response schema for loading an attempt, with question snapshots stripped of standardAnswer
 * to prevent candidates from seeing correct answers.
 */
export const LoadAttemptResponseSchema = AttemptSchema.extend({
  questionSnapshot: z.array(CandidateQuestionSnapshotSchema),
  serverNow: z.string().datetime(),
});

/** Type for the load-attempt response with candidate-safe question snapshots. */
export type LoadAttemptResponse = z.infer<typeof LoadAttemptResponseSchema>;

// ── Save Answer (§3.5) ───────────────────────────────────────────

/**
 * Request schema for saving an answer with versioned conflict detection.
 * Uses baseVersion for optimistic concurrency control.
 */
export const SaveAnswerRequestSchema = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
  answer: z.unknown(),
  clientSeq: z.number().int().min(0),
  clientSavedAt: z.string().datetime(),
  baseVersion: z.number().int().min(0),
});

/** Type for a save-answer request with client-side version metadata. */
export type SaveAnswerRequestDTO = z.infer<typeof SaveAnswerRequestSchema>;

/**
 * Response when the server accepts a save-answer request.
 */
export const SaveAnswerAcceptedSchema = z
  .object({
    accepted: z.literal(true),
    serverVersion: z.number().int(),
    savedAt: z.string().datetime(),
  })
  .strict();

/**
 * Response when the server rejects a save-answer request due to a version conflict or attempt state issue.
 */
export const SaveAnswerRejectedSchema = z
  .object({
    accepted: z.literal(false),
    reason: SaveAnswerRejectReasonEnum,
    message: z.string(),
    serverVersion: z.number().int(),
    savedAt: z.string().datetime(),
    details: z
      .object({
        serverAnswer: z.unknown().optional(),
      })
      .optional(),
  })
  .strict();

/**
 * Discriminated union of accepted and rejected save-answer responses,
 * keyed on the `accepted` field.
 */
export const SaveAnswerResponseSchema = z.discriminatedUnion("accepted", [
  SaveAnswerAcceptedSchema,
  SaveAnswerRejectedSchema,
]);

/** Type for a save-answer response (accepted or rejected). */
export type SaveAnswerResponseDTO = z.infer<typeof SaveAnswerResponseSchema>;

// ── Route Params ─────────────────────────────────────────────────

/**
 * Route params schema for endpoints that operate on a specific attempt by UUID.
 */
export const AttemptIdParamsSchema = z.object({
  attemptId: z.string().uuid(),
});

/**
 * Route params schema for the load-attempt endpoint, identified by attempt `id`.
 */
export const LoadAttemptParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Route params schema for save-answer endpoints, requiring both attemptId and questionId.
 */
export const SaveAnswerParamsSchema = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
});

// ── Start Attempt ─────────────────────────────────────────────────

/**
 * Request schema for starting a new exam attempt. Requires the exam UUID.
 */
export const StartAttemptRequestSchema = z.object({
  examId: z.string().uuid(),
});

/** Type for a start-attempt request. */
export type StartAttemptRequest = z.infer<typeof StartAttemptRequestSchema>;

// ── Heartbeat ─────────────────────────────────────────────────────

/**
 * Request schema for sending a periodic heartbeat to indicate the candidate is still active.
 */
export const HeartbeatRequestSchema = z.object({
  attemptId: z.string().uuid(),
});

/** Type for a heartbeat request. */
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

// ── Submit ────────────────────────────────────────────────────────

/**
 * Request schema for submitting an attempt for grading.
 */
export const SubmitAttemptRequestSchema = z.object({
  attemptId: z.string().uuid(),
});

/** Type for a submit-attempt request. */
export type SubmitAttemptRequest = z.infer<typeof SubmitAttemptRequestSchema>;

// ── Restore ───────────────────────────────────────────────────────

/**
 * Request schema for restoring a disrupted attempt, recovering saved answers and remaining time from the server.
 */
export const RestoreAttemptRequestSchema = z.object({
  attemptId: z.string().uuid(),
});

/** Type for a restore-attempt request. */
export type RestoreAttemptRequest = z.infer<typeof RestoreAttemptRequestSchema>;

/**
 * Lifecycle outcome of a candidate restore request, as observed by the
 * candidate. Mirrors the engine's `RestoreLifecycleOutcome` (ADR-013 §6,
 * REC-I4-I3A).
 *
 * The `terminal` outcome is a legitimate result: the attempt was already
 * terminal on entry, or deadline reconciliation submitted it during the
 * restore transaction. The response contract returns 200 (not 400/409) for
 * this outcome — the terminalization is the authoritative result.
 */
export const RestoreLifecycleOutcomeEnum = z.enum([
  "restored",
  "already_in_progress",
  "terminal",
]);
/** Candidate-visible lifecycle outcome of a restore. */
export type RestoreLifecycleOutcomeDTO = z.infer<
  typeof RestoreLifecycleOutcomeEnum
>;

/**
 * Candidate-safe compensation summary for the restore response.
 * Enforces the ADR-013 invariant that `strict` and `operator_incident`
 * candidate restore must grant zero seconds.
 */
const RestoreCompensationSchema = z
  .object({
    policy: InterruptionTimePolicySchema,
    addedSeconds: z.number().int().min(0),
  })
  .superRefine((value, ctx) => {
    if (value.policy !== "bounded_grace" && value.addedSeconds !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["addedSeconds"],
        message: "strict and operator_incident restore must grant zero seconds",
      });
    }
  });

/**
 * Frozen HTTP response contract for
 * `POST /attempts/:attemptId/restore` (ADR-013 §6, REC-I4-I3A).
 *
 * This is a **command acknowledgement**, not the canonical take-page state.
 * The candidate client re-reads the authoritative `CandidateTakeSnapshot` via
 * GET after this returns (ADR-012 / REC-I3). The response exposes only the
 * candidate-safe compensation summary:
 *
 *   - `lifecycle` — what happened to the attempt lifecycle;
 *   - `compensation.policy` — which interruption time-policy governed the
 *     decision (`strict` | `bounded_grace` | `operator_incident`);
 *   - `compensation.addedSeconds` — whole seconds granted to the deadline
 *     (always `0` for `strict` and `operator_incident` candidate restore);
 *   - `attempt` — the candidate-safe attempt projection (same shape as the
 *     load-attempt response, standardAnswer/rubric stripped).
 *
 * It deliberately does NOT expose:
 *   - the internal interruption episode id / detected-event evidence;
 *   - the adjustment ledger row id, `eligibleSeconds`, before/after deadline,
 *     or `reasonCode`;
 *   - any operator/system-incident attribution.
 *
 * Those internal details remain absent from the candidate restore response.
 *
 * The separate Admin operator time-grant route and
 * `Permission.AttemptTimeGrant` are implemented under REC-I4-I3B2.
 * Operator-grant details remain available only through the authorized Admin
 * surface and committed adjustment ledger.
 *
 * Incident attribution and incident-linked operator actions remain deferred to
 * REC-I6.
 *
 * The `terminal` lifecycle outcome is a legitimate 200 response: the attempt
 * was already terminal on entry, or deadline reconciliation submitted it
 * during the restore transaction. The engine returns `lifecycle: "terminal"`
 * as a normal result (not a thrown error), so the route must not reject it.
 */
export const RestoreAttemptResponseSchema = z.object({
  lifecycle: RestoreLifecycleOutcomeEnum,
  compensation: RestoreCompensationSchema,
  attempt: LoadAttemptResponseSchema,
});

/** Type for the frozen restore-attempt response. */
export type RestoreAttemptResponse = z.infer<
  typeof RestoreAttemptResponseSchema
>;

// ── Flag Misconduct (Admin) ──────────────────────────────────────

/**
 * Request body schema for an admin flagging misconduct on an attempt.
 */
export const FlagMisconductRequestSchema = z.object({
  severity: MisconductSeverityEnum,
  notes: z.string().min(1).max(1000),
});

/** Type for a flag-misconduct request body. */
export type FlagMisconductRequest = z.infer<typeof FlagMisconductRequestSchema>;

/** Response schema for a flag-misconduct action. */
export const FlagMisconductResponseSchema = z.object({
  ok: z.literal(true),
});

/** Type for a flag-misconduct response. */
export type FlagMisconductResponse = z.infer<
  typeof FlagMisconductResponseSchema
>;

// ── Proctor Incident (P3-M9) ────────────────────────────────────

/**
 * Allowed incident types for proctor incident logging v0.
 * Each value maps to a specific proctor observation category.
 */
export const ProctorIncidentTypeEnum = z.enum([
  "suspicious_behavior_marked",
  "network_issue_marked",
  "identity_check_failed",
  "manual_note_added",
]);
/** Type for proctor incident type enum. */
export type ProctorIncidentType = z.infer<typeof ProctorIncidentTypeEnum>;

/**
 * Request body schema for a proctor marking an incident on an attempt.
 * Audit-event-only storage — no dedicated incident table. Resource IDs are
 * optional compatibility hints; the server derives canonical IDs from the
 * path attempt and rejects contradictory hints. `note` is length-limited,
 * may contain PII, and callers must not include candidate answers.
 */
export const MarkProctorIncidentRequestSchema = z.object({
  incidentType: ProctorIncidentTypeEnum,
  examId: z.string().uuid().optional(),
  candidateId: z.string().uuid().optional(),
  attemptId: z.string().uuid().optional(),
  reasonCode: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});
/** Type for a proctor incident request body. */
export type MarkProctorIncidentRequest = z.infer<
  typeof MarkProctorIncidentRequestSchema
>;

/** Response schema for a proctor incident action. */
export const MarkProctorIncidentResponseSchema = z.object({
  ok: z.literal(true),
});
/** Type for a proctor incident response. */
export type MarkProctorIncidentResponse = z.infer<
  typeof MarkProctorIncidentResponseSchema
>;

// ── Force Submit (Admin) ──────────────────────────────────────────
//
// The legacy `ForceSubmitRequestSchema` (optional `reason`, no operationId)
// was REMOVED in J5-I1C Slice 2: the operation-aware
// {@link ForceSubmitWithOperationRequestSchema} below is the only accepted
// force-submit wire shape (J5-R0 §8.1/§8.2 — required canonical reason +
// client-generated operationId). The receipt payload schemas below carry the
// canonical request identity.

// ── Attempt Command Receipts (J5-I1C Slice 1) ─────────────────────
//
// Durable, operationId-keyed command-receipt contracts for the two dangerous
// Attempt commands (`force_submit`, `misconduct_mark`). Slice 2 has wired
// the force-submit route to these shapes; the legacy
// `FlagMisconductRequestSchema` above remains for the not-yet-activated
// misconduct route (Slice 3).
//
// See docs/audits/J5-I1C0-DANGEROUS-COMMAND-IDENTITY-REALITY-AUDIT.md §4/§6.

/**
 * The two dangerous Attempt commands sharing one receipt table.
 * The DB CHECK constraint `attempt_command_receipts_command_type_check`
 * enforces this exact set. The canonical value union lives in `@exam/domain`
 * (`AttemptCommandType`); this Zod schema is the wire validator that mirrors
 * it (single source of truth = the domain union).
 */
export const AttemptCommandTypeSchema = z.enum([
  "force_submit",
  "misconduct_mark",
]);
/**
 * The canonical Attempt command type (re-exported from `@exam/domain`, the
 * single source of truth). This is the value union; the Zod schema above is
 * the wire validator that mirrors it.
 */
export type AttemptCommandType = DomainAttemptCommandType;

/**
 * The persistent receipt outcome written to the `attempt_command_receipts`
 * table. The DB CHECK constraint `attempt_command_receipts_outcome_check`
 * enforces this exact set. The HTTP layer may surface a third wire disposition
 * `idempotent_replay` (see {@link AttemptCommandDispositionSchema}), but that
 * value is NEVER written to the table and NEVER mutates an existing receipt
 * (audit §3.3): a replay returns the original stored receipt verbatim.
 */
export const AttemptCommandOutcomeSchema = z.enum(["applied", "no_change"]);
/** Type for a persistent attempt command receipt outcome. */
export type AttemptCommandOutcome = z.infer<typeof AttemptCommandOutcomeSchema>;

/**
 * The wire-level disposition an attempt command may return. Adds
 * `idempotent_replay` to the persistent outcomes: a replay does not write a new
 * row, it returns the stored {@link AttemptCommandReceiptResultPayloadSchema}
 * of the original receipt.
 */
export const AttemptCommandDispositionSchema = z.enum([
  "applied",
  "no_change",
  "idempotent_replay",
]);
/** Type for an attempt command wire disposition. */
export type AttemptCommandDisposition = z.infer<
  typeof AttemptCommandDispositionSchema
>;

/**
 * Canonical request payload for a `force_submit` receipt (audit §4.1/§4.2).
 * `reason` is REQUIRED and non-empty after trim (J5-R0 §8.1 upgraded it to
 * server-required): the durable identity never contains null/blank — a
 * `{ reason: null }` and a missing reason would otherwise collide into one
 * canonical identity and silently merge two different operations.
 * `.strict()` rejects unknown fields so two requests cannot canonicalize to
 * the same receipt while one carried an extra field.
 */
export const ForceSubmitRequestPayloadSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
/** Canonical force_submit request payload stored in a receipt. */
export type ForceSubmitRequestPayload = z.infer<
  typeof ForceSubmitRequestPayloadSchema
>;

/**
 * Canonical request payload for a `misconduct_mark` receipt (audit §4.3/§4.4).
 * `severity` reuses the existing {@link MisconductSeverityEnum}; `notes` is
 * trimmed to a non-empty bounded string (the legacy
 * {@link FlagMisconductRequestSchema} already enforces 1..1000). `.strict()`
 * rejects unknown fields for the same canonical-identity reason as
 * {@link ForceSubmitRequestPayloadSchema}.
 *
 * `notes` is `.trim()`-ed at this canonical layer so the durable payload
 * agrees with {@link MisconductMarkWithOperationRequestSchema} and the
 * domain canonicalizer (review J5-I1C0 PR #261 P1-2): without the trim, a
 * `notes: "  x  "` payload would persist with surrounding whitespace while
 * the wire request / domain canonicalizer would store `"x"` — three
 * representations of the same operation identity. The trim here makes the
 * canonical receipt the single source of truth.
 */
export const MisconductMarkRequestPayloadSchema = z
  .object({
    severity: MisconductSeverityEnum,
    notes: z.string().trim().min(1).max(1000),
  })
  .strict();
/** Canonical misconduct_mark request payload stored in a receipt. */
export type MisconductMarkRequestPayload = z.infer<
  typeof MisconductMarkRequestPayloadSchema
>;

/**
 * operationId-carrying force-submit request (audit §4.1, J5-R0 §8.1/§8.2).
 * The ONLY accepted wire shape for `POST /admin/attempts/:attemptId/force-submit`
 * since J5-I1C Slice 2 (the legacy optional-reason shape was removed).
 * `reason` is required, trimmed, 1..500. `.strict()` rejects unknown fields
 * (the wire request is the operation identity input).
 */
export const ForceSubmitWithOperationRequestSchema = z
  .object({
    operationId: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
/** Type for an operationId-carrying force-submit request body. */
export type ForceSubmitWithOperationRequest = z.infer<
  typeof ForceSubmitWithOperationRequestSchema
>;

/**
 * operationId-carrying misconduct-mark request (audit §4.3). Future shape for
 * `POST /admin/attempts/:attemptId/misconduct`; does NOT replace the legacy
 * {@link FlagMisconductRequestSchema} in this slice. Reuses the existing
 * `severity` + `notes` field constraints. `.strict()` rejects unknown fields.
 */
export const MisconductMarkWithOperationRequestSchema = z
  .object({
    operationId: z.string().uuid(),
    severity: MisconductSeverityEnum,
    notes: z.string().trim().min(1).max(1000),
  })
  .strict();
/** Type for an operationId-carrying misconduct-mark request body. */
export type MisconductMarkWithOperationRequest = z.infer<
  typeof MisconductMarkWithOperationRequestSchema
>;

/**
 * The immutable committed fact stored in a receipt's `result_payload` jsonb and
 * returned verbatim on replay (audit §4.2/§4.4). A discriminated union on
 * `commandType` freezes the FULL per-command result shapes (overnight
 * hardening: the previous envelope-only union carried no committed fact, so a
 * replay could not tell the client what the original command actually did).
 * Note: the `commandType` discriminator is duplicated inside the jsonb payload
 * so the stored fact is self-describing and the union is discriminable; the
 * audit §4.2/§4.4 field sets are preserved verbatim.
 */
export const AttemptCommandReceiptResultPayloadSchema = z.discriminatedUnion(
  "commandType",
  [
    z
      .object({
        commandType: z.literal("force_submit"),
        // The immutable committed fact for force_submit (audit §4.2): the
        // statuses observed under the EA lock and the attempt timestamps at
        // commit — NOT re-derived from the live attempt on replay.
        beforeStatus: AttemptStatusEnum,
        afterStatus: AttemptStatusEnum,
        submittedAt: z.string().datetime().nullable(),
        gradedAt: z.string().datetime().nullable(),
        appliedAt: z.string().datetime(),
      })
      .strict(),
    z
      .object({
        commandType: z.literal("misconduct_mark"),
        // The immutable committed fact for misconduct_mark (audit §4.4): the
        // MisconductFlag this receipt establishes (null on no_change).
        misconduct: MisconductFlagSchema.nullable(),
        appliedAt: z.string().datetime(),
      })
      .strict(),
  ],
);
/**
 * DTO for the immutable committed fact stored in a receipt's `result_payload`.
 */
export type AttemptCommandReceiptResultPayload = z.infer<
  typeof AttemptCommandReceiptResultPayloadSchema
>;

/** Canonical request payloads (per command) stored in a receipt row. */
export const AttemptCommandReceiptRequestPayloadSchema = z.union([
  ForceSubmitRequestPayloadSchema,
  MisconductMarkRequestPayloadSchema,
]);
/** DTO for the canonical request payload stored in a receipt row. */
export type AttemptCommandReceiptRequestPayload = z.infer<
  typeof AttemptCommandReceiptRequestPayloadSchema
>;

/**
 * A durable attempt command receipt record (the DB row projection, audit §7).
 * This is the internal record contract; the wire response contract
 * {@link AttemptCommandReceiptResponseSchema} below intentionally does not leak
 * every internal column (e.g. `actorId` surfacing is deferred to the route
 * slices per audit §4). The jsonb payloads are bound to the frozen canonical /
 * result unions so a row with a mismatched payload shape cannot be expressed.
 */
export const AttemptCommandReceiptRecordSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string(),
    attemptId: z.string(),
    operationId: z.string().uuid(),
    commandType: AttemptCommandTypeSchema,
    requestPayload: AttemptCommandReceiptRequestPayloadSchema,
    resultPayload: AttemptCommandReceiptResultPayloadSchema,
    outcome: AttemptCommandOutcomeSchema,
    actorId: z.string(),
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, ctx) => {
    // The row's jsonb payloads must belong to the row's command type — a
    // force_submit row storing a misconduct payload is a corrupted identity.
    const requestCommandType =
      "reason" in record.requestPayload ? "force_submit" : "misconduct_mark";
    if (requestCommandType !== record.commandType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `requestPayload shape belongs to ${requestCommandType}, not ${record.commandType}`,
        path: ["requestPayload"],
      });
    }
    if (record.resultPayload.commandType !== record.commandType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `resultPayload.commandType ${record.resultPayload.commandType} does not match ${record.commandType}`,
        path: ["resultPayload"],
      });
    }
  });
/** DTO for a durable attempt command receipt DB record. */
export type AttemptCommandReceiptRecord = z.infer<
  typeof AttemptCommandReceiptRecordSchema
>;

/**
 * Wire response contract for a dangerous Attempt command (audit §4.2/§4.4).
 * Carries the operation identity, the persistent receipt outcome, and the
 * immutable committed fact (returned verbatim on replay).
 *
 * The `disposition`/`outcome` pair is a discriminated union, so semantically
 * inconsistent combinations are un-representable:
 *
 *   - first execution:      disposition == outcome ∈ {applied, no_change}
 *   - replay:               disposition = idempotent_replay, outcome = the
 *                           ORIGINAL stored outcome (applied | no_change)
 *
 * A replay does not write a new row — it returns the original receipt's fact.
 *
 * The outer `commandType` and the inner `resultPayload.commandType` must
 * agree (review J5-I1C0 PR #261 P1-2): a replay response claiming two
 * different command identities is corrupted and must be rejected. This
 * mirrors the {@link AttemptCommandReceiptRecordSchema} consistency rule — a
 * discriminator-by-disposition wrapper cannot express cross-field binding by
 * itself, so a `superRefine` is layered on top of the union.
 */
const AttemptCommandReceiptResponseBranchSchema = z.discriminatedUnion(
  "disposition",
  [
    z
      .object({
        operationId: z.string().uuid(),
        commandType: AttemptCommandTypeSchema,
        disposition: z.literal("applied"),
        outcome: z.literal("applied"),
        resultPayload: AttemptCommandReceiptResultPayloadSchema,
        createdAt: z.string().datetime(),
      })
      .strict(),
    z
      .object({
        operationId: z.string().uuid(),
        commandType: AttemptCommandTypeSchema,
        disposition: z.literal("no_change"),
        outcome: z.literal("no_change"),
        resultPayload: AttemptCommandReceiptResultPayloadSchema,
        createdAt: z.string().datetime(),
      })
      .strict(),
    z
      .object({
        operationId: z.string().uuid(),
        commandType: AttemptCommandTypeSchema,
        disposition: z.literal("idempotent_replay"),
        // The original stored outcome of the replayed receipt.
        outcome: AttemptCommandOutcomeSchema,
        resultPayload: AttemptCommandReceiptResultPayloadSchema,
        createdAt: z.string().datetime(),
      })
      .strict(),
  ],
);

/**
 * The frozen wire response. Use {@link AttemptCommandReceiptResponseSchema}
 * (not the raw branch union) — the wrapper enforces the outer/inner
 * commandType consistency that the discriminator-by-disposition union cannot.
 */
export const AttemptCommandReceiptResponseSchema =
  AttemptCommandReceiptResponseBranchSchema.superRefine((response, ctx) => {
    if (response.resultPayload.commandType !== response.commandType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `resultPayload.commandType ${response.resultPayload.commandType} does not match commandType ${response.commandType}`,
        path: ["resultPayload", "commandType"],
      });
    }
  });
/** DTO for a dangerous Attempt command wire response. */
export type AttemptCommandReceiptResponse = z.infer<
  typeof AttemptCommandReceiptResponseSchema
>;

// ── Operator Time Grant (Admin) ──────────────────────────────────

/**
 * Upper bound of a PostgreSQL `integer`. The `addedSeconds` column is a
 * Postgres integer, not an unbounded JS number; reject oversized values at
 * the contract layer rather than surfacing a low-level DB error.
 */
const POSTGRES_INTEGER_MAX = 2_147_483_647;

/**
 * Request body schema for an admin granting operator time to an attempt
 * (REC-I4-I3B2). The client supplies command identity (`operationId`), the
 * grant magnitude, and a reason. Server-decided fields (actorId, source,
 * policy, beforeDeadline, afterDeadline, incidentId) are intentionally
 * absent — they are derived server-side and can not be set by the caller.
 *
 * `reasonCode` / `reasonText` are trimmed at the contract boundary so the
 * committed ledger and the compliance audit see identical canonical values
 * (prevents a " x " vs "x" payload from looking like a different command on
 * retry, and keeps audit projection in lockstep with the ledger).
 */
export const TimeGrantRequestSchema = z.object({
  operationId: z.string().uuid(),
  addedSeconds: z.number().int().positive().max(POSTGRES_INTEGER_MAX),
  reasonCode: z.string().trim().min(1).max(100),
  reasonText: z.string().trim().min(1).max(1000),
  interruptionId: z.string().uuid().optional(),
  /** Optional incident correlation (REC-I6, ADR-014). Only active for Admin operator path. */
  incidentId: z.string().uuid().optional(),
});

/** Type for an operator time grant request body. */
export type TimeGrantRequest = z.infer<typeof TimeGrantRequestSchema>;

/**
 * Outcome of an operator time grant command. `granted` = a new adjustment was
 * written; `idempotent_replay` = the same command was already committed;
 * `terminal` = deadline reconciliation terminalized the attempt, no grant.
 */
export const GrantOutcomeEnum = z.enum([
  "granted",
  "terminal",
  "idempotent_replay",
]);
export type GrantOutcome = z.infer<typeof GrantOutcomeEnum>;

/**
 * The committed operator adjustment ledger row projected into a grant
 * response. `source` is pinned to `"operator"`: the grant route only ever
 * writes operator-source adjustments, so encoding the full
 * `TimeAdjustmentSource` union here would admit impossible combinations.
 */
const OperatorTimeGrantAdjustmentSchema = z.object({
  id: z.string().uuid(),
  operationId: z.string().uuid(),
  attemptId: z.string().uuid(),
  source: z.literal("operator"),
  beforeDeadline: z.string().datetime(),
  afterDeadline: z.string().datetime(),
  addedSeconds: z.number().int(),
  reasonCode: z.string(),
  reasonText: z.string(),
  interruptionId: z.string().uuid().nullable(),
  incidentId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});

/**
 * Response schema for `POST /admin/attempts/:attemptId/time-grants`. Returns the
 * operation fact (the adjustment ledger row) and the resulting attempt, not
 * just the attempt.
 *
 * Encoded as a discriminated union on `outcome` to make the invariant
 * un-representable: `granted` and `idempotent_replay` require a non-null
 * adjustment (the committed/replayed ledger row), while `terminal` requires
 * `adjustment: null` (deadline reconciliation ended the attempt; nothing was
 * written). The shared `attempt` projection carries the post-command status
 * and deadline.
 */
export const TimeGrantResponseSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("granted"),
    adjustment: OperatorTimeGrantAdjustmentSchema,
    attempt: z.object({
      id: z.string().uuid(),
      status: AttemptStatusEnum,
      deadlineAt: z.string().datetime().nullable(),
    }),
  }),
  z.object({
    outcome: z.literal("idempotent_replay"),
    adjustment: OperatorTimeGrantAdjustmentSchema,
    attempt: z.object({
      id: z.string().uuid(),
      status: AttemptStatusEnum,
      deadlineAt: z.string().datetime().nullable(),
    }),
  }),
  z.object({
    outcome: z.literal("terminal"),
    adjustment: z.null(),
    attempt: z.object({
      id: z.string().uuid(),
      status: AttemptStatusEnum,
      deadlineAt: z.string().datetime().nullable(),
    }),
  }),
]);

/** Type for the operator time grant response. */
export type TimeGrantResponse = z.infer<typeof TimeGrantResponseSchema>;

// ── Attempt Export (P2E-J4) ────────────────────────────────────────

/**
 * Schema for a single question result in the export payload.
 * Represents the candidate's answer, the standard answer, and scoring.
 */
export const AttemptExportQuestionResultSchema = z.object({
  order: z.number().int(),
  type: z.string(),
  content: z.string(),
  candidateAnswer: z.unknown(),
  standardAnswer: z.unknown(),
  score: z.number().nullish(),
  maxScore: z.number(),
  correct: z.boolean().nullish(),
});

/** Type for a single question result in the export payload. */
export type AttemptExportQuestionResult = z.infer<
  typeof AttemptExportQuestionResultSchema
>;

/**
 * Schema for the full attempt export data payload returned by
 * `GET /api/admin/attempts/:id/export`.
 */
export const AttemptExportDataSchema = z.object({
  attemptId: z.string().uuid(),
  examId: z.string().uuid(),
  attemptNo: z.number().int(),
  status: z.string(),
  score: z.number().optional(),
  passed: z.boolean().optional(),
  startedAt: z.string().datetime().optional(),
  submittedAt: z.string().datetime().optional(),
  deadlineAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  questionResults: z.array(AttemptExportQuestionResultSchema),
});

/** Type for the full attempt export data payload. */
export type AttemptExportData = z.infer<typeof AttemptExportDataSchema>;

/**
 * Response schema for `GET /api/admin/attempts/:id/export` (JSON format).
 */
export const AttemptExportResponseSchema = AttemptExportDataSchema;

/** Type for the attempt export JSON response. */
export type AttemptExportResponse = z.infer<typeof AttemptExportResponseSchema>;

// ── Queue ─────────────────────────────────────────────────────────

/**
 * Response schema for queue status when an exam uses batched entry (requireQueue mode).
 * Shows the candidate's position and estimated wait time.
 */
export const QueueStatusResponseSchema = z.object({
  examId: z.string().uuid(),
  status: z.enum(["waiting", "ready"]),
  position: z.number().int().positive(),
  waitCount: z.number().int().min(0),
  estimatedWaitSeconds: z.number().int().min(0),
});

/** Type for queue status response. */
export type QueueStatusResponse = z.infer<typeof QueueStatusResponseSchema>;

/**
 * Detailed exam view for a candidate, including exam metadata, control flags, attempt history,
 * availability status, and the recommended primary action.
 */
export const CandidateExamDetailResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  durationMinutes: z.number().int().positive(),
  passingScore: z.number(),
  totalScore: z.number(),
  questionCount: z.number().int().min(0),
  controlFlags: z.object({
    shuffleQuestions: z.boolean(),
    shuffleOptions: z.boolean(),
    detectTabSwitch: z.boolean(),
    disableCopyPaste: z.boolean(),
    requireQueue: z.boolean(),
    batchSize: z.number().int().positive(),
    batchInterval: z.number().int().positive(),
    restrictIp: z.boolean(),
    requireLockdown: z.boolean(),
    showResultImmediately: z.boolean(),
  }),
  maxAttempts: z.number().int().positive(),
  currentAttempts: z.number().int().min(0),
  activeAttemptId: z.string().uuid().optional(),
  canStartNewAttempt: z.boolean(),
  blockingReason: z.enum(["max_attempts_reached", "already_passed"]).optional(),
  bestScore: z.number().optional(),
  bestScorePercent: z.number().optional(),
  availabilityStatus: AvailabilityStatusEnum,
  primaryAction: PrimaryActionEnum,
});

/** Type for a candidate's detailed exam view response. */
export type CandidateExamDetailResponse = z.infer<
  typeof CandidateExamDetailResponseSchema
>;

// ── CandidateTakeSnapshot (L0 §6.1) ─────────────────────────────

/**
 * InputMode derived from QuestionType. Not stored in DB.
 */
export const InputModeEnum = z.enum([
  "choice",
  "boolean",
  "single_line",
  "multi_line",
]);
export type InputMode = z.infer<typeof InputModeEnum>;

/**
 * GradingMode derived from QuestionType. Not stored in DB.
 */
export const GradingModeEnum = z.enum(["auto", "manual"]);
export type GradingMode = z.infer<typeof GradingModeEnum>;

/**
 * Answer source routing — which column the answerValue comes from.
 */
export const AnswerSourceEnum = z.enum(["draft", "submitted", "none"]);
export type AnswerSource = z.infer<typeof AnswerSourceEnum>;

/**
 * Visibility flags for candidate result/answer views.
 */
export const VisibilityEnum = z.enum(["hidden", "visible"]);
export type Visibility = z.infer<typeof VisibilityEnum>;

/**
 * Lock reason when isEditable is false.
 */
export const LockReasonEnum = z.enum([
  "deadline",
  "submitted",
  "voided",
  "disrupted",
]);
export type LockReason = z.infer<typeof LockReasonEnum>;

/**
 * Candidate-safe question with derived inputMode and answerValue/answerSource.
 * Part of CandidateTakeSnapshot (L0 §6.1).
 *
 * Rich fields (#301): `promptDocument` carries the frozen rich prompt (null
 * = Plain), `options[].contentDocument` the rich option content, and
 * `answerMode` the frozen answer input mode for text_response (missing →
 * "plain" so legacy snapshots drive the plain editor path). Still free of
 * standardAnswer/rubric/gradingMode/correctOption.
 */
export const CandidateTakeQuestionSchema = z.object({
  id: z.string(),
  type: z.enum([
    "single_choice",
    "multiple_choice",
    "fill_blank",
    "true_false",
    "text_response",
  ]),
  prompt: z.string(),
  promptDocument: ContentDocumentV1Schema.nullish().transform((v) => v ?? null),
  answerMode: AnswerModeEnum.nullish().transform((v) => v ?? "plain"),
  options: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
      contentDocument: ContentDocumentV1Schema.nullish().transform(
        (v) => v ?? null,
      ),
    }),
  ),
  inputMode: InputModeEnum,
  maxScore: z.number(),
  answerValue: z.unknown().nullable(),
  answerSource: AnswerSourceEnum,
  currentClientSeq: z.number().int().optional(),
  currentVersion: z.number().int().optional(),
});
export type CandidateTakeQuestion = z.infer<typeof CandidateTakeQuestionSchema>;

/**
 * CandidateTakeSnapshot — the unified response from
 * GET /candidate/attempts/:attemptId/take (L0 §6.1).
 *
 * Contains attempt metadata, derived capabilities, safe questions with
 * answerValue/answerSource, server time fields, and visibility flags.
 * Never contains standardAnswer, rubric, gradingMode, correctOption,
 * teacher notes, or unreleased scores.
 */
export const CandidateTakeSnapshotSchema = z.object({
  attemptId: z.string().uuid(),
  examId: z.string().uuid(),
  attemptStatus: AttemptStatusEnum,
  gradingStatus: GradingStatusFromScore,
  isEditable: z.boolean(),
  canStart: z.boolean(),
  canResume: z.boolean(),
  canSave: z.boolean(),
  canSubmit: z.boolean(),
  lockReason: LockReasonEnum.optional(),
  resultVisibility: VisibilityEnum,
  answerVisibility: VisibilityEnum,
  submittedAt: z.string().datetime().nullable(),
  serverNow: z.string().datetime(),
  effectiveDeadline: z.string().datetime().nullable(),
  serverRevision: z.string().datetime(),
  questions: z.array(CandidateTakeQuestionSchema),
});
export type CandidateTakeSnapshot = z.infer<typeof CandidateTakeSnapshotSchema>;

// ── Candidate Status (Admin / Proctor) ──────────────────────────

/**
 * Schema for a single candidate's live status in the proctor dashboard.
 * Used by GET /api/admin/exams/:examId/candidates/status (P2C-J5).
 */
export const CandidateStatusItemSchema = z.object({
  candidateId: z.string().uuid(),
  name: z.string(),
  attemptId: z.string().uuid().nullable(),
  status: z.enum([
    "not_started",
    "in_progress",
    "disrupted",
    "submitted",
    "grading",
    "graded",
    "voided",
  ]),
  deadlineAt: z.string().datetime().nullable(),
  lastActivityAt: z.string().datetime().nullable(),
  misconduct: MisconductFlagSchema.nullable(),
});

/** DTO for a single candidate's live status in the proctor dashboard. */
export type CandidateStatusItem = z.infer<typeof CandidateStatusItemSchema>;

/**
 * Response schema for the proctor dashboard candidate status endpoint.
 */
export const CandidateStatusResponseSchema = z.object({
  candidates: z.array(CandidateStatusItemSchema),
  total: z.number().int().nonnegative(),
});

/** Response type for the proctor dashboard candidate status endpoint. */
export type CandidateStatusResponse = z.infer<
  typeof CandidateStatusResponseSchema
>;
