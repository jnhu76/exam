/**
 * Legacy → Phase 3 catalog mapping (RBAC-M1).
 *
 * Bridges the `SCREAMING_SNAKE` permission/role constants in
 * `@exam/domain` enums to the new dotted {@link PermissionKey} / {@link RoleKey}.
 * Used only during the staged migration (ADR §Migration Plan Stage 1); once
 * enforcement flips and `users.role` is deprecated this file can be removed.
 *
 * Mapping rules (ADR §Permission Catalog, Admin Compatibility Policy):
 * - Every legacy permission maps to exactly one new key (1:1).
 * - The 4 proctor-perm trap keys (`VIEW_EXAM_ROOM` etc.) map to the new dotted
 *   proctor perms.
 * - The dead `MANAGE_ORGANIZATION` (granted to no role, used by no route) maps
 *   to `organization.update` (ADR §4.1 supersedes it).
 */
import {
  Permission as LegacyPermission,
  Role as LegacyRole,
} from "@exam/domain";
import {
  Permission,
  Role,
  type PermissionKey,
  type RoleKey,
} from "./catalog.js";

export const LEGACY_PERMISSION_MAP: Record<LegacyPermission, PermissionKey> = {
  // Organization
  MANAGE_ORGANIZATION: Permission.OrganizationUpdate,
  MANAGE_CANDIDATE_FIELDS: Permission.CandidateFieldCreate, // see note below
  // Users
  MANAGE_USERS: Permission.UserCreate,
  // Question Bank → question.*
  CREATE_QUESTION: Permission.QuestionCreate,
  EDIT_QUESTION: Permission.QuestionUpdate,
  DELETE_QUESTION: Permission.QuestionDelete,
  IMPORT_QUESTIONS: Permission.QuestionImport,
  // Course
  MANAGE_COURSES: Permission.CourseCreate,
  // Exam
  CREATE_EXAM: Permission.ExamCreate,
  EDIT_EXAM: Permission.ExamUpdate,
  PUBLISH_EXAM: Permission.ExamPublish,
  ARCHIVE_EXAM: Permission.ExamArchive,
  DELETE_EXAM: Permission.ExamDelete,
  // Proctor (trap keys)
  VIEW_EXAM_ROOM: Permission.ExamRoomView,
  EXTEND_TIME: Permission.AttemptTimeExtend,
  MARK_MISCONDUCT: Permission.AttemptMisconductMark,
  FORCE_SUBMIT: Permission.AttemptForceSubmit,
  // Candidate
  TAKE_EXAM: Permission.ExamTake,
  VIEW_OWN_SCORE: Permission.ScoreOwnView,
  // Scores
  VIEW_ALL_SCORES: Permission.ScoreAllView,
  EXPORT_SCORES: Permission.ScoreExport,
  // System
  VIEW_SYSTEM_HEALTH: Permission.SystemHealthView,
};

/**
 * Note on `MANAGE_CANDIDATE_FIELDS`: the legacy grant was a coarse "manage all
 * candidate fields" capability. It maps to the create action as the closest
 * single new key; the full Phase 3 split (`candidate_field.view/create/update/
 * delete`) is expressed by role presets (RBAC-M2), not by this 1:1 legacy map.
 */

export const LEGACY_ROLE_MAP: Record<LegacyRole, RoleKey> = {
  Admin: Role.Admin,
  Teacher: Role.Teacher,
  Proctor: Role.Proctor,
  Grader: Role.Grader,
  Candidate: Role.Candidate,
  // System is a synthetic actor identity, not a legacy human role; it maps to
  // itself for completeness now that domain.Role includes it (SYSTEM-M1).
  System: Role.System,
};

/** Maps a legacy permission string to its new {@link PermissionKey}. */
export function legacyPermissionToKey(legacy: LegacyPermission): PermissionKey {
  return LEGACY_PERMISSION_MAP[legacy];
}

/** Maps a legacy role string to its new {@link RoleKey}. */
export function legacyRoleToKey(legacy: LegacyRole): RoleKey {
  return LEGACY_ROLE_MAP[legacy];
}
