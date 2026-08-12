/**
 * Audit action constants (AUDIT-M1).
 *
 * Closed, type-safe union of every audit action written by the platform.
 * This file owns vocabulary only. Lifecycle, durability, obligation,
 * frequency, payload validation, and runtime emitter ownership are separate
 * concerns defined by the API audit boundary.
 *
 * **ADR Audit Boundary — NO rename.** The legacy names (`attempt.forceSubmit`,
 * `grading.score_entered`, `export_scores`, `branding.update`, …) are kept
 * verbatim. The jobcard-proposed `attempt.force_submitted` /
 * `grading.score_submitted` are NOT introduced (ADR "Naming collision guard").
 * New vocabulary is additive; lifecycle and compatibility decisions are
 * recorded by the policy layer rather than encoded in this enum.
 */

export const AuditAction = {
  // ── Admin / account ──
  AdminBootstrap: "admin.bootstrap",
  AdminPasswordResetLocal: "admin.password_reset.local",

  // ── Auth ──
  LoginSuccess: "login.success",
  LoginFailure: "login.failure",
  Logout: "logout",
  AuthProfileUpdate: "auth.profile_update",
  AuthPasswordUpdate: "auth.password_update",

  // ── Attempt lifecycle (candidate runtime) ──
  AttemptStart: "attempt.start",
  AttemptSaveAnswer: "attempt.saveAnswer",
  AttemptSubmit: "attempt.submit",
  AttemptRestore: "attempt.restore",

  // ── Attempt admin / proctor operations ──
  AttemptForceSubmit: "attempt.forceSubmit",
  AttemptExtendTime: "attempt.extendTime",
  AttemptTimeGrant: "attempt.timeGrant",
  AttemptMisconductFlagged: "attempt.misconductFlagged",
  AttemptExported: "attempt.exported",

  // ── System actor (scanners) ──
  AttemptAutoSubmit: "attempt.autoSubmit",
  AttemptDisrupted: "attempt.disrupted",

  // ── Branding / settings ──
  BrandingUpdate: "branding.update",

  // ── System operations (P7-E2A, ADR-017 D7) ──
  // POST /email/test is a side-effecting action; it is audited under its own
  // action, never under a diagnostics-view action.
  SystemEmailTest: "system.email.test",

  // ── Candidate ──
  CandidateCreate: "candidate.create",
  CandidateUpdate: "candidate.update",
  CandidateImport: "candidate.import",
  CandidatePasswordReset: "candidate.password_reset",

  // ── Candidate fields ──
  CandidateFieldCreate: "candidate_field.create",
  CandidateFieldUpdate: "candidate_field.update",
  CandidateFieldDelete: "candidate_field.delete",

  // ── Course ──
  CourseCreate: "course.create",
  CourseUpdate: "course.update",
  CourseDelete: "course.delete",

  // ── Enrollment ──
  EnrollmentAdd: "enrollment.add",
  EnrollmentRemove: "enrollment.remove",

  // ── Exam lifecycle ──
  ExamCreate: "exam.create",
  ExamUpdate: "exam.update",
  ExamPublish: "exam.publish",
  ExamUnpublish: "exam.unpublish",
  ExamClose: "exam.close",
  ExamCancel: "exam.cancel",
  ExamArchive: "exam.archive",
  ExamDelete: "exam.delete",
  ExamExtend: "exam.extend",
  ExamPublishResults: "exam.publish_results",
  ExamOpen: "exam.open",
  ExamClosed: "exam.closed",

  // ── Exam policy profiles (P7-M2 authoring templates) ──
  ExamProfileCreate: "exam_profile.create",
  ExamProfileUpdate: "exam_profile.update",
  ExamProfileDelete: "exam_profile.delete",

  // ── Question ──
  QuestionCreate: "question.create",
  QuestionUpdate: "question.update",
  QuestionDelete: "question.delete",
  QuestionImport: "question.import",

  // ── User ──
  UserCreate: "user.create",
  UserUpdate: "user.update",
  UserProfileUpdated: "user.profile_updated",
  UserDisabled: "user.disabled",
  UserReactivated: "user.reactivated",
  UserDelete: "user.delete",

  // ── Exports ──
  ExportScores: "export_scores",

  // ── Grading ──
  GradingScoreEntered: "grading.score_entered",
  GradingFinalized: "grading.finalized",

  // ── Privileged access and authority ──
  GradingDetailViewed: "grading.detail_viewed",
  UserRoleChanged: "user.role_changed",

  // ── Published exam security-sensitive update ──
  ExamPublishedScheduleUpdated: "exam.published_schedule_updated",

  // ── Email outbox (P3-M4A) ──
  EmailOutboxCreated: "email.outbox_created",
  EmailSendFailed: "email.send_failed",
  EmailSendRetried: "email.send_retried",

  // ── Proctor incidents (P3-M9) ──
  ProctorIncidentMarked: "proctor.incident_marked",

  // ── Exam incidents (ADR-014) ──
  IncidentCreated: "incident.created",
  IncidentInvestigated: "incident.investigated",
  IncidentNoteAdded: "incident.note_added",
  IncidentSeverityChanged: "incident.severity_changed",
  IncidentResolved: "incident.resolved",
  IncidentDismissed: "incident.dismissed",
  IncidentActionLinked: "incident.action_linked",
  IncidentAttemptLinked: "incident.attempt_linked",
  IncidentInterruptionLinked: "incident.interruption_linked",

  // ── Proctor-to-Exam assignments (ADR-015) ──
  ExamProctorAssigned: "exam.proctor_assigned",
  ExamProctorRevoked: "exam.proctor_revoked",
} as const;

export type AuditActionKey = (typeof AuditAction)[keyof typeof AuditAction];

const AUDIT_ACTION_VALUES: ReadonlySet<string> = new Set(
  Object.values(AuditAction),
);

/** Type guard: true iff `value` is a known {@link AuditActionKey}. */
export function isAuditAction(value: unknown): value is AuditActionKey {
  return typeof value === "string" && AUDIT_ACTION_VALUES.has(value);
}

/**
 * Asserts `action` is a known {@link AuditActionKey}. Throws on unknown.
 * Used at the API audit boundary so an unregistered action fails loud
 * (ADR §3.9 — never silently accept a malformed audit row).
 */
export function assertAuditAction(
  action: string,
): asserts action is AuditActionKey {
  if (!AUDIT_ACTION_VALUES.has(action)) {
    throw new Error(
      `Unknown audit action: ${action}. Add it to AuditAction in @exam/authz.`,
    );
  }
}
