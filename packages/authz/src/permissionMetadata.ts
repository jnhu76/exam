/**
 * Permission display metadata.
 *
 * The {@link Permission} catalog owns SECURITY semantics (the closed union of
 * every capability). This module owns the SEMANTIC PRESENTATION grouping — the
 * domain category a permission belongs to, mirroring the ADR §4.1–§4.13
 * catalog grouping.
 *
 * Authority split (authority freeze):
 *   - permission key + category semantics → @exam/authz (this module);
 *   - human-readable label/description TEXT → web i18n (keyed by the
 *     permission key itself; a missing translation falls back to the raw key).
 *
 * No DB table, no second role→permission mapping, no frontend registry.
 * `PERMISSION_METADATA` is an exhaustive projection of the catalog: the
 * compile-time `satisfies Record<PermissionKey, …>` rejects a permission with
 * missing metadata, and the unit test asserts the two key sets are identical
 * in both directions so an orphaned entry fails loudly too.
 */
import { Permission, type PermissionKey } from "./catalog.js";

export const PermissionCategory = {
  /** §4.1 User / organization / settings / audit visibility. */
  User: "user",
  /** §4.2 Candidate records + candidate fields. */
  Candidate: "candidate",
  /** §4.3 Course resources. */
  Course: "course",
  /** §4.3 Question resources. */
  Question: "question",
  /** §4.4 Exam lifecycle. */
  Exam: "exam",
  /** §4.5 Candidate exam runtime (own-scope). */
  AttemptRuntime: "attempt_runtime",
  /** §4.6 Proctor exam-room runtime. */
  Proctor: "proctor",
  /** §4.7 Grading. */
  Grading: "grading",
  /** §4.8 Scores / results. */
  Score: "score",
  /** §4.9 System / diagnostics / operations. */
  System: "system",
  /** §4.10 Incident management. */
  Incident: "incident",
  /** §4.11–4.13 Assignment-management carriers. */
  Assignment: "assignment",
} as const;

export type PermissionCategoryKey =
  (typeof PermissionCategory)[keyof typeof PermissionCategory];

export interface PermissionMetadata {
  /** Semantic domain category (mirrors the ADR §4.x grouping). */
  category: PermissionCategoryKey;
}

/**
 * Exhaustive permission → metadata projection. One entry per catalog key;
 * adding a permission without adding its metadata here is a compile error.
 */
export const PERMISSION_METADATA = {
  // §4.1 User / Organization
  [Permission.UserView]: { category: PermissionCategory.User },
  [Permission.UserCreate]: { category: PermissionCategory.User },
  [Permission.UserUpdate]: { category: PermissionCategory.User },
  [Permission.UserDelete]: { category: PermissionCategory.User },
  [Permission.UserRoleAssign]: { category: PermissionCategory.User },
  [Permission.UserPasswordReset]: { category: PermissionCategory.User },
  [Permission.OrganizationView]: { category: PermissionCategory.User },
  [Permission.OrganizationUpdate]: { category: PermissionCategory.User },
  [Permission.SettingsView]: { category: PermissionCategory.User },
  [Permission.SettingsUpdate]: { category: PermissionCategory.User },
  [Permission.AuditLogView]: { category: PermissionCategory.User },

  // §4.2 Candidate Management
  [Permission.CandidateView]: { category: PermissionCategory.Candidate },
  [Permission.CandidateCreate]: { category: PermissionCategory.Candidate },
  [Permission.CandidateUpdate]: { category: PermissionCategory.Candidate },
  [Permission.CandidateImport]: { category: PermissionCategory.Candidate },
  [Permission.CandidateDelete]: { category: PermissionCategory.Candidate },
  [Permission.CandidateFieldView]: { category: PermissionCategory.Candidate },
  [Permission.CandidateFieldCreate]: { category: PermissionCategory.Candidate },
  [Permission.CandidateFieldUpdate]: { category: PermissionCategory.Candidate },
  [Permission.CandidateFieldDelete]: { category: PermissionCategory.Candidate },

  // §4.3 Course / Question
  [Permission.CourseView]: { category: PermissionCategory.Course },
  [Permission.CourseCreate]: { category: PermissionCategory.Course },
  [Permission.CourseUpdate]: { category: PermissionCategory.Course },
  [Permission.CourseDelete]: { category: PermissionCategory.Course },
  [Permission.QuestionView]: { category: PermissionCategory.Question },
  [Permission.QuestionCreate]: { category: PermissionCategory.Question },
  [Permission.QuestionUpdate]: { category: PermissionCategory.Question },
  [Permission.QuestionDelete]: { category: PermissionCategory.Question },
  [Permission.QuestionImport]: { category: PermissionCategory.Question },

  // §4.4 Exam Lifecycle
  [Permission.ExamView]: { category: PermissionCategory.Exam },
  [Permission.ExamCreate]: { category: PermissionCategory.Exam },
  [Permission.ExamUpdate]: { category: PermissionCategory.Exam },
  [Permission.ExamPublish]: { category: PermissionCategory.Exam },
  [Permission.ExamUnpublish]: { category: PermissionCategory.Exam },
  [Permission.ExamClose]: { category: PermissionCategory.Exam },
  [Permission.ExamCancel]: { category: PermissionCategory.Exam },
  [Permission.ExamArchive]: { category: PermissionCategory.Exam },
  [Permission.ExamDelete]: { category: PermissionCategory.Exam },
  [Permission.ExamExtend]: { category: PermissionCategory.Exam },
  [Permission.ExamResultPublish]: { category: PermissionCategory.Exam },
  [Permission.ExamEnrollmentManage]: { category: PermissionCategory.Exam },

  // §4.5 Candidate Runtime
  [Permission.ExamTake]: { category: PermissionCategory.AttemptRuntime },
  [Permission.AttemptViewOwn]: { category: PermissionCategory.AttemptRuntime },
  [Permission.AttemptStart]: { category: PermissionCategory.AttemptRuntime },
  [Permission.AttemptAnswerSave]: {
    category: PermissionCategory.AttemptRuntime,
  },
  [Permission.AttemptSubmit]: { category: PermissionCategory.AttemptRuntime },
  [Permission.AttemptRestore]: { category: PermissionCategory.AttemptRuntime },
  [Permission.AttemptHeartbeatSend]: {
    category: PermissionCategory.AttemptRuntime,
  },
  [Permission.ScoreOwnView]: { category: PermissionCategory.AttemptRuntime },

  // §4.6 Proctor Runtime
  [Permission.ExamRoomView]: { category: PermissionCategory.Proctor },
  [Permission.AttemptStatusView]: { category: PermissionCategory.Proctor },
  [Permission.AttemptTimelineView]: { category: PermissionCategory.Proctor },
  [Permission.AttemptMisconductMark]: { category: PermissionCategory.Proctor },
  [Permission.AttemptTimeExtend]: { category: PermissionCategory.Proctor },
  [Permission.AttemptTimeGrant]: { category: PermissionCategory.Proctor },
  [Permission.AttemptForceSubmit]: { category: PermissionCategory.Proctor },
  [Permission.AttemptExport]: { category: PermissionCategory.Proctor },

  // §4.7 Grading
  [Permission.GradingQueueView]: { category: PermissionCategory.Grading },
  [Permission.GradingDetailView]: { category: PermissionCategory.Grading },
  [Permission.GradingAnswerView]: { category: PermissionCategory.Grading },
  [Permission.GradingScoreWrite]: { category: PermissionCategory.Grading },
  [Permission.GradingFinalize]: { category: PermissionCategory.Grading },
  [Permission.GradingIdentityView]: { category: PermissionCategory.Grading },

  // §4.8 Scores / Results
  [Permission.ScoreAllView]: { category: PermissionCategory.Score },
  [Permission.ScoreExport]: { category: PermissionCategory.Score },

  // §4.9 System / Diagnostics
  [Permission.SystemHealthView]: { category: PermissionCategory.System },
  [Permission.SystemDiagnosticsView]: { category: PermissionCategory.System },
  [Permission.SystemBusinessIntegrityView]: {
    category: PermissionCategory.System,
  },
  [Permission.SystemBusinessSummaryView]: {
    category: PermissionCategory.System,
  },
  [Permission.SystemBackupView]: { category: PermissionCategory.System },
  [Permission.SystemRestoreReadinessView]: {
    category: PermissionCategory.System,
  },
  [Permission.SystemOpsPolicyView]: { category: PermissionCategory.System },
  [Permission.SystemOpsPolicyManage]: { category: PermissionCategory.System },
  [Permission.SystemEmailTest]: { category: PermissionCategory.System },
  [Permission.SystemInfoView]: { category: PermissionCategory.System },
  [Permission.SystemAutoSubmit]: { category: PermissionCategory.System },
  [Permission.SystemHeartbeatScan]: { category: PermissionCategory.System },
  [Permission.SystemLifecycleReconcile]: {
    category: PermissionCategory.System,
  },

  // §4.10 Incident Management
  [Permission.IncidentView]: { category: PermissionCategory.Incident },
  [Permission.IncidentCreate]: { category: PermissionCategory.Incident },
  [Permission.IncidentInvestigate]: { category: PermissionCategory.Incident },
  [Permission.IncidentResolve]: { category: PermissionCategory.Incident },
  [Permission.IncidentRecoveryView]: { category: PermissionCategory.Incident },

  // §4.11–4.13 Assignment management carriers
  [Permission.ExamProctorAssignmentView]: {
    category: PermissionCategory.Assignment,
  },
  [Permission.ExamProctorAssignmentManage]: {
    category: PermissionCategory.Assignment,
  },
  [Permission.CourseTeacherAssignmentView]: {
    category: PermissionCategory.Assignment,
  },
  [Permission.CourseTeacherAssignmentManage]: {
    category: PermissionCategory.Assignment,
  },
  [Permission.ExamGraderAssignmentView]: {
    category: PermissionCategory.Assignment,
  },
  [Permission.ExamGraderAssignmentManage]: {
    category: PermissionCategory.Assignment,
  },
} as const satisfies Record<PermissionKey, PermissionMetadata>;

/**
 * Returns the metadata for a permission key. Throws when the catalog entry has
 * no metadata — the projection is exhaustive, so a missing entry is a
 * programmer error that must fail loud at startup/tests, not render a blank UI.
 */
export function permissionMetadata(key: PermissionKey): PermissionMetadata {
  const meta = PERMISSION_METADATA[key];
  if (!meta) {
    throw new Error(`Missing permission metadata for ${key}`);
  }
  return meta;
}
