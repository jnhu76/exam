/**
 * Audit action constants (AUDIT-M1).
 *
 * Closed, type-safe union of every audit action written by the platform.
 * Source of truth: `apps/api/src` — every string passed to `recordAudit(...)`
 * or `createAuditLogRepo().create({ action })`, captured via multiline `rg`
 * (single-line AND multi-line call sites). AUDIT-M1 validates at the
 * `recordAudit` boundary (apps/api), so an unknown action is logged as an
 * error and the write is skipped (fail-loud, ADR §3.9) instead of silently
 * producing a free-form `audit_logs.action` row.
 *
 * **ADR Audit Boundary — NO rename.** The legacy names (`attempt.forceSubmit`,
 * `grading.score_entered`, `export_scores`, `branding.update`, …) are kept
 * verbatim. The jobcard-proposed `attempt.force_submitted` /
 * `grading.score_submitted` are NOT introduced (ADR "Naming collision guard").
 * The only new actions are the ADR-mandated sensitive-read ones:
 * `grading.detail_viewed`, `user.role_changed`.
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

  // ── Attempt lifecycle (candidate runtime) ──
  AttemptStart: "attempt.start",
  AttemptSaveAnswer: "attempt.saveAnswer",
  AttemptSubmit: "attempt.submit",
  AttemptRestore: "attempt.restore",

  // ── Attempt admin / proctor operations ──
  AttemptForceSubmit: "attempt.forceSubmit",
  AttemptExtendTime: "attempt.extendTime",
  AttemptMisconductFlagged: "attempt.misconductFlagged",
  AttemptExported: "attempt.exported",

  // ── System actor (scanners) ──
  AttemptAutoSubmit: "attempt.autoSubmit",
  AttemptDisrupted: "attempt.disrupted",

  // ── Branding / settings ──
  BrandingUpdate: "branding.update",

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
  ExamOpen: "exam.open", // status-transition audit (reconciliation)
  ExamClosed: "exam.closed", // status-transition audit (reconciliation)

  // ── Question ──
  QuestionCreate: "question.create",
  QuestionUpdate: "question.update",
  QuestionDelete: "question.delete",
  QuestionImport: "question.import",

  // ── User ──
  UserCreate: "user.create",
  UserUpdate: "user.update",
  UserDelete: "user.delete",

  // ── Exports ──
  ExportScores: "export_scores",

  // ── Grading ──
  GradingScoreEntered: "grading.score_entered",
  GradingFinalized: "grading.finalized",

  // ── ADR-mandated NEW actions (AUDIT-M2 wires these) ──
  GradingDetailViewed: "grading.detail_viewed",
  UserRoleChanged: "user.role_changed",

  // ── Email outbox (P3-M4A) ──
  EmailOutboxCreated: "email.outbox_created",
  EmailSendFailed: "email.send_failed",
  EmailSendRetried: "email.send_retried",

  // ── Proctor incidents (P3-M9) ──
  ProctorIncidentMarked: "proctor.incident_marked",
} as const;

export type AuditActionKey = (typeof AuditAction)[keyof typeof AuditAction];

/**
 * The complete set of action strings actually emitted by `apps/api/src`
 * (non-test) today — captured via multiline `rg` over `recordAudit(...)` and
 * `createAuditLogRepo().create({ action })` callers, plus the two ADR-mandated
 * new actions. AUDIT-M1's `recordAudit` validation must accept all of these.
 * This constant doubles as the regression test fixture.
 */
export const KNOWN_PRODUCTION_AUDIT_ACTIONS: readonly string[] = [
  "admin.bootstrap",
  "admin.password_reset.local",
  "auth.profile_update",
  "attempt.autoSubmit",
  "attempt.disrupted",
  "attempt.exported",
  "attempt.extendTime",
  "attempt.forceSubmit",
  "attempt.misconductFlagged",
  "attempt.restore",
  "attempt.saveAnswer",
  "attempt.start",
  "attempt.submit",
  "branding.update",
  "candidate.create",
  "candidate.import",
  "candidate.password_reset",
  "candidate.update",
  "candidate_field.create",
  "candidate_field.delete",
  "candidate_field.update",
  "course.create",
  "course.delete",
  "course.update",
  "enrollment.add",
  "enrollment.remove",
  "exam.archive",
  "exam.cancel",
  "exam.close",
  "exam.create",
  "exam.delete",
  "exam.extend",
  "exam.publish",
  "exam.publish_results",
  "exam.open",
  "exam.closed",
  "exam.unpublish",
  "exam.update",
  "email.outbox_created",
  "email.send_failed",
  "email.send_retried",
  "export_scores",
  "grading.detail_viewed",
  "grading.finalized",
  "grading.score_entered",
  "login.failure",
  "login.success",
  "logout",
  "proctor.incident_marked",
  "question.create",
  "question.delete",
  "question.import",
  "question.update",
  "user.create",
  "user.delete",
  "user.role_changed",
  "user.update",
];

const AUDIT_ACTION_VALUES: ReadonlySet<string> = new Set(
  Object.values(AuditAction),
);

/** Type guard: true iff `value` is a known {@link AuditActionKey}. */
export function isAuditAction(value: unknown): value is AuditActionKey {
  return typeof value === "string" && AUDIT_ACTION_VALUES.has(value);
}

/**
 * Asserts `action` is a known {@link AuditActionKey}. Throws on unknown.
 * Used at the `recordAudit` boundary so an unregistered action fails loud
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
