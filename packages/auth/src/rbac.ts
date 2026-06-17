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
};

/** Returns the list of permissions granted to the given role. */
export function getPermissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
