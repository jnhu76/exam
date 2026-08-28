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
  // SystemBusinessIntegrityView (system.business_integrity.view): P7-E2A
  // (ADR-017 D8) — the business-integrity diagnostics block (submitted-not-
  // terminalized / workset-mismatch attempt anomalies) is a BUSINESS-domain
  // surface, Admin-only. GET /system/diagnostics includes the `integrity`
  // block only for actors holding this capability; the operational projection
  // (Maintainer) never receives it.
  SystemBusinessIntegrityView: "system.business_integrity.view",
  // SystemBusinessSummaryView (system.business_summary.view): P7-E2C — the
  // business-owner summary dashboard (question/exam/candidate/attempt
  // aggregates + recent exams) is BUSINESS-domain observation, Admin-only.
  // The Maintainer preset must never receive business statistics through an
  // operational capability.
  SystemBusinessSummaryView: "system.business_summary.view",
  // SystemBackupView (system.backup.view): P7-E2B — read-only backup evidence
  // projection (latest / latest verified / history / last failure). No write
  // sibling exists: backup.trigger / schedule / retention are decision-gated
  // (ADR-017 D5) and NOT implemented.
  SystemBackupView: "system.backup.view",
  // SystemRestoreReadinessView (system.restore_readiness.view): P7-E2B —
  // read-only restore-readiness / drill evidence projection. Restore itself
  // stays host-only (ADR-017 D4); only drill EVIDENCE is readable.
  SystemRestoreReadinessView: "system.restore_readiness.view",
  // SystemOpsPolicyView (system.ops.policy.view): P7-E3 — read the Admin's
  // DESIRED operational objectives (intent) + the compliance projection.
  // Granted to Admin AND Maintainer (Maintainer may view intent, never
  // modify it — ADR-017 D9).
  SystemOpsPolicyView: "system.ops.policy.view",
  // SystemOpsPolicyManage (system.ops.policy.manage): P7-E3 — Admin is the
  // SOLE intent owner. Writes the typed, audited, non-binding policy intent
  // record. Never granted to Maintainer (execution-side policy authority is
  // decision-gated, ADR-017 D5/D9).
  SystemOpsPolicyManage: "system.ops.policy.manage",
  // SystemEmailTest (system.email.test): P7-E2A (ADR-017 D7) — the
  // side-effecting email test action split out of the diagnostics VIEW
  // capability. VIEW CAPABILITY MUST NOT AUTHORIZE SIDE EFFECT; POST /email/test
  // is gated by this permission, never by SystemDiagnosticsView. Granted to the
  // Admin preset only; the Maintainer preset does NOT receive it by default.
  SystemEmailTest: "system.email.test",
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

  // §4.10 Incident Management (ADR-014)
  IncidentView: "incident.view",
  IncidentCreate: "incident.create",
  IncidentInvestigate: "incident.investigate",
  IncidentResolve: "incident.resolve",
  // Admin-only Recovery Center read (J5-R0): organization-wide recovery queue
  // and aggregate incident detail. NOT granted to Proctor (Proctor uses
  // IncidentView via assignment_scoped on the core incident routes).
  IncidentRecoveryView: "incident.recovery.view",

  // §4.11 Proctor-to-Exam assignments (ADR-015)
  ExamProctorAssignmentView: "exam.proctor_assignment.view",
  ExamProctorAssignmentManage: "exam.proctor_assignment.manage",

  // §4.12 Teacher-to-Course assignments (issue #286) — Admin-only scope
  // management. The carrier grants zero capabilities by itself.
  CourseTeacherAssignmentView: "course.teacher_assignment.view",
  CourseTeacherAssignmentManage: "course.teacher_assignment.manage",

  // §4.13 Grader-to-Exam assignments (issue #296) — Admin-only scope
  // management. The carrier grants zero capabilities by itself.
  ExamGraderAssignmentView: "exam.grader_assignment.view",
  ExamGraderAssignmentManage: "exam.grader_assignment.manage",
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
 * The seven Phase 3+ role presets. System is non-login, non-assignable; the
 * others are product defaults assigned via the existing user-management
 * surface. Custom roles (Phase 4) are `is_system = false` DB rows, not new keys
 * here.
 *
 * P7-E2A (ADR-017 D2 amendment of ADR-010): Maintainer is the seventh
 * built-in assignable human role — the Application Maintainer / System
 * Operations Owner preset. It holds ONLY operational observation
 * capabilities and zero business permissions.
 */
export const Role = {
  Admin: "Admin",
  Teacher: "Teacher",
  Proctor: "Proctor",
  Grader: "Grader",
  Candidate: "Candidate",
  Maintainer: "Maintainer",
  System: "System",
} as const;

export type RoleKey = (typeof Role)[keyof typeof Role];

// Audit actions are owned by auditActions.ts (AUDIT-M1: full legacy union and
// API audit-boundary validation). See that module for the closed set; the
// barrel re-exports `AuditAction` / `AuditActionKey` for convenience.
