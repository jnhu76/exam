import { describe, it, expect } from "vitest";
import { permissionsForRole, ROLE_PRESETS } from "./presets.js";
import { Permission, Role, Scope, type PermissionKey } from "./catalog.js";

const adminPerms = () => new Set<PermissionKey>(permissionsForRole(Role.Admin));

describe("RBAC-M6 — Admin is the migration compatibility superset", () => {
  it("Admin holds every permission any current Admin-gated route requires", () => {
    // The migration trap (ADR Current Problem #3): if a route's permission is
    // not granted to Admin, flipping requireRole(["Admin"]) -> requireCapability
    // would DENY Admin. These are the ADR §9 "all current Admin routes remain
    // accessible to Admin" permissions — every Admin-gated route's permission
    // must be in the Admin preset.
    const adminRoutesetPerms: PermissionKey[] = [
      // user/org management
      Permission.UserView,
      Permission.UserCreate,
      Permission.UserUpdate,
      Permission.UserDelete,
      Permission.UserPasswordReset,
      Permission.OrganizationView,
      Permission.OrganizationUpdate,
      Permission.SettingsView,
      Permission.SettingsUpdate,
      Permission.AuditLogView,
      // candidate management
      Permission.CandidateView,
      Permission.CandidateCreate,
      Permission.CandidateUpdate,
      Permission.CandidateImport,
      Permission.CandidateFieldView,
      Permission.CandidateFieldCreate,
      Permission.CandidateFieldUpdate,
      Permission.CandidateFieldDelete,
      // course/question
      Permission.CourseView,
      Permission.CourseCreate,
      Permission.CourseUpdate,
      Permission.CourseDelete,
      Permission.QuestionView,
      Permission.QuestionCreate,
      Permission.QuestionUpdate,
      Permission.QuestionDelete,
      Permission.QuestionImport,
      // exam lifecycle (incl. the formerly-missing proctor perms)
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
      // proctor runtime (compat — the 4 trap perms now granted to Admin)
      Permission.ExamRoomView,
      Permission.AttemptStatusView,
      Permission.AttemptTimelineView,
      Permission.AttemptMisconductMark,
      // REC-I4-I3B2: the /extend-time route was cut and replaced by the
      // Admin-only /time-grants route gated on AttemptTimeGrant.
      Permission.AttemptTimeGrant,
      Permission.AttemptForceSubmit,
      Permission.AttemptExport,
      // grading (compat)
      Permission.GradingQueueView,
      Permission.GradingDetailView,
      Permission.GradingAnswerView,
      Permission.GradingScoreWrite,
      Permission.GradingFinalize,
      Permission.GradingIdentityView,
      // scores/exports
      Permission.ScoreAllView,
      Permission.ScoreExport,
      // system diagnostics
      Permission.SystemHealthView,
      Permission.SystemDiagnosticsView,
      // incident recovery (J5-R0 Admin-only)
      Permission.IncidentRecoveryView,
    ];
    const admin = adminPerms();
    const missing = adminRoutesetPerms.filter((p) => !admin.has(p));
    expect(missing).toEqual([]);
  });

  it("Admin does NOT hold Candidate own-runtime perms (ADR §9 #6)", () => {
    const admin = adminPerms();
    const forbidden: PermissionKey[] = [
      Permission.ExamTake,
      Permission.AttemptStart,
      Permission.AttemptAnswerSave,
      Permission.AttemptSubmit,
      Permission.AttemptRestore,
      Permission.AttemptHeartbeatSend,
      Permission.ScoreOwnView,
    ];
    const leaked = forbidden.filter((p) => admin.has(p));
    expect(leaked).toEqual([]);
  });

  it("Admin does NOT hold System-only perms (ADR §9 #7)", () => {
    const admin = adminPerms();
    expect(admin.has(Permission.SystemAutoSubmit)).toBe(false);
    expect(admin.has(Permission.SystemHeartbeatScan)).toBe(false);
    expect(admin.has(Permission.SystemLifecycleReconcile)).toBe(false);
  });

  it("Admin default scope is organization (single-tenant boundary)", () => {
    expect(ROLE_PRESETS[Role.Admin].defaultScope).toBe(Scope.Organization);
  });
});

describe("RBAC-M6 — last-admin guard contract (ADR §3.2)", () => {
  it("Admin is assignable + login-capable (so it can satisfy the guard)", () => {
    expect(ROLE_PRESETS[Role.Admin].assignable).toBe(true);
    expect(ROLE_PRESETS[Role.Admin].loginAllowed).toBe(true);
  });

  it("System does NOT count toward the last-admin guard (non-human, non-login)", () => {
    // ADR §3.2 #4: System actor does not count toward the last-admin guard.
    expect(ROLE_PRESETS[Role.System].loginAllowed).toBe(false);
    expect(ROLE_PRESETS[Role.System].assignable).toBe(false);
  });
});
