/**
 * Audit action constants (AUDIT-M1).
 *
 * Closed, type-safe union of every audit action written by the platform.
 * Source of truth: `apps/api/src` — every string passed to `recordAudit(...)`
 * or `createAuditLogRepo().create({ action })`. AUDIT-M1 validates at the
 * `recordAudit` boundary (apps/api), so an unknown action fails loud instead
 * of silently producing a free-form `audit_logs.action` row.
 *
 * **ADR Audit Boundary — NO rename.** The legacy camelCase names
 * (`attempt.forceSubmit`, `grading.score_entered`, …) are kept verbatim. The
 * jobcard-proposed `attempt.force_submitted` / `grading.score_submitted` are
 * NOT introduced (ADR "Naming collision guard"). The only new actions are the
 * ADR-mandated sensitive-read ones: `grading.detail_viewed`, `user.role_changed`.
 */

export const AuditAction = {
  // ── Admin / account ──
  AdminBootstrap: "admin.bootstrap",
  AdminPasswordResetLocal: "admin.password_reset.local",

  // ── Attempt lifecycle (candidate runtime) ──
  AttemptStart: "attempt.start",
  AttemptSubmit: "attempt.submit",

  // ── Attempt admin / proctor operations ──
  AttemptForceSubmit: "attempt.forceSubmit",
  AttemptExtendTime: "attempt.extendTime",
  AttemptMisconductFlagged: "attempt.misconductFlagged",
  AttemptExported: "attempt.exported",

  // ── System actor (scanners) ──
  AttemptAutoSubmit: "attempt.autoSubmit",
  AttemptDisrupted: "attempt.disrupted",

  // ── Candidate ──
  CandidateUpdate: "candidate.update",

  // ── Course ──
  CourseCreate: "course.create",
  CourseUpdate: "course.update",
  CourseDelete: "course.delete",

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

  // ── Question ──
  QuestionUpdate: "question.update",
  QuestionDelete: "question.delete",

  // ── User ──
  UserCreate: "user.create",
  UserUpdate: "user.update",
  UserDelete: "user.delete",

  // ── Auth ──
  Logout: "logout",

  // ── Exports ──
  ExportScores: "export_scores",

  // ── Grading ──
  GradingScoreEntered: "grading.score_entered",
  GradingFinalized: "grading.finalized",

  // ── ADR-mandated NEW actions (AUDIT-M2 wires these) ──
  GradingDetailViewed: "grading.detail_viewed",
  UserRoleChanged: "user.role_changed",
} as const;

export type AuditActionKey = (typeof AuditAction)[keyof typeof AuditAction];

/**
 * The complete set of action strings actually emitted by `apps/api/src`
 * (non-test) today — captured via `rg` over `recordAudit(...)` and
 * `createAuditLogRepo().create({ action })` callers, plus the two ADR-mandated
 * new actions. AUDIT-M1's `recordAudit` validation must accept all of these.
 * This constant doubles as the regression test fixture.
 */
export const KNOWN_PRODUCTION_AUDIT_ACTIONS: readonly string[] = [
  "admin.bootstrap",
  "admin.password_reset.local",
  "attempt.autoSubmit",
  "attempt.disrupted",
  "attempt.exported",
  "attempt.extendTime",
  "attempt.forceSubmit",
  "attempt.misconductFlagged",
  "attempt.start",
  "attempt.submit",
  "candidate.update",
  "course.create",
  "course.delete",
  "course.update",
  "exam.archive",
  "exam.cancel",
  "exam.close",
  "exam.create",
  "exam.delete",
  "exam.extend",
  "exam.publish",
  "exam.publish_results",
  "exam.unpublish",
  "exam.update",
  "export_scores",
  "grading.finalized",
  "grading.score_entered",
  "logout",
  "question.delete",
  "question.update",
  "user.create",
  "user.delete",
  "user.update",
  // ADR-mandated new actions
  "grading.detail_viewed",
  "user.role_changed",
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
