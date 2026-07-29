/**
 * Phase 3 Scoped RBAC catalog constants (RBAC-M1).
 *
 * Source of truth: `docs/adr/ADR-010-scoped-rbac-architecture.md`
 * §Permission Catalog v0, §Scope Model v0, §Role Presets.
 *
 * These are the closed, type-safe unions. Unknown strings are a load-time
 * error (ADR Formal Model §5–6): every DB-seeded `permissions` row must map to
 * a {@link PermissionKey}; a typo against the union is a compile error.
 *
 * Naming: dotted `domain.resource.action` (lowercase). This supersedes the
 * legacy `SCREAMING_SNAKE` keys in `@exam/domain` enums; {@link legacyMap.ts}
 * bridges the two during migration.
 */

// ───────────────────────── Permissions (ADR §4) ─────────────────────────

/**
 * Permission catalog. Every key is `domain.resource.action`.
 * Grouped by domain to mirror ADR §4.1–§4.9.
 */
export const Permission = {
  // §4.1 User / Organization
  UserView: "user.view",
  UserCreate: "user.create",
  UserUpdate: "user.update",
  UserDelete: "user.delete",
  UserRoleAssign: "user.role.assign",
  UserPasswordReset: "user.password.reset",
  OrganizationView: "organization.view",
  OrganizationUpdate: "organization.update",
  SettingsView: "settings.view",
  SettingsUpdate: "settings.update",
  AuditLogView: "audit_log.view",

  // §4.2 Candidate Management
  CandidateView: "candidate.view",
  CandidateCreate: "candidate.create",
  CandidateUpdate: "candidate.update",
  CandidateImport: "candidate.import",
  // CandidateDelete (candidate.delete): UNRESOLVED — granted to Admin but no
  // DELETE /candidates/:id route exists today. Retained pending product
  // decision (P4-G-04). Removing the route-less grant is out of P4-C1 scope.
  CandidateDelete: "candidate.delete",
  CandidateFieldView: "candidate_field.view",
  CandidateFieldCreate: "candidate_field.create",
  CandidateFieldUpdate: "candidate_field.update",
  CandidateFieldDelete: "candidate_field.delete",

  // §4.3 Course / Question
  CourseView: "course.view",
  CourseCreate: "course.create",
  CourseUpdate: "course.update",
  CourseDelete: "course.delete",
  QuestionView: "question.view",
  QuestionCreate: "question.create",
  QuestionUpdate: "question.update",
  QuestionDelete: "question.delete",
  QuestionImport: "question.import",

  // §4.4 Exam Lifecycle
  ExamView: "exam.view",
  ExamCreate: "exam.create",
  ExamUpdate: "exam.update",
  ExamPublish: "exam.publish",
  ExamUnpublish: "exam.unpublish",
  ExamClose: "exam.close",
  ExamCancel: "exam.cancel",
  ExamArchive: "exam.archive",
  ExamDelete: "exam.delete",
  ExamExtend: "exam.extend",
  ExamResultPublish: "exam.result.publish",
  ExamEnrollmentManage: "exam.enrollment.manage",

  // §4.5 Candidate Runtime
  ExamTake: "exam.take",
  AttemptViewOwn: "attempt.view_own",
  AttemptStart: "attempt.start",
  AttemptAnswerSave: "attempt.answer.save",
  AttemptSubmit: "attempt.submit",
  AttemptRestore: "attempt.restore",
  AttemptHeartbeatSend: "attempt.heartbeat.send",
  ScoreOwnView: "score.own.view",

  // §4.6 Proctor Runtime
  ExamRoomView: "exam_room.view",
  AttemptStatusView: "attempt.status.view",
  AttemptTimelineView: "attempt.timeline.view",
  AttemptMisconductMark: "attempt.misconduct.mark",
  AttemptTimeExtend: "attempt.time.extend",
  AttemptTimeGrant: "attempt.time.grant",
  AttemptForceSubmit: "attempt.force_submit",
  AttemptExport: "attempt.export",

  // §4.7 Grading
  GradingQueueView: "grading.queue.view",
  GradingDetailView: "grading.detail.view",
  GradingAnswerView: "grading.answer.view",
  GradingScoreWrite: "grading.score.write",
  // GradingFinalize / GradingIdentityView: RESERVED for M11 scoped grading.
  // Omitted from all human presets by design (scoped finalize + double-blind
  // identity). No route consumes them today; grade-question +
  // finalizeTerminalGrading run without a separate HTTP gate. Owner: M11.
  GradingFinalize: "grading.finalize",
  GradingIdentityView: "grading.identity.view",

  // §4.8 Scores / Results
  // NOTE: the historical `result.publish` alias (ResultPublish) was removed in
  // P4-C1. The live result-publication capability is `ExamResultPublish`
  // (exam.result.publish), granted to Admin+Teacher and consumed by
  // POST /exams/:id/publish-results. `result.publish` had zero route consumers
  // and zero grants — see docs/audits/P4-C1-AUTHORIZATION-RESIDUE-CLEANUP.md.
  ScoreAllView: "score.all.view",
  ScoreExport: "score.export",

  // §4.9 System / Diagnostics
  SystemHealthView: "system.health.view",
  SystemDiagnosticsView: "system.diagnostics.view",
  // SystemInfoView (system.info.view): UNRESOLVED — GET /system/info is public
  // today, so no role needs this perm. Retained pending product decision
  // (P4-G-04); removing it is out of P4-C1 scope.
  SystemInfoView: "system.info.view",
  // SystemAutoSubmit / SystemHeartbeatScan / SystemLifecycleReconcile:
  // System-actor-only capabilities bound to synthetic actor identities in the
  // deadlineScanner / heartbeat plugins. Not human HTTP-route permissions; not
  // login-capable; never reach the assignment-authority path.
  SystemAutoSubmit: "system.auto_submit",
  SystemHeartbeatScan: "system.heartbeat_scan",
  SystemLifecycleReconcile: "system.lifecycle_reconcile",
} as const;

/** Closed permission union. A typo is a compile error. */
export type PermissionKey = (typeof Permission)[keyof typeof Permission];

// ───────────────────────── Scopes (ADR §5) ─────────────────────────

/**
 * Scope model. `school`, `grading_task` are deferred (no tables) and therefore
 * intentionally absent. `question` is a resource, not an enforced scope, in
 * Phase 3 (ADR §5.4) — not listed as a scope.
 */
export const Scope = {
  System: "system",
  Organization: "organization",
  Course: "course",
  Exam: "exam",
  Attempt: "attempt",
  Candidate: "candidate",
  OwnAttempt: "own_attempt",
  OwnScore: "own_score",
} as const;

export type ScopeType = (typeof Scope)[keyof typeof Scope];

// ───────────────────────── Roles (ADR Role Presets) ─────────────────────────

/**
 * The six Phase 3 role presets. System is non-login, non-assignable; the others
 * are product defaults assigned via the existing user-management surface.
 * Custom roles (Phase 4) are `is_system = false` DB rows, not new keys here.
 */
export const Role = {
  Admin: "Admin",
  Teacher: "Teacher",
  Proctor: "Proctor",
  Grader: "Grader",
  Candidate: "Candidate",
  System: "System",
} as const;

export type RoleKey = (typeof Role)[keyof typeof Role];

// Audit actions are owned by auditActions.ts (AUDIT-M1: full legacy union and
// API audit-boundary validation). See that module for the closed set; the
// barrel re-exports `AuditAction` / `AuditActionKey` for convenience.
