/**
 * Phase 3 role preset matrix (RBAC-M2).
 *
 * Mirrors the ADR §Role Presets and §Role → Permission Matrix exactly.
 * These are **default grants** (preset permissions). Scope narrowing per
 * resource is a SEPARATE enforcement layer, NOT applied here:
 *   - Proctor@exam: ENFORCED (exam_proctor_assignments + ProctorAssignmentGate
 *     on scoped proctor routes).
 *   - Teacher@course: ENFORCED (issue #286 — teacher_course_assignments
 *     carrier + teacherAccess gate + SQL-side LIST filtering; see the
 *     Teacher section comment below).
 *   - Grader@exam: SEPARATE deferred scope status (NOT F-04). The grading
 *     queue LIST is org-wide today (`GradingQueueView` flat gate); detail
 *     reads are attempt-scoped by the existing attempt resolver, but there is
 *     no Grader↔Exam assignment scope carrier. Tracked as issue #296.
 *
 * Boundary invariants encoded here (ADR §7 review checklist):
 *  - Admin is a compatibility superset (no Candidate-own, no System-only).
 *  - Teacher does NOT automatically grade / view candidate answers / proctor.
 *  - Proctor cannot grade / view answers / publish results by default.
 *  - Grader can grade but cannot publish results by default.
 *  - Candidate is own-scope only.
 *  - System is non-login, non-assignable, SYS-only perms.
 */
import {
  Permission,
  Role,
  Scope,
  type PermissionKey,
  type RoleKey,
} from "./catalog.js";

export interface RolePreset {
  /** Stable role key (also the DB `roles.key` seed value). */
  key: RoleKey;
  /** Human label (zh-CN UI may override via i18n; this is the canonical fallback). */
  label: string;
  /** One-line purpose from the ADR. */
  purpose: string;
  /** Seeded as an immutable system role (is_system = true). Custom = Phase 4. */
  isSystem: boolean;
  /** Whether a human can be assigned this role via user management. */
  assignable: boolean;
  /** Whether this role may log in. System may not. */
  loginAllowed: boolean;
  /** Default scope the role operates at when no scoped assignment narrows it. */
  defaultScope: ScopeTypeForPreset;
  /** Default permission grants (preset matrix). */
  permissions: readonly PermissionKey[];
  /** Subset of permissions flagged sensitive for audit/scrutiny. */
  sensitivePermissions: readonly PermissionKey[];
}

/** Scope types a preset default may declare. */
type ScopeTypeForPreset = (typeof Scope)[keyof typeof Scope];

// ───────────────────────── Admin (compatibility superset) ─────────────────────────

const ADMIN_PERMISSIONS: readonly PermissionKey[] = [
  // User / Organization
  Permission.UserView,
  Permission.UserCreate,
  Permission.UserUpdate,
  Permission.UserDelete,
  Permission.UserRoleAssign,
  Permission.UserPasswordReset,
  Permission.OrganizationView,
  Permission.OrganizationUpdate,
  Permission.SettingsView,
  Permission.SettingsUpdate,
  Permission.AuditLogView,
  // Candidate management
  Permission.CandidateView,
  Permission.CandidateCreate,
  Permission.CandidateUpdate,
  Permission.CandidateImport,
  Permission.CandidateDelete,
  Permission.CandidateFieldView,
  Permission.CandidateFieldCreate,
  Permission.CandidateFieldUpdate,
  Permission.CandidateFieldDelete,
  // Course / Question
  Permission.CourseView,
  Permission.CourseCreate,
  Permission.CourseUpdate,
  Permission.CourseDelete,
  Permission.QuestionView,
  Permission.QuestionCreate,
  Permission.QuestionUpdate,
  Permission.QuestionDelete,
  Permission.QuestionImport,
  // Exam lifecycle
  Permission.ExamView,
  Permission.ExamCreate,
  Permission.ExamUpdate,
  Permission.ExamPublish,
  Permission.ExamUnpublish,
  Permission.ExamClose,
  Permission.ExamCancel,
  Permission.ExamArchive,
  Permission.ExamDelete,
  Permission.ExamExtend,
  Permission.ExamResultPublish,
  Permission.ExamEnrollmentManage,
  // Proctor runtime — compat superset (the 4 trap perms + monitoring reads)
  Permission.ExamRoomView,
  Permission.AttemptStatusView,
  Permission.AttemptTimelineView,
  Permission.AttemptMisconductMark,
  Permission.AttemptTimeGrant,
  Permission.AttemptForceSubmit,
  Permission.AttemptExport,
  // Grading — compat superset (preserve current Admin grading access)
  Permission.GradingQueueView,
  Permission.GradingDetailView,
  Permission.GradingAnswerView,
  Permission.GradingScoreWrite,
  Permission.GradingFinalize,
  Permission.GradingIdentityView,
  // Scores / Results
  Permission.ScoreAllView,
  Permission.ScoreExport,
  // System / diagnostics (current /system/diagnostics is Admin-gated)
  Permission.SystemHealthView,
  Permission.SystemDiagnosticsView,
  // P7-E2A (ADR-017 D8): the business-integrity diagnostics block is an
  // Admin-only business-domain surface; Maintainer never receives it.
  Permission.SystemBusinessIntegrityView,
  // P7-E2B: backup evidence + restore-readiness drill evidence read views.
  Permission.SystemBackupView,
  Permission.SystemRestoreReadinessView,
  // P7-E2C: the business-owner summary dashboard is Admin-only business
  // observation — never granted to Maintainer.
  Permission.SystemBusinessSummaryView,
  // P7-E3 (ADR-017 D9): Admin is the SOLE operational-policy intent owner.
  Permission.SystemOpsPolicyView,
  Permission.SystemOpsPolicyManage,
  // P7-E2A (ADR-017 D7): email test is a side effect, split out of the
  // diagnostics view capability. Admin keeps it (compatibility preserved);
  // Maintainer does NOT receive it by default.
  Permission.SystemEmailTest,
  // Incident management (ADR-014)
  Permission.IncidentView,
  Permission.IncidentCreate,
  Permission.IncidentInvestigate,
  Permission.IncidentResolve,
  // Admin-only Recovery Center read (J5-R0): NOT granted to Proctor.
  Permission.IncidentRecoveryView,
  // Proctor-to-Exam assignment management (ADR-015 §16) — Admin only; never
  // granted to Proctor/Teacher/Grader/Candidate.
  Permission.ExamProctorAssignmentView,
  Permission.ExamProctorAssignmentManage,
  // Teacher-to-Course assignment management (issue #286 §3B) — Admin only;
  // the scope carrier itself grants zero capabilities.
  Permission.CourseTeacherAssignmentView,
  Permission.CourseTeacherAssignmentManage,
];

// ───────────────────────── Teacher (course/exam manager) ─────────────────────────
//
// F-04 — IMPLEMENTED (issue #286): Teacher@Course scope is enforced at
// runtime. The teacher_course_assignments carrier (0036) persists the
// Teacher↔Course episodes; the course/question/exam routes resolve the scope
// fresh from the DB per request (requireScopedCapability with
// teacherAccess: "course_assignment_scoped") and LIST routes filter in SQL
// BEFORE pagination. Authority = capability × assignment: the markers below
// name the capabilities whose RESOURCE reach is course-scoped for a
// non-Admin actor. Admin keeps its org-wide short-circuit.
//   Marker boundary rule: a marker is applied to every permission whose
//   resource lives under a course (candidate visibility for course enrollment,
//   course, question, exam, enrollment, result, score). Organization-level
//   permissions (OrganizationView) are NOT course resources and stay unmarked.
//   Since #286 the markers are descriptive of the enforced narrowing; the
//   enforcement itself lives in apps/api (scopedCapability teacherAccess +
//   LIST scope filters) and is proven by the teacherCourseScope suite.

const TEACHER_PERMISSIONS: readonly PermissionKey[] = [
  Permission.OrganizationView,
  Permission.CandidateView, // course-scoped for non-Admin (enforced, #286)
  Permission.CourseView, // course-scoped for non-Admin (enforced, #286)
  Permission.CourseCreate, // course-scoped for non-Admin (enforced, #286)
  Permission.CourseUpdate, // course-scoped for non-Admin (enforced, #286)
  Permission.QuestionView, // course-scoped for non-Admin (enforced, #286)
  Permission.QuestionCreate, // course-scoped for non-Admin (enforced, #286)
  Permission.QuestionUpdate, // course-scoped for non-Admin (enforced, #286)
  Permission.QuestionDelete, // course-scoped for non-Admin (enforced, #286)
  Permission.QuestionImport, // course-scoped for non-Admin (enforced, #286)
  Permission.ExamView, // course-scoped for non-Admin (enforced, #286)
  Permission.ExamCreate, // course-scoped for non-Admin (enforced, #286)
  Permission.ExamUpdate, // course-scoped for non-Admin (enforced, #286)
  Permission.ExamPublish, // course-scoped for non-Admin (enforced, #286)
  Permission.ExamClose, // course-scoped for non-Admin (enforced, #286)
  Permission.ExamEnrollmentManage, // course-scoped for non-Admin (enforced, #286)
  Permission.ExamResultPublish, // course-scoped for non-Admin (enforced, #286)
  Permission.ScoreAllView, // course-scoped for non-Admin (enforced, #286)
  // Explicitly NOT granted: GradingAnswerView, GradingScoreWrite, proctor perms.
];

// ───────────────────────── Proctor (exam-room runtime authority) ─────────────────────────

const PROCTOR_PERMISSIONS: readonly PermissionKey[] = [
  Permission.ExamRoomView,
  Permission.AttemptStatusView,
  Permission.AttemptTimelineView,
  // J4-I1D (ADR-015 §13 / ADR-014 §8 target grant): the low-risk incident
  // read/create/investigate set, activated ONLY behind the J4-I1B resolver
  // enforcement. incident.resolve stays Admin-only (terminal judgment).
  Permission.IncidentView,
  Permission.IncidentCreate,
  Permission.IncidentInvestigate,
  // AttemptMisconductMark + AttemptForceSubmit REMOVED in J4-I1B (ADR-015
  // §13): the pre-existing org-wide grants were a current, reachable risk
  // (M11-R0 reality audit G1/G2). The routes stay scoped
  // (`proctorAccess = admin_only`) and the permissions remain valid Admin
  // grants. A future dangerous-permissions policy profile must re-add them
  // with its own activation gate — they are NOT deferred Proctor capabilities.
  // AttemptTimeExtend removed: the old /extend-time route is cut in REC-I4-I3B2.
  // Operator time grant (AttemptTimeGrant) is Admin-only; Proctor has no grant path.
  // Explicitly NOT granted: grading.*, ExamResultPublish, ScoreAllView, ExamPublish.
];

// ───────────────────────── Grader (manual scoring) ─────────────────────────

const GRADER_PERMISSIONS: readonly PermissionKey[] = [
  Permission.GradingQueueView,
  Permission.GradingDetailView,
  Permission.GradingAnswerView,
  Permission.GradingScoreWrite,
  // GradingFinalize — ⚠️ scoped (not all graders finalize); omitted by default.
  // GradingIdentityView — ⚠️ scoped (double-blind denies); omitted by default.
  // Explicitly NOT granted: ExamResultPublish.
];

// ───────────────────────── Maintainer (system operations owner) ─────────────────────────

/**
 * Application Maintainer preset (P7-E2A — ADR-017 D2/D3 Plane B, amends
 * ADR-010 role preset set).
 *
 * HARD CONSTRAINT: ONLY operational observation capabilities, zero business
 * permissions. No `user.*`, `candidate.*`, `course.*`, `question.*`, `exam.*`,
 * `grading.*`, `score.*`, no incident business mutation, no force-submit /
 * time-grant / misconduct, no result publish, no email test side effect, no
 * permanently-forbidden execution capability (ADR-017 D4).
 *
 * `system.backup.view` / `system.restore_readiness.view` /
 * `system.ops.policy.view` are added when their E2B/E3 read surfaces ship.
 */
const MAINTAINER_PERMISSIONS: readonly PermissionKey[] = [
  Permission.SystemHealthView,
  Permission.SystemDiagnosticsView,
  // P7-E2B: backup evidence + restore-readiness drill evidence read views.
  Permission.SystemBackupView,
  Permission.SystemRestoreReadinessView,
  // P7-E3: Maintainer MAY view the Admin's policy intent — never modify it.
  Permission.SystemOpsPolicyView,
];

// ───────────────────────── Candidate (own-scope runtime) ─────────────────────────

const CANDIDATE_PERMISSIONS: readonly PermissionKey[] = [
  Permission.ExamTake,
  Permission.AttemptViewOwn,
  Permission.AttemptStart,
  Permission.AttemptAnswerSave,
  Permission.AttemptSubmit,
  Permission.AttemptRestore,
  Permission.AttemptHeartbeatSend,
  Permission.ScoreOwnView,
];

// ───────────────────────── System actor (non-login, non-assignable) ─────────────────────────

const SYSTEM_PERMISSIONS: readonly PermissionKey[] = [
  Permission.SystemAutoSubmit,
  Permission.SystemHeartbeatScan,
  Permission.SystemLifecycleReconcile,
];

// ───────────────────────── Preset registry ─────────────────────────

export const ROLE_PRESETS: Record<RoleKey, RolePreset> = {
  [Role.Admin]: {
    key: Role.Admin,
    label: "Admin",
    purpose:
      "Platform-wide configuration & migration-compatibility superset (organization scope).",
    isSystem: true,
    assignable: true,
    loginAllowed: true,
    defaultScope: Scope.Organization,
    permissions: ADMIN_PERMISSIONS,
    sensitivePermissions: [
      Permission.UserRoleAssign,
      Permission.AttemptForceSubmit,
      Permission.AttemptTimeGrant,
      Permission.AttemptMisconductMark,
      Permission.IncidentResolve,
      Permission.GradingAnswerView,
      Permission.GradingScoreWrite,
      Permission.ScoreExport,
    ],
  },

  [Role.Teacher]: {
    key: Role.Teacher,
    label: "Teacher",
    purpose: "Course/exam authoring & lifecycle manager (course scope).",
    isSystem: true,
    assignable: true,
    loginAllowed: true,
    defaultScope: Scope.Course,
    permissions: TEACHER_PERMISSIONS,
    sensitivePermissions: [
      Permission.ExamPublish,
      Permission.ExamClose,
      Permission.ExamResultPublish,
      Permission.ScoreAllView,
    ],
  },

  [Role.Proctor]: {
    key: Role.Proctor,
    label: "Proctor",
    purpose: "Exam-room runtime authority during a live exam (exam scope).",
    isSystem: true,
    assignable: true,
    loginAllowed: true,
    defaultScope: Scope.Exam,
    permissions: PROCTOR_PERMISSIONS,
    // AttemptForceSubmit + AttemptMisconductMark removed from the Proctor
    // preset in J4-I1B (ADR-015 §13) — the sensitive projection derives from
    // the preset and must not re-introduce them.
    sensitivePermissions: [],
  },

  [Role.Grader]: {
    key: Role.Grader,
    label: "Grader",
    purpose: "Manual scoring of subjective questions (exam/attempt scope).",
    isSystem: true,
    assignable: true,
    loginAllowed: true,
    defaultScope: Scope.Exam,
    permissions: GRADER_PERMISSIONS,
    sensitivePermissions: [
      Permission.GradingDetailView,
      Permission.GradingAnswerView,
      Permission.GradingScoreWrite,
    ],
  },

  [Role.Candidate]: {
    key: Role.Candidate,
    label: "Candidate",
    purpose: "The examinee identity; takes assigned exams (own scope).",
    isSystem: true,
    assignable: true,
    loginAllowed: true,
    defaultScope: Scope.OwnAttempt,
    permissions: CANDIDATE_PERMISSIONS,
    sensitivePermissions: [], // all own-scope, low blast radius
  },

  [Role.Maintainer]: {
    key: Role.Maintainer,
    label: "Maintainer",
    purpose:
      "Application-side system operations owner — operational observation only (system scope).",
    isSystem: true,
    assignable: true,
    loginAllowed: true,
    defaultScope: Scope.System,
    permissions: MAINTAINER_PERMISSIONS,
    // Read-only observation; no side effects, no business mutation.
    sensitivePermissions: [],
  },

  [Role.System]: {
    key: Role.System,
    label: "System",
    purpose:
      "Non-human background work (deadline auto-submit, heartbeat scan, reconcile).",
    isSystem: true,
    assignable: false, // bound to synthetic actor identities at code level
    loginAllowed: false,
    defaultScope: Scope.System,
    permissions: SYSTEM_PERMISSIONS,
    sensitivePermissions: [...SYSTEM_PERMISSIONS], // all sensitive (no human in loop)
  },
};

/** Returns the default permission grants for a role preset. */
export function permissionsForRole(role: RoleKey): readonly PermissionKey[] {
  return ROLE_PRESETS[role]?.permissions ?? [];
}
