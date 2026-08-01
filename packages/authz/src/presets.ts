/**
 * Phase 3 role preset matrix (RBAC-M2).
 *
 * Mirrors the ADR §Role Presets and §Role → Permission Matrix exactly.
 * These are **default grants** (preset permissions); scoped assignment
 * (Teacher@course, Proctor@exam, Grader@exam) narrows them per resource at
 * assignment time (RBAC-M8), not here.
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
  // Incident management (ADR-014)
  Permission.IncidentView,
  Permission.IncidentCreate,
  Permission.IncidentInvestigate,
  Permission.IncidentResolve,
];

// ───────────────────────── Teacher (course/exam manager) ─────────────────────────

const TEACHER_PERMISSIONS: readonly PermissionKey[] = [
  Permission.OrganizationView,
  Permission.CandidateView, // ⚠️ scoped: default-granted per matrix; narrowed by course assignment
  Permission.CourseView,
  Permission.CourseCreate, // ⚠️ scoped
  Permission.CourseUpdate, // ⚠️ scoped
  Permission.QuestionView,
  Permission.QuestionCreate,
  Permission.QuestionUpdate,
  Permission.QuestionDelete,
  Permission.QuestionImport,
  Permission.ExamView,
  Permission.ExamCreate, // ⚠️ scoped
  Permission.ExamUpdate, // ⚠️ scoped
  Permission.ExamPublish, // ⚠️ scoped
  Permission.ExamClose, // ⚠️ scoped
  Permission.ExamEnrollmentManage, // ⚠️ scoped
  Permission.ExamResultPublish, // ⚠️ scoped
  Permission.ScoreAllView, // ⚠️ scoped
  // Explicitly NOT granted: GradingAnswerView, GradingScoreWrite, proctor perms.
];

// ───────────────────────── Proctor (exam-room runtime authority) ─────────────────────────

const PROCTOR_PERMISSIONS: readonly PermissionKey[] = [
  Permission.ExamRoomView,
  Permission.AttemptStatusView,
  Permission.AttemptTimelineView,
  Permission.AttemptMisconductMark,
  Permission.AttemptForceSubmit,
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
    sensitivePermissions: [
      Permission.AttemptForceSubmit,
      Permission.AttemptMisconductMark,
    ],
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
