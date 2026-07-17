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

/** Management surface (users/candidates/audit/settings/system) — Admin only. */
export function canSeeManagement(user: Pick<MeResponse, "role">): boolean {
  // Admin is the only preset with UserView/AuditLogView/SettingsView/SystemHealthView.
  return isAdmin(user);
}

/** Question bank nav (courses/questions/import) — Admin + Teacher. */
export function canSeeQuestionBank(user: Pick<MeResponse, "role">): boolean {
  return can(user, Permission.QuestionView) || can(user, Permission.CourseView);
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
