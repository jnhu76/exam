import { z } from "zod";
import { AuditAction, type AuditActionKey } from "@exam/authz";

export type AuditLifecycle = "active" | "reserved" | "deprecated";
export type AuditDurability =
  | "atomic"
  | "synchronous_sensitive_read"
  | "best_effort"
  | "domain_history";
export type AuditObligation =
  | "authority"
  | "credential"
  | "privileged_mutation"
  | "privacy_access"
  | "domain_state"
  | "operational";
export type AuditFrequency = "low" | "medium" | "high" | "burst";
export type AuditPayloadSchema = z.ZodType<Record<string, unknown>>;

export interface AuditActionDefinition {
  lifecycle: AuditLifecycle;
  durability: AuditDurability;
  obligation: AuditObligation;
  frequency: AuditFrequency;
  payloadSchema: AuditPayloadSchema;
}

export const AUDIT_TARGET_TYPE_MAX_LENGTH = 64;
export const AUDIT_TARGET_ID_MAX_LENGTH = 128;
export const AUDIT_REQUEST_ID_MAX_LENGTH = 128;
export const AUDIT_USER_AGENT_MAX_LENGTH = 512;
export const AUDIT_IP_ADDRESS_MAX_LENGTH = 64;
export const AUDIT_METADATA_MAX_BYTES = 4_096;

const shortText = z.string().max(100);
const identifier = z.string().max(128);
const freeText = z.string().max(1_000);
const emptyPayload: AuditPayloadSchema = z.object({}).strict();
const usernamePayload: AuditPayloadSchema = z
  .object({ username: z.string().max(50), source: z.literal("local_script") })
  .strict();
const changedFieldsPayload: AuditPayloadSchema = z
  .object({ changedFields: z.array(shortText).max(32) })
  .strict();
const stateTransitionPayload: AuditPayloadSchema = z
  .object({
    reason: z.string().max(500).optional(),
    fromStatus: shortText,
    toStatus: shortText,
    activeAttemptCount: z.number().int().nonnegative().optional(),
  })
  .strict();
const roleChangePayload: AuditPayloadSchema = z
  .object({
    oldRole: shortText.optional(),
    newRole: shortText.optional(),
    role: shortText.optional(),
    isPrimary: z.boolean().optional(),
    assignmentAdded: z.boolean().optional(),
    assignmentDeactivated: z.boolean().optional(),
    oldPrimaryRole: shortText.optional(),
    resultingPrimaryRole: shortText.nullable().optional(),
    assignmentId: identifier.optional(),
    removed: z.boolean().optional(),
    affectedUserId: identifier.optional(),
  })
  .strict();

function definition<
  Lifecycle extends AuditLifecycle,
  Durability extends AuditDurability,
  Obligation extends AuditObligation,
  Frequency extends AuditFrequency,
>(
  lifecycle: Lifecycle,
  durability: Durability,
  obligation: Obligation,
  frequency: Frequency,
  payloadSchema: AuditPayloadSchema = emptyPayload,
): {
  lifecycle: Lifecycle;
  durability: Durability;
  obligation: Obligation;
  frequency: Frequency;
  payloadSchema: AuditPayloadSchema;
} {
  return { lifecycle, durability, obligation, frequency, payloadSchema };
}

export const AUDIT_ACTION_DEFINITIONS = {
  [AuditAction.AdminBootstrap]: definition(
    "active",
    "atomic",
    "authority",
    "low",
    z
      .object({
        username: z.string().max(50),
        name: z.string().max(100),
        source: z.literal("local_script"),
      })
      .strict(),
  ),
  [AuditAction.AdminPasswordResetLocal]: definition(
    "active",
    "atomic",
    "credential",
    "low",
    usernamePayload,
  ),
  [AuditAction.LoginSuccess]: definition(
    "active",
    "best_effort",
    "credential",
    "medium",
  ),
  [AuditAction.LoginFailure]: definition(
    "active",
    "best_effort",
    "credential",
    "burst",
    z
      .object({
        reason: z.enum([
          "unknown_user",
          "invalid_password",
          "invalid_credentials",
          "disabled_user",
          "no_active_assignments",
          "non_login_role",
        ]),
        role: shortText.optional(),
      })
      .strict(),
  ),
  [AuditAction.Logout]: definition(
    "active",
    "best_effort",
    "operational",
    "medium",
  ),
  [AuditAction.AuthProfileUpdate]: definition(
    "active",
    "best_effort",
    "domain_state",
    "low",
    changedFieldsPayload,
  ),
  [AuditAction.AuthPasswordUpdate]: definition(
    "active",
    "atomic",
    "credential",
    "low",
  ),
  [AuditAction.AttemptStart]: definition(
    "deprecated",
    "domain_history",
    "domain_state",
    "burst",
  ),
  [AuditAction.AttemptSaveAnswer]: definition(
    "deprecated",
    "domain_history",
    "domain_state",
    "high",
  ),
  [AuditAction.AttemptSubmit]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "burst",
  ),
  [AuditAction.AttemptRestore]: definition(
    "deprecated",
    "domain_history",
    "domain_state",
    "burst",
  ),
  [AuditAction.AttemptForceSubmit]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
    z.object({ reason: z.string().max(500).optional() }).strict(),
  ),
  // REC-I4-I3B2: the old POST /extend-time route was cut. The action is retained
  // verbatim (ADR "NO rename") but deprecated — no production emitter remains.
  [AuditAction.AttemptExtendTime]: definition(
    "deprecated",
    "atomic",
    "privileged_mutation",
    "low",
    z.object({ additionalMinutes: z.number().int().positive() }).strict(),
  ),
  [AuditAction.AttemptTimeGrant]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
    z
      .object({
        // The attempt.timeGrant audit is written ONLY on outcome `granted`,
        // for which a non-null adjustment ledger row always exists. A nullable
        // adjustmentId admitted the impossible "granted audit, no adjustment"
        // combination; making it a required UUID encodes the invariant.
        adjustmentId: z.string().uuid(),
        operationId: z.string().uuid(),
        addedSeconds: z.number().int().positive(),
        reasonCode: z.string().max(100),
        interruptionId: z.string().uuid().nullable().optional(),
      })
      .strict(),
  ),
  [AuditAction.AttemptMisconductFlagged]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
    z.object({ severity: shortText, notes: freeText.optional() }).strict(),
  ),
  [AuditAction.AttemptExported]: definition(
    "active",
    "synchronous_sensitive_read",
    "privacy_access",
    "low",
    z.object({ format: z.string().max(16) }).strict(),
  ),
  [AuditAction.AttemptAutoSubmit]: definition(
    "deprecated",
    "domain_history",
    "domain_state",
    "burst",
  ),
  [AuditAction.AttemptDisrupted]: definition(
    "deprecated",
    "domain_history",
    "domain_state",
    "burst",
  ),
  [AuditAction.BrandingUpdate]: definition(
    "active",
    "best_effort",
    "domain_state",
    "low",
    changedFieldsPayload,
  ),
  [AuditAction.CandidateCreate]: definition(
    "active",
    "atomic",
    "authority",
    "medium",
  ),
  [AuditAction.CandidateUpdate]: definition(
    "active",
    "best_effort",
    "domain_state",
    "medium",
    changedFieldsPayload,
  ),
  [AuditAction.CandidateImport]: definition(
    "active",
    "best_effort",
    "domain_state",
    "burst",
    z
      .object({
        total: z.number().int().nonnegative(),
        created: z.number().int().nonnegative(),
        updated: z.number().int().nonnegative(),
        errors: z.number().int().nonnegative(),
      })
      .strict(),
  ),
  [AuditAction.CandidatePasswordReset]: definition(
    "active",
    "atomic",
    "credential",
    "low",
  ),
  [AuditAction.CandidateFieldCreate]: definition(
    "active",
    "best_effort",
    "domain_state",
    "low",
  ),
  [AuditAction.CandidateFieldUpdate]: definition(
    "active",
    "best_effort",
    "domain_state",
    "low",
    changedFieldsPayload,
  ),
  [AuditAction.CandidateFieldDelete]: definition(
    "active",
    "best_effort",
    "domain_state",
    "low",
  ),
  [AuditAction.CourseCreate]: definition(
    "active",
    "best_effort",
    "domain_state",
    "low",
  ),
  [AuditAction.CourseUpdate]: definition(
    "active",
    "best_effort",
    "domain_state",
    "low",
    changedFieldsPayload,
  ),
  [AuditAction.CourseDelete]: definition(
    "active",
    "best_effort",
    "domain_state",
    "low",
  ),
  [AuditAction.EnrollmentAdd]: definition(
    "active",
    "atomic",
    "authority",
    "medium",
    z.object({ examId: identifier, candidateId: identifier }).strict(),
  ),
  [AuditAction.EnrollmentRemove]: definition(
    "active",
    "atomic",
    "authority",
    "medium",
    z.object({ examId: identifier, candidateId: identifier }).strict(),
  ),
  [AuditAction.ExamCreate]: definition(
    "active",
    "best_effort",
    "domain_state",
    "low",
  ),
  [AuditAction.ExamUpdate]: definition(
    "active",
    "best_effort",
    "domain_state",
    "medium",
    changedFieldsPayload,
  ),
  [AuditAction.ExamPublishedScheduleUpdated]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
    changedFieldsPayload,
  ),
  [AuditAction.ExamPublish]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
  ),
  [AuditAction.ExamUnpublish]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
    stateTransitionPayload,
  ),
  [AuditAction.ExamClose]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
    stateTransitionPayload,
  ),
  [AuditAction.ExamCancel]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
    stateTransitionPayload,
  ),
  [AuditAction.ExamArchive]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
    stateTransitionPayload,
  ),
  [AuditAction.ExamDelete]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
  ),
  [AuditAction.ExamExtend]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
    z
      .object({
        extendMinutes: z.number().int().positive(),
        oldCloseAt: z.string().datetime(),
        newCloseAt: z.string().datetime(),
        reason: z.string().max(500).optional(),
      })
      .strict(),
  ),
  [AuditAction.ExamPublishResults]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
    z.object({ resultsPublishedAt: z.string().datetime() }).strict(),
  ),
  [AuditAction.ExamOpen]: definition(
    "deprecated",
    "domain_history",
    "domain_state",
    "burst",
  ),
  [AuditAction.ExamClosed]: definition(
    "deprecated",
    "domain_history",
    "domain_state",
    "burst",
  ),
  [AuditAction.QuestionCreate]: definition(
    "active",
    "best_effort",
    "domain_state",
    "medium",
  ),
  [AuditAction.QuestionUpdate]: definition(
    "active",
    "best_effort",
    "domain_state",
    "medium",
    changedFieldsPayload,
  ),
  [AuditAction.QuestionDelete]: definition(
    "active",
    "best_effort",
    "domain_state",
    "medium",
  ),
  [AuditAction.QuestionImport]: definition(
    "active",
    "best_effort",
    "domain_state",
    "burst",
    z
      .object({
        total: z.number().int().nonnegative(),
        valid: z.number().int().nonnegative(),
        errors: z.number().int().nonnegative(),
      })
      .strict(),
  ),
  [AuditAction.UserCreate]: definition("active", "atomic", "authority", "low"),
  [AuditAction.UserUpdate]: definition(
    "deprecated",
    "best_effort",
    "domain_state",
    "low",
  ),
  [AuditAction.UserProfileUpdated]: definition(
    "active",
    "best_effort",
    "domain_state",
    "low",
    changedFieldsPayload,
  ),
  [AuditAction.UserDisabled]: definition(
    "active",
    "atomic",
    "authority",
    "low",
  ),
  [AuditAction.UserReactivated]: definition(
    "active",
    "atomic",
    "authority",
    "low",
  ),
  [AuditAction.UserDelete]: definition("active", "atomic", "authority", "low"),
  [AuditAction.ExportScores]: definition(
    "active",
    "synchronous_sensitive_read",
    "privacy_access",
    "low",
    z
      .object({
        format: z.literal("csv"),
        rowCount: z.number().int().nonnegative(),
      })
      .strict(),
  ),
  [AuditAction.GradingScoreEntered]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "medium",
    z
      .object({
        questionId: identifier,
        score: z.number().nonnegative(),
        maxScore: z.number().nonnegative(),
        previousScore: z.number().nullable(),
        graderId: identifier,
      })
      .strict(),
  ),
  [AuditAction.GradingFinalized]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
    z
      .object({
        gradingStatus: z.literal("fully_graded"),
        graderId: identifier,
      })
      .strict(),
  ),
  [AuditAction.GradingDetailViewed]: definition(
    "active",
    "synchronous_sensitive_read",
    "privacy_access",
    "medium",
    z.object({ examId: identifier, candidateId: identifier }).strict(),
  ),
  [AuditAction.UserRoleChanged]: definition(
    "active",
    "atomic",
    "authority",
    "low",
    roleChangePayload,
  ),
  [AuditAction.EmailOutboxCreated]: definition(
    "reserved",
    "best_effort",
    "operational",
    "medium",
  ),
  [AuditAction.EmailSendFailed]: definition(
    "reserved",
    "best_effort",
    "operational",
    "medium",
  ),
  [AuditAction.EmailSendRetried]: definition(
    "reserved",
    "best_effort",
    "operational",
    "medium",
  ),
  [AuditAction.ProctorIncidentMarked]: definition(
    "active",
    "atomic",
    "privileged_mutation",
    "low",
    z
      .object({
        incidentType: z.string().max(50),
        examId: identifier,
        candidateId: identifier,
        attemptId: identifier,
        reasonCode: z.string().max(100).nullable(),
        note: z.string().max(500).nullable(),
      })
      .strict(),
  ),
} as const satisfies Record<AuditActionKey, AuditActionDefinition>;

export type AuditActionForDurability<Durability extends AuditDurability> = {
  [Action in AuditActionKey]: (typeof AUDIT_ACTION_DEFINITIONS)[Action]["durability"] extends Durability
    ? Action
    : never;
}[AuditActionKey];

export type AuditActionForLifecycle<Lifecycle extends AuditLifecycle> = {
  [Action in AuditActionKey]: (typeof AUDIT_ACTION_DEFINITIONS)[Action]["lifecycle"] extends Lifecycle
    ? Action
    : never;
}[AuditActionKey];

export type ActiveAuditActionForDurability<Durability extends AuditDurability> =
  Extract<
    AuditActionForDurability<Durability>,
    AuditActionForLifecycle<"active">
  >;

export function assertAuditDurability(
  action: AuditActionKey,
  expected: AuditDurability,
): void {
  const actual = AUDIT_ACTION_DEFINITIONS[action].durability;
  if (actual !== expected) {
    throw new Error(
      `Audit action ${action} has durability ${actual}, not ${expected}`,
    );
  }
}

export function assertActiveAuditAction(action: AuditActionKey): void {
  const lifecycle = AUDIT_ACTION_DEFINITIONS[action].lifecycle;
  if (lifecycle !== "active") {
    throw new Error(`Audit action ${action} is ${lifecycle}, not active`);
  }
}

export function validateAuditPayload(
  action: AuditActionKey,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return AUDIT_ACTION_DEFINITIONS[action].payloadSchema.parse(payload);
}
