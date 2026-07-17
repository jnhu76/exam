/**
 * Frontend UX capability helper (P4-4).
 *
 * Derives navigation/action visibility from the CANONICAL @exam/authz role
 * presets so the UI shows only the entries a role is actually authorized for.
 * This is the option-B path from the P4 task: the backend does not yet return
 * effective capabilities on /api/auth/me (MeResponse carries only `role`), so
 * the frontend derives UX visibility from the same preset matrix the backend
 * enforces. There is exactly ONE place that maps role -> visible UX surface;
 * scattered `role === "..."` checks are explicitly forbidden (task 10.2 C).
 *
 * ⚠️ THIS IS NOT A SECURITY CONTROL. It hides/disables UI to reduce confusion.
 * The backend remains the authority: every gated route enforces
 * requireCapability/requireRole + ownership/organization predicates. A hidden
 * nav entry is still reachable by direct URL; the backend will 403/404 it.
 * (P4-3 candidate-ownership + P4-2 capability tests are the security proof.)
 */
import {
  Permission,
  permissionsForRole,
  type PermissionKey,
  type RoleKey,
} from "@exam/authz";
import type { MeResponse } from "@exam/contracts";
import { routes } from "@/lib/routes";

// Memoized preset sets (presets are static; safe for module lifetime).
const PRESET_SETS = new Map<string, ReadonlySet<string>>();
function presetFor(role: string): ReadonlySet<string> {
  let set = PRESET_SETS.get(role);
  if (!set) {
    set = new Set<string>(
      permissionsForRole(role as RoleKey).map((p) => String(p)),
    );
    PRESET_SETS.set(role, set);
  }
  return set;
}

/**
 * Returns true if the user's role preset grants the permission. UX-only.
 * Backend remains authoritative.
 */
export function can(user: Pick<MeResponse, "role">, permission: PermissionKey) {
  return presetFor(user.role).has(permission);
}

// ── Coarse UX role classes (derived from the preset, not hardcoded role lists) ──
// These keep nav logic readable while still flowing through the preset. A
// future backend-provided capability set replaces `can()` without touching
// call sites.

/** Admin = the compatibility superset (sees everything). UX shortcut. */
export function isAdmin(user: Pick<MeResponse, "role">): boolean {
  return user.role === "Admin";
}

/** The runtime role groups the shell routes around (admin console vs exam). */
export function isCandidate(user: Pick<MeResponse, "role">): boolean {
  return user.role === "Candidate";
}

/**
 * Roles that may use the Admin console at all (vs being routed to the exam
 * runtime). Candidate is excluded; everyone with at least one non-candidate,
 * non-system preset enters the console.
 */
export function canAccessAdminConsole(user: Pick<MeResponse, "role">): boolean {
  // System is non-login and never appears in MeResponse.role. Candidate is
  // routed to the exam runtime; every other role (Admin/Teacher/Proctor/Grader)
  // holds at least one non-candidate capability -> console access.
  return !isCandidate(user);
}

// ── Per-surface visibility (the single source the sidebar/layout consult) ──

/**
 * Management surface permission set.
 *
 * No single permission is documented as "the management gate" (ADR §158 names
 * "all organization-scope management perms" as a group; AppSidebar's
 * managementItems span users/candidates/importLogs/auditLogs/settings/
 * candidateFields/system). Visibility is therefore derived from whether the
 * principal holds ANY management-surface capability — an aggregate, not a
 * surrogate permission and not a role-label check.
 *
 * NOTE: CandidateView is intentionally excluded. Teacher also holds CandidateView
 * (scoped to course assignment per the preset comment), but the management
 * section is the Admin-only surface (users/audit/settings/system/candidateFields).
 * CandidateView is shared, so including it would over-grant the management nav
 * to Teacher. The Admin-only management perms are the five below; CandidateView
 * alone does not gate the management section.
 */
const MANAGEMENT_SURFACE_PERMS: readonly PermissionKey[] = [
  Permission.UserView,
  Permission.AuditLogView,
  Permission.SettingsView,
  Permission.SystemHealthView,
  Permission.CandidateFieldView,
] as const;

/**
 * Management surface (users/candidates/audit/settings/system) — visible when
 * the principal holds any management-surface capability. Derived from the
 * preset (same source `can()` consults), not from a role-label shortcut.
 */
export function canSeeManagement(user: Pick<MeResponse, "role">): boolean {
  return hasManagementCapability(
    new Set(permissionsForRole(user.role as RoleKey)),
  );
}

/**
 * Pure permission-set predicate: true iff the set contains any management-surface
 * capability. Independent of role labels — any role (or custom set) that holds
 * at least one management perm is authorized. This is the canonical gate; the
 * role-preset wrapper above is a convenience for the common case.
 */
export function hasManagementCapability(
  permissions: ReadonlySet<PermissionKey>,
): boolean {
  return MANAGEMENT_SURFACE_PERMS.some((p) => permissions.has(p));
}

export function canSeeDashboard(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.SystemHealthView);
}

export function canSeeCourses(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.CourseView);
}

export function canSeeQuestions(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.QuestionView);
}

export function canImportQuestions(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.QuestionImport);
}

/** Exams nav (list/detail/author) — Admin + Teacher. */
export function canSeeExams(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ExamView);
}

/** Grading queue nav — Admin + Grader (NOT Teacher). */
export function canSeeGradingQueue(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.GradingQueueView);
}

/** Results/scores nav — Admin + Teacher (ScoreAllView) + Grader (no, lacks it). */
export function canSeeResults(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ScoreAllView);
}

/** Proctor monitoring nav — Admin + Proctor. */
export function canSeeProctor(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ExamRoomView);
}

// ── Exam-page action visibility (task 10.4) ──

export function canPublishExam(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ExamPublish);
}
export function canCreateExam(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ExamCreate);
}
export function canUpdateExam(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ExamUpdate);
}
export function canCloseExam(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ExamClose);
}
export function canPublishResults(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ExamResultPublish);
}
export function canManageEnrollments(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ExamEnrollmentManage);
}
// Admin-only destructive exam actions (task 2.5) — Teacher must NOT see these.
export function canUnpublishExam(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ExamUnpublish);
}
export function canCancelExam(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ExamCancel);
}
export function canArchiveExam(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ExamArchive);
}
export function canDeleteExam(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ExamDelete);
}
export function canExtendExam(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.ExamExtend);
}

export function adminLandingPath(
  user: Pick<MeResponse, "role">,
): string | null {
  if (canSeeDashboard(user)) return routes.admin.dashboard;
  if (canSeeExams(user)) return routes.admin.exams;
  if (canSeeGradingQueue(user)) return routes.admin.gradingQueue;
  if (canSeeProctor(user)) return routes.admin.proctorWorkspace;
  return null;
}

export function defaultLandingPath(user: Pick<MeResponse, "role">): string {
  if (isCandidate(user)) return routes.exam.list;
  return adminLandingPath(user) ?? routes.admin.root;
}
