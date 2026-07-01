import { Permission, type Role } from "@exam/domain";

/** Static mapping of each role to its granted permissions. */
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  Admin: [
    Permission.MANAGE_USERS,
    Permission.MANAGE_CANDIDATE_FIELDS,
    Permission.MANAGE_COURSES,
    Permission.CREATE_QUESTION,
    Permission.EDIT_QUESTION,
    Permission.DELETE_QUESTION,
    Permission.IMPORT_QUESTIONS,
    Permission.CREATE_EXAM,
    Permission.EDIT_EXAM,
    Permission.PUBLISH_EXAM,
    Permission.ARCHIVE_EXAM,
    Permission.DELETE_EXAM,
    Permission.VIEW_ALL_SCORES,
    Permission.EXPORT_SCORES,
    Permission.VIEW_SYSTEM_HEALTH,
  ],
  Candidate: [Permission.TAKE_EXAM, Permission.VIEW_OWN_SCORE],
  // Teacher/Proctor/Grader hold NO legacy flat permissions. Their Phase 3
  // grants (dotted keys) live in @exam/authz presets, not this Phase-1 flat
  // map. The legacy map is kept only for the `ctx.permissions` fallback in
  // auth.ts; capability enforcement (@exam/authz permissionsForRole) is the
  // authoritative source post-RBAC-activation.
  Teacher: [],
  Proctor: [],
  Grader: [],
  // System is a synthetic actor; it holds NO legacy flat permissions. Its
  // system-only perms (system.auto_submit etc.) live in @exam/authz presets,
  // not in this Phase-1 flat map.
  System: [],
};

/** Returns the list of permissions granted to the given role. */
export function getPermissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
