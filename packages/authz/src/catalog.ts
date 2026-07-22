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
  AttemptForceSubmit: "attempt.force_submit",
  AttemptExport: "attempt.export",

  // §4.7 Grading
  GradingQueueView: "grading.queue.view",
  GradingDetailView: "grading.detail.view",
  GradingAnswerView: "grading.answer.view",
  GradingScoreWrite: "grading.score.write",
  GradingFinalize: "grading.finalize",
  GradingIdentityView: "grading.identity.view",

  // §4.8 Scores / Results
  ScoreAllView: "score.all.view",
  ScoreExport: "score.export",
  ResultPublish: "result.publish",

  // §4.9 System / Diagnostics
  SystemHealthView: "system.health.view",
  SystemDiagnosticsView: "system.diagnostics.view",
  SystemInfoView: "system.info.view",
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
