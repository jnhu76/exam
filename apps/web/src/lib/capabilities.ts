/**
 * Frontend UX capability helper (P4-4, RBAC-M10-E closure).
 *
 * Capabilities now come from the backend on both /login and /auth/me,
 * resolved fresh from active user_role_assignments (the single source of
 * truth for human actor authorization). Every can* function reads from
 * user.capabilities (the union of every active role assignment's preset),
 * NOT from a role-preset projection that would hide secondary-role
 * capabilities from multi-role actors.
 *
 * ⚠️ THIS IS NOT A SECURITY CONTROL. It hides/disables UI to reduce confusion.
 * The backend remains the authority: every gated route enforces
 * requireCapability/requireRole + ownership/organization predicates. A hidden
 * nav entry is still reachable by direct URL; the backend will 403/404 it.
 */
import { Permission, type PermissionKey } from "@exam/authz";
import type { MeResponse } from "@exam/contracts";
import { routes } from "@/lib/routes";

/**
 * Returns true if the user's capability set grants the permission. UX-only.
 * Backend remains authoritative.
 *
 * Capabilities are the union of every active role assignment's preset,
 * resolved at authenticate time by loadAssignmentAuthority.
 */
export function can(
  user: Pick<MeResponse, "role" | "capabilities">,
  permission: PermissionKey,
) {
  return user.capabilities.includes(permission);
}

// ── Coarse UX role classes (derived from role, NOT capabilities) ──
// These are shell-classification semantics (admin console vs exam runtime),
// not capability gates. They use user.role intentionally.
// isAdmin and isCandidate are used for routing shell layout, not for
// authorization decisions.

/** Admin = the compatibility superset (sees everything). UX shortcut. */
export function isAdmin(user: Pick<MeResponse, "role">): boolean {
  return user.role === "Admin";
}

/** The runtime role groups the shell routes around (admin console vs exam). */
export function isCandidate(user: Pick<MeResponse, "role">): boolean {
  return user.role === "Candidate";
}

/**
 * Returns true if the user has any admin-console capability (is gated into the
 * admin shell). Derived from adminLandingPath: if there is any console surface
 * the user can reach, console access is granted.
 */
export function canAccessAdminConsole(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return adminLandingPath(user) !== null;
}

/**
 * Exam-runtime access: requires ExamTake capability (Candidate's entry perm).
 * Multi-role users with secondary Candidate reach the exam shell.
 */
export function canAccessExamRuntime(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamTake);
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
 * section is the Admin-only surface (users/audit/settings/candidateFields).
 * CandidateView is shared, so including it would over-grant the management nav
 * to Teacher. The Admin-only management perms are the four below; CandidateView
 * alone does not gate the management section.
 *
 * P7-RBAC-REMEDIATION F-08: SystemHealthView was previously included here, but
 * it is an OPERATIONAL capability held by BOTH Admin and Maintainer. Including
 * it over-granted the "管理" nav group to Maintainer (it leaked a lone
 * "系统监控" item into the management section). Operational surfaces belong to
 * the "运维" group (canSeeOperations); the management group is the Admin-only
 * business-management surface. SystemDiagnosticsView was never listed (the
 * stray item entered only because SystemHealthView gated the group AND
 * SystemDiagnosticsView gated the item).
 */
const MANAGEMENT_SURFACE_PERMS: readonly PermissionKey[] = [
  Permission.UserView,
  Permission.AuditLogView,
  Permission.SettingsView,
  Permission.CandidateFieldView,
] as const;

/**
 * Management surface (users/candidates/audit/settings/system) — visible when
 * the principal holds any management-surface capability. Derived from the
 * capability set (same source `can()` consults), not from a role-label shortcut.
 */
export function canSeeManagement(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return hasManagementCapability(user.capabilities as PermissionKey[]);
}

/**
 * Pure permission-set predicate: true iff the set contains any management-surface
 * capability. Independent of role labels — any role (or custom set) that holds
 * at least one management perm is authorized. This is the canonical gate; the
 * capability-set wrapper above is a convenience for the common case.
 */
export function hasManagementCapability(
  permissions: readonly PermissionKey[],
): boolean {
  return MANAGEMENT_SURFACE_PERMS.some((p) => permissions.includes(p));
}

/**
 * Settings page visibility — used when the caller needs to check settings
 * access without importing the full management surface helper (e.g. DateTimeContext).
 */
export function canSeeSettings(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.SettingsView);
}

/**
 * Business-owner summary dashboard — Admin-only business observation
 * (P7-E2C). The Maintainer preset does not hold system.business_summary.view.
 */
export function canSeeDashboard(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.SystemBusinessSummaryView);
}

/**
 * Operations surface (health / diagnostics / backup evidence / restore
 * readiness) — Admin + Maintainer (P7-E2C).
 */
export function canSeeOperations(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.SystemHealthView);
}

/** System Diagnostics page (full diagnostics incl. business-integrity for
 *  Admin; operational projection for Maintainer). */
export function canSeeSystemDiagnostics(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.SystemDiagnosticsView);
}

export function canSeeCourses(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.CourseView);
}

export function canSeeQuestions(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.QuestionView);
}

export function canImportQuestions(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.QuestionImport);
}

/** Exams nav (list/detail/author) — Admin + Teacher. */
export function canSeeExams(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamView);
}

/** Grading queue nav — Admin + Grader (NOT Teacher). */
export function canSeeGradingQueue(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.GradingQueueView);
}

/** Results/scores nav — Admin + Teacher (ScoreAllView) + Grader (no, lacks it). */
export function canSeeResults(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ScoreAllView);
}

/** Proctor monitoring nav — Admin + Proctor. */
export function canSeeProctor(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamRoomView);
}

/** Recovery Center nav — Admin only (`incident.recovery.view` preset). */
export function canSeeRecovery(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.IncidentRecoveryView);
}

// ── Exam-page action visibility (task 10.4) ──

export function canPublishExam(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamPublish);
}
export function canCreateExam(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamCreate);
}
export function canUpdateExam(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamUpdate);
}
export function canCloseExam(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamClose);
}
export function canPublishResults(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamResultPublish);
}
export function canManageEnrollments(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamEnrollmentManage);
}
// Admin-only destructive exam actions (task 2.5) — Teacher must NOT see these.
export function canUnpublishExam(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamUnpublish);
}
export function canCancelExam(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamCancel);
}
export function canArchiveExam(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamArchive);
}
export function canDeleteExam(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamDelete);
}
export function canExtendExam(
  user: Pick<MeResponse, "role" | "capabilities">,
): boolean {
  return can(user, Permission.ExamExtend);
}

export function adminLandingPath(
  user: Pick<MeResponse, "role" | "capabilities">,
): string | null {
  // Most specific role workspaces first, tiered by role specificity.
  // Dashboard (SystemBusinessSummaryView, P7-E2C) is the business owner's
  // landing — check first so Admin lands on the dashboard. Maintainer (no
  // business-summary capability) lands on the Operations surface. Proctor
  // workspace is the most targeted non-Admin surface, followed by grading
  // queue, then exams as a general fallback. CourseView, QuestionView, and
  // management-surface perms extend the set so non-standard presets or
  // multi-role unions still get a console landing.
  if (canSeeDashboard(user)) return routes.admin.dashboard;
  if (canSeeOperations(user)) return routes.admin.operations;
  if (canSeeProctor(user)) return routes.admin.proctorWorkspace;
  if (canSeeGradingQueue(user)) return routes.admin.gradingQueue;
  if (canSeeExams(user)) return routes.admin.exams;
  if (canSeeCourses(user)) return routes.admin.courses;
  if (canSeeQuestions(user)) return routes.admin.questions;
  if (hasManagementCapability(user.capabilities as PermissionKey[]))
    return routes.admin.users;
  return null;
}

export function defaultLandingPath(
  user: Pick<MeResponse, "role" | "capabilities">,
): string {
  // If user has any admin-console capability, resolve which surface they land on.
  const adminPath = adminLandingPath(user);
  if (adminPath) {
    // Primary-Candidate users with console capabilities default to exam runtime
    // (Candidate-primary preference).
    if (isCandidate(user)) return routes.exam.list;
    return adminPath;
  }
  // Pure candidate or secondary-candidate-only user.
  if (canAccessExamRuntime(user)) return routes.exam.list;
  // No capabilities — redirect to login.
  return routes.login;
}
