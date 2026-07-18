/**
 * Route permission registry (RBAC-M4).
 *
 * Declarative `route → permission → scope → audit` mapping for every route
 * currently gated by `requireRole(["Admin"|"Candidate"])` in `apps/api/src/routes`.
 * Source of truth: ADR §Route → Permission → Scope → Audit Registry and the
 * live `rg requireRole` inventory (re-verified for this job).
 *
 * **This job does NOT enforce anything.** The registry is metadata + a coverage
 * test. RBAC-M5 (shadow) and RBAC-M10 / PROCTOR-M1 / GRADING-M1 (enforcement)
 * consume it later. Paths use the per-route definition path (not the runtime
 * plugin prefix) — that is the canonical source Fastify registers against.
 *
 * ADR §3.3 List-Route Filter Registry extension is reserved via
 * `SingleResourceSpec | ListResourceSpec`; RBAC-M4 only declares the shape,
 * not the filter implementations (GRADING-M1 is the first consumer).
 */
import {
  Permission,
  Scope,
  type PermissionKey,
  type ScopeType,
  type AuditActionKey,
  type ResolverKey,
  type ResourceType,
} from "@exam/authz";

/** Where a resource id is sourced from on the request. */
export type IdSource = "params" | "body" | "query" | "ctx" | "none";

/** Single-resource spec: one concrete resource id per request. */
export interface SingleResourceSpec {
  type: "single";
  resourceType: ResourceType;
  idSource: IdSource;
  idKey?: string;
}

/** List-resource spec (ADR §3.3): a list route that must filter to scope. */
export interface ListResourceSpec {
  type: "list";
  listOf: ResourceType;
  /** Reserved for GRADING-M1 etc.; RBAC-M4 does not implement filters. */
  filterSpec?: string;
}

export type ResourceSpec = SingleResourceSpec | ListResourceSpec;

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE" | "PUT";

export type LegacyGate = "Admin" | "Candidate" | "Admin+Candidate" | "public";

/**
 * Exact runtime authorization strategy for Candidate runtime routes (RBAC-M10-A).
 *
 * Maps 1:1 to the {@link AuthzMetadata} kinds the actual Fastify decorators
 * attach. The registry declares this so a runtime conformance test can compare
 * the onRoute capture against the documented strategy without duplicating the
 * expected values in the test.
 *
 * Three strategies exist:
 *   - `candidate_context`: preset-only gate, no resolver, no resource param.
 *   - `exam_eligibility`: exam+enrollment chain resolution via examId param.
 *   - `own_attempt`: attempt ownership resolution via id/attemptId param.
 */
export type CandidateRuntimeAuthzStrategy =
  | { kind: "candidate_context" }
  | {
      kind: "exam_eligibility";
      resolverKey: "exam_eligibility";
      resourceIdKey: "examId";
    }
  | {
      kind: "own_attempt";
      resolverKey: "own_attempt";
      resourceIdKey: "id" | "attemptId";
    };

export interface RoutePermissionRegistryEntry {
  method: HttpMethod;
  /** Per-route definition path (canonical; plugin prefix applied at runtime). */
  path: string;
  /** The current `requireRole` gate, for migration traceability. */
  currentGate: LegacyGate;
  /** The Phase 3 permission this route will require once enforced. */
  permission: PermissionKey;
  /** The scope the capability check resolves against. */
  scope: ScopeType;
  /** The resolver key that reduces the resource to the scope. */
  resolver: ResolverKey;
  /**
   * Exact runtime authorization strategy for Candidate runtime routes (M10-A).
   * Present only on the 10 candidate routes; absent on Admin routes.
   * The runtime conformance test compares this field against the actual
   * Fastify onRoute metadata to detect strategy drift.
   */
  runtimeAuthz?: CandidateRuntimeAuthzStrategy;
  /** Optional resource spec (id source / list filter). */
  resource?: ResourceSpec;
  /** Audit action to emit when the route is a sensitive read or state change. */
  auditAction?: AuditActionKey;
  /** Whether the route touches a sensitive resource (extra audit/scrutiny). */
  sensitive: boolean;
  /** ADR migration stage that will enforce this entry. */
  migrationStage: number;
}

/** Stable registry key. */
export function registryKeyFor(
  e: Pick<RoutePermissionRegistryEntry, "method" | "path">,
): string {
  return `${e.method} ${e.path}`;
}

// ───────────────────────── Registry (ADR §8) ─────────────────────────

export const ROUTE_PERMISSION_REGISTRY: readonly RoutePermissionRegistryEntry[] =
  [
    // ── auth (mostly public/self) ──
    {
      method: "POST",
      path: "/email/test",
      currentGate: "Admin",
      permission: Permission.SystemDiagnosticsView,
      scope: Scope.System,
      resolver: "system",
      sensitive: false,
      migrationStage: 6,
    },

    // ── Candidate runtime (own-scope) ──
    {
      method: "GET",
      path: "/candidate/exams",
      currentGate: "Candidate",
      permission: Permission.ExamTake,
      scope: Scope.OwnAttempt,
      resolver: "organization",
      runtimeAuthz: { kind: "candidate_context" },
      sensitive: false,
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/candidate/exams/:examId",
      currentGate: "Candidate",
      permission: Permission.ExamTake,
      scope: Scope.OwnAttempt,
      resolver: "exam",
      runtimeAuthz: {
        kind: "exam_eligibility",
        resolverKey: "exam_eligibility",
        resourceIdKey: "examId",
      },
      sensitive: false,
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/attempts/:examId/queue",
      currentGate: "Candidate",
      permission: Permission.AttemptStart,
      scope: Scope.OwnAttempt,
      resolver: "exam",
      runtimeAuthz: {
        kind: "exam_eligibility",
        resolverKey: "exam_eligibility",
        resourceIdKey: "examId",
      },
      sensitive: false,
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/attempts/:examId/start",
      currentGate: "Candidate",
      permission: Permission.AttemptStart,
      scope: Scope.OwnAttempt,
      resolver: "exam",
      runtimeAuthz: {
        kind: "exam_eligibility",
        resolverKey: "exam_eligibility",
        resourceIdKey: "examId",
      },
      auditAction: "attempt.start",
      sensitive: false,
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/attempts/:id",
      currentGate: "Candidate",
      permission: Permission.AttemptViewOwn,
      scope: Scope.OwnAttempt,
      resolver: "attempt",
      runtimeAuthz: {
        kind: "own_attempt",
        resolverKey: "own_attempt",
        resourceIdKey: "id",
      },
      sensitive: false,
      migrationStage: 7,
    },
    {
      // P4-1 §G.2 drift closure: the CandidateTakeSnapshot unified endpoint
      // (P0/L0 authority). Same own_attempt semantic as GET /attempts/:id.
      method: "GET",
      path: "/candidate/attempts/:attemptId/take",
      currentGate: "Candidate",
      permission: Permission.AttemptViewOwn,
      scope: Scope.OwnAttempt,
      resolver: "attempt",
      runtimeAuthz: {
        kind: "own_attempt",
        resolverKey: "own_attempt",
        resourceIdKey: "attemptId",
      },
      sensitive: false,
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/attempts/:attemptId/answers/:questionId",
      currentGate: "Candidate",
      permission: Permission.AttemptAnswerSave,
      scope: Scope.OwnAttempt,
      resolver: "attempt",
      runtimeAuthz: {
        kind: "own_attempt",
        resolverKey: "own_attempt",
        resourceIdKey: "attemptId",
      },
      sensitive: false,
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/attempts/:attemptId/submit",
      currentGate: "Candidate",
      permission: Permission.AttemptSubmit,
      scope: Scope.OwnAttempt,
      resolver: "attempt",
      runtimeAuthz: {
        kind: "own_attempt",
        resolverKey: "own_attempt",
        resourceIdKey: "attemptId",
      },
      auditAction: "attempt.submit",
      sensitive: false,
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/attempts/:attemptId/heartbeat",
      currentGate: "Candidate",
      permission: Permission.AttemptHeartbeatSend,
      scope: Scope.OwnAttempt,
      resolver: "attempt",
      runtimeAuthz: {
        kind: "own_attempt",
        resolverKey: "own_attempt",
        resourceIdKey: "attemptId",
      },
      sensitive: false,
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/attempts/:attemptId/restore",
      currentGate: "Candidate",
      permission: Permission.AttemptRestore,
      scope: Scope.OwnAttempt,
      resolver: "attempt",
      runtimeAuthz: {
        kind: "own_attempt",
        resolverKey: "own_attempt",
        resourceIdKey: "attemptId",
      },
      sensitive: false,
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/scores/attempts/:attemptId",
      currentGate: "Admin+Candidate",
      permission: Permission.ScoreOwnView,
      scope: Scope.OwnScore,
      resolver: "score",
      sensitive: false,
      migrationStage: 7,
    },

    // ── Questions (course scope) ──
    {
      method: "GET",
      path: "/questions",
      currentGate: "Admin",
      permission: Permission.QuestionView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: { type: "list", listOf: "question" },
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/questions/:id",
      currentGate: "Admin",
      permission: Permission.QuestionView,
      scope: Scope.Course,
      resolver: "question",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/questions",
      currentGate: "Admin",
      permission: Permission.QuestionCreate,
      scope: Scope.Course,
      resolver: "question",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/questions/:id",
      currentGate: "Admin",
      permission: Permission.QuestionUpdate,
      scope: Scope.Course,
      resolver: "question",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "DELETE",
      path: "/questions/:id",
      currentGate: "Admin",
      permission: Permission.QuestionDelete,
      scope: Scope.Course,
      resolver: "question",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/questions/import",
      currentGate: "Admin",
      permission: Permission.QuestionImport,
      scope: Scope.Course,
      resolver: "question",
      sensitive: true,
      migrationStage: 6,
    },

    // ── Candidates (organization scope) ──
    {
      method: "GET",
      path: "/candidates",
      currentGate: "Admin",
      permission: Permission.CandidateView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: { type: "list", listOf: "candidate" },
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/candidates",
      currentGate: "Admin",
      permission: Permission.CandidateCreate,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/candidates/:id",
      currentGate: "Admin",
      permission: Permission.CandidateUpdate,
      scope: Scope.Candidate,
      resolver: "candidate",
      auditAction: "candidate.update",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/candidates/import",
      currentGate: "Admin",
      permission: Permission.CandidateImport,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      migrationStage: 6,
    },

    // ── Scores (admin all-scope) ──
    {
      method: "GET",
      path: "/exams/:id/scores",
      currentGate: "Admin",
      permission: Permission.ScoreAllView,
      scope: Scope.Exam,
      resolver: "exam",
      resource: { type: "list", listOf: "score" },
      sensitive: true,
      migrationStage: 7,
    },

    // ── Attempt admin / proctor (sensitive, attempt scope) — ADR §8 special mappings ──
    {
      method: "POST",
      path: "/admin/attempts/:attemptId/misconduct",
      currentGate: "Admin",
      permission: Permission.AttemptMisconductMark,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "attempt.misconductFlagged",
      sensitive: true,
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/attempts/:attemptId/force-submit",
      currentGate: "Admin",
      permission: Permission.AttemptForceSubmit,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "attempt.forceSubmit",
      sensitive: true,
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/attempts/:attemptId/extend-time",
      currentGate: "Admin",
      permission: Permission.AttemptTimeExtend,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "attempt.extendTime",
      sensitive: true,
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/attempts/:attemptId/timeline",
      currentGate: "Admin",
      permission: Permission.AttemptTimelineView,
      scope: Scope.Attempt,
      resolver: "attempt",
      sensitive: true,
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/attempts/:attemptId/export",
      currentGate: "Admin",
      permission: Permission.AttemptExport,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "attempt.exported",
      sensitive: true,
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/attempts/:attemptId/export/csv",
      currentGate: "Admin",
      permission: Permission.AttemptExport,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "attempt.exported",
      sensitive: true,
      migrationStage: 7,
    },

    // ── Proctor monitoring (exam/attempt scope) ──
    {
      method: "GET",
      path: "/admin/proctor/exams",
      currentGate: "Admin",
      permission: Permission.ExamRoomView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: {
        type: "list",
        listOf: "exam",
        filterSpec: "proctor-discoverable-exams",
      },
      sensitive: true,
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/exams/:examId/proctor/attempts",
      currentGate: "Admin",
      permission: Permission.ExamRoomView,
      scope: Scope.Exam,
      resolver: "exam",
      resource: { type: "list", listOf: "attempt" },
      sensitive: true,
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/attempts/:attemptId/proctor-events",
      currentGate: "Admin",
      permission: Permission.AttemptTimelineView,
      scope: Scope.Attempt,
      resolver: "attempt",
      sensitive: true,
      migrationStage: 7,
    },
    {
      // P4-1 §G.3 drift closure: the proctor-incident write is already
      // requireCapability-gated at runtime (proctorMonitoring.ts:164). It marks
      // misconduct on an attempt, so it shares the misconduct semantic.
      method: "POST",
      path: "/admin/attempts/:attemptId/proctor-incident",
      currentGate: "Admin",
      permission: Permission.AttemptMisconductMark,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "attempt.misconductFlagged",
      sensitive: true,
      migrationStage: 7,
    },

    // ── Grading (exam/attempt scope) — ADR §8 special mappings ──
    {
      method: "GET",
      path: "/admin/grading-queue",
      currentGate: "Admin",
      permission: Permission.GradingQueueView,
      scope: Scope.Exam,
      resolver: "exam",
      resource: { type: "list", listOf: "attempt" },
      sensitive: true,
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/attempts/:attemptId/grading-details",
      currentGate: "Admin",
      permission: Permission.GradingDetailView,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "grading.detail_viewed",
      sensitive: true,
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/attempts/:attemptId/grade-question",
      currentGate: "Admin",
      permission: Permission.GradingScoreWrite,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "grading.score_entered",
      sensitive: true,
      migrationStage: 7,
    },

    // ── Users (organization scope) ──
    {
      method: "GET",
      path: "/users",
      currentGate: "Admin",
      permission: Permission.UserView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: { type: "list", listOf: "user" },
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/users",
      currentGate: "Admin",
      permission: Permission.UserCreate,
      scope: Scope.Organization,
      resolver: "organization",
      auditAction: "user.create",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/users/:id",
      currentGate: "Admin",
      permission: Permission.UserUpdate,
      scope: Scope.Organization,
      resolver: "user",
      auditAction: "user.update",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/users/:id/reset-password",
      currentGate: "Admin",
      permission: Permission.UserPasswordReset,
      scope: Scope.Organization,
      resolver: "user",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "DELETE",
      path: "/users/:id",
      currentGate: "Admin",
      permission: Permission.UserDelete,
      scope: Scope.Organization,
      resolver: "user",
      auditAction: "user.delete",
      sensitive: true,
      migrationStage: 6,
    },

    // ── Exports ──
    {
      method: "GET",
      path: "/exams/:id/export/scores",
      currentGate: "Admin",
      permission: Permission.ScoreExport,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "export_scores",
      sensitive: true,
      migrationStage: 7,
    },

    // ── Courses ──
    {
      method: "GET",
      path: "/courses",
      currentGate: "Admin",
      permission: Permission.CourseView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: { type: "list", listOf: "course" },
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/courses/:id",
      currentGate: "Admin",
      permission: Permission.CourseView,
      scope: Scope.Course,
      resolver: "course",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/courses",
      currentGate: "Admin",
      permission: Permission.CourseCreate,
      scope: Scope.Organization,
      resolver: "organization",
      auditAction: "course.create",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/courses/:id",
      currentGate: "Admin",
      permission: Permission.CourseUpdate,
      scope: Scope.Course,
      resolver: "course",
      auditAction: "course.update",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "DELETE",
      path: "/courses/:id",
      currentGate: "Admin",
      permission: Permission.CourseDelete,
      scope: Scope.Course,
      resolver: "course",
      auditAction: "course.delete",
      sensitive: true,
      migrationStage: 6,
    },

    // ── Import logs / audit logs / settings / system ──
    {
      method: "GET",
      path: "/admin/import-logs",
      currentGate: "Admin",
      permission: Permission.AuditLogView,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/admin/settings",
      currentGate: "Admin",
      permission: Permission.SettingsView,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/admin/settings/branding",
      currentGate: "Admin",
      permission: Permission.SettingsView,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/admin/settings/branding",
      currentGate: "Admin",
      permission: Permission.SettingsUpdate,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/admin/audit-logs",
      currentGate: "Admin",
      permission: Permission.AuditLogView,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/system/health",
      currentGate: "Admin",
      permission: Permission.SystemHealthView,
      scope: Scope.System,
      resolver: "system",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/system/dashboard",
      currentGate: "Admin",
      permission: Permission.SystemHealthView,
      scope: Scope.System,
      resolver: "system",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/system/diagnostics",
      currentGate: "Admin",
      permission: Permission.SystemDiagnosticsView,
      scope: Scope.System,
      resolver: "system",
      sensitive: true,
      migrationStage: 6,
    },

    // ── Exam lifecycle ──
    {
      method: "GET",
      path: "/exams",
      currentGate: "Admin",
      permission: Permission.ExamView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: { type: "list", listOf: "exam" },
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/exams/:id",
      currentGate: "Admin",
      permission: Permission.ExamView,
      scope: Scope.Exam,
      resolver: "exam",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams",
      currentGate: "Admin",
      permission: Permission.ExamCreate,
      scope: Scope.Course,
      resolver: "exam",
      auditAction: "exam.create",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/exams/:id",
      currentGate: "Admin",
      permission: Permission.ExamUpdate,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.update",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams/:id/publish",
      currentGate: "Admin",
      permission: Permission.ExamPublish,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.publish",
      sensitive: true,
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/exams/:id/close",
      currentGate: "Admin",
      permission: Permission.ExamClose,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.close",
      sensitive: true,
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/exams/:id/unpublish",
      currentGate: "Admin",
      permission: Permission.ExamUnpublish,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.unpublish",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams/:id/extend",
      currentGate: "Admin",
      permission: Permission.ExamExtend,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.extend",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams/:id/cancel",
      currentGate: "Admin",
      permission: Permission.ExamCancel,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.cancel",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams/:id/archive",
      currentGate: "Admin",
      permission: Permission.ExamArchive,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.archive",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams/:id/publish-results",
      currentGate: "Admin",
      permission: Permission.ExamResultPublish,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.publish_results",
      sensitive: true,
      migrationStage: 7,
    },
    {
      method: "DELETE",
      path: "/exams/:id",
      currentGate: "Admin",
      permission: Permission.ExamDelete,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.delete",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/exams/:examId/enrollments",
      currentGate: "Admin",
      permission: Permission.ExamEnrollmentManage,
      scope: Scope.Exam,
      resolver: "exam",
      resource: { type: "list", listOf: "enrollment" },
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams/:examId/enrollments",
      currentGate: "Admin",
      permission: Permission.ExamEnrollmentManage,
      scope: Scope.Exam,
      resolver: "exam",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "DELETE",
      path: "/exams/:examId/enrollments/:enrollmentId",
      currentGate: "Admin",
      permission: Permission.ExamEnrollmentManage,
      scope: Scope.Exam,
      resolver: "enrollment",
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/admin/exams/:examId/candidates/status",
      currentGate: "Admin",
      permission: Permission.ExamEnrollmentManage,
      scope: Scope.Exam,
      resolver: "exam",
      resource: { type: "list", listOf: "candidate" },
      sensitive: false,
      migrationStage: 6,
    },

    // ── Candidate fields ──
    {
      method: "GET",
      path: "/candidate-fields",
      currentGate: "Admin",
      permission: Permission.CandidateFieldView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: { type: "list", listOf: "candidate" },
      sensitive: false,
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/candidate-fields",
      currentGate: "Admin",
      permission: Permission.CandidateFieldCreate,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/candidate-fields/:id",
      currentGate: "Admin",
      permission: Permission.CandidateFieldUpdate,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      migrationStage: 6,
    },
    {
      method: "DELETE",
      path: "/candidate-fields/:id",
      currentGate: "Admin",
      permission: Permission.CandidateFieldDelete,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      migrationStage: 6,
    },
    {
      // P4-1 §G.1 drift closure: the import-template download is an
      // Admin-gated read of the candidate-field schema (Organization scope).
      method: "GET",
      path: "/candidate-fields/template",
      currentGate: "Admin",
      permission: Permission.CandidateFieldView,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: false,
      migrationStage: 6,
    },
    // ── Role assignments (RBAC-M8) — admin capability surface ──
    {
      method: "GET",
      path: "/roles/assignable",
      currentGate: "Admin",
      permission: Permission.UserRoleAssign,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: false,
      migrationStage: 8,
    },
    {
      method: "GET",
      path: "/users/:id/role-assignments",
      currentGate: "Admin",
      permission: Permission.UserView,
      scope: Scope.Organization,
      resolver: "user",
      sensitive: true,
      migrationStage: 8,
    },
    {
      method: "POST",
      path: "/users/:id/role-assignments",
      currentGate: "Admin",
      permission: Permission.UserRoleAssign,
      scope: Scope.Organization,
      resolver: "user",
      auditAction: "user.role_changed",
      sensitive: true,
      migrationStage: 8,
    },
    {
      method: "PATCH",
      path: "/role-assignments/:assignmentId",
      currentGate: "Admin",
      permission: Permission.UserRoleAssign,
      scope: Scope.Organization,
      resolver: "organization",
      auditAction: "user.role_changed",
      sensitive: true,
      migrationStage: 8,
    },
    {
      method: "DELETE",
      path: "/role-assignments/:assignmentId",
      currentGate: "Admin",
      permission: Permission.UserRoleAssign,
      scope: Scope.Organization,
      resolver: "organization",
      auditAction: "user.role_changed",
      sensitive: true,
      migrationStage: 8,
    },
  ];
