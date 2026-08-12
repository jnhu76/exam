/**
 * Route permission registry (RBAC-M4).
 *
 * Declarative `route → permission → scope → audit` mapping for every route
 * currently gated by `requireCapability(...)` / resource-aware capability gates
 * (`requireScopedCapability` / `requireScoreCapability` / `requireCandidateContext`
 * / `requireExamEligibility` / `requireOwnAttempt`).
 * Source of truth: ADR §Route → Permission → Scope → Audit Registry.
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
 * Route-specific eligibility denial policy for exam-eligibility routes.
 *
 * - `resource_not_found`: missing profile/enrollment → 404 (anti-enumeration).
 * - `permission_denied`: missing profile/enrollment → 403.
 */
export type EligibilityDenialMode = "resource_not_found" | "permission_denied";

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
      resourceIdKey: "examId";
      eligibilityDenialMode: "resource_not_found" | "permission_denied";
    }
  | {
      kind: "own_attempt";
      resourceIdKey: "id" | "attemptId";
    };

/**
 * Proctor route-access policy (ADR-015 §8, frozen 5-valued).
 *
 * - `assignment_scoped` — resource resolver + scoped capability + active
 *   Proctor-to-Exam assignment required.
 * - `assignment_filtered_collection` — collection; Proctor sees only the
 *   active-assignment-filtered set (backend query, never UI filtering).
 * - `admin_only` — permission NOT in the Proctor preset; Proctor-unreachable.
 * - `deferred` — future policy profile; Proctor-unreachable at runtime.
 * - `not_applicable` — no Proctor-specific rule.
 */
export type ProctorAccessValue =
  | "assignment_scoped"
  | "assignment_filtered_collection"
  | "admin_only"
  | "deferred"
  | "not_applicable";

export interface RoutePermissionRegistryEntry {
  method: HttpMethod;
  /** Per-route definition path (canonical; plugin prefix applied at runtime). */
  path: string;
  /**
   * Pre-migration role gate retained only for migration traceability.
   * It is not the current runtime authorization authority.
   */
  legacyGate: LegacyGate;
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
  /**
   * Single unambiguous audit action emitted by this route. Conditional routes
   * that can emit different actions intentionally omit this advisory field.
   */
  auditAction?: AuditActionKey;
  /** Whether the route touches a sensitive resource (extra audit/scrutiny). */
  sensitive: boolean;
  /**
   * Proctor route-access policy (ADR-015 §8). REQUIRED on every entry — never
   * inferred at runtime from permission membership. The conformance test
   * enumerates EVERY registry entry.
   */
  proctorAccess: ProctorAccessValue;
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
      // P7-E2A (ADR-017 D7): the email test is a SIDE-EFFECTING action; it is
      // gated by its own capability (system.email.test), never by a view
      // capability. Audited under `system.email.test` (best-effort, masked
      // recipient).
      method: "POST",
      path: "/email/test",
      legacyGate: "Admin",
      permission: Permission.SystemEmailTest,
      scope: Scope.System,
      resolver: "system",
      auditAction: "system.email.test",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },

    // ── Candidate runtime (own-scope) ──
    {
      method: "GET",
      path: "/candidate/exams",
      legacyGate: "Candidate",
      permission: Permission.ExamTake,
      scope: Scope.OwnAttempt,
      resolver: "organization",
      runtimeAuthz: { kind: "candidate_context" },
      sensitive: false,
      proctorAccess: "not_applicable",
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/candidate/exams/:examId",
      legacyGate: "Candidate",
      permission: Permission.ExamTake,
      scope: Scope.OwnAttempt,
      resolver: "exam",
      runtimeAuthz: {
        kind: "exam_eligibility",
        resourceIdKey: "examId",
        eligibilityDenialMode: "resource_not_found",
      },
      sensitive: false,
      proctorAccess: "not_applicable",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/attempts/:examId/queue",
      legacyGate: "Candidate",
      permission: Permission.AttemptStart,
      scope: Scope.OwnAttempt,
      resolver: "exam",
      runtimeAuthz: {
        kind: "exam_eligibility",
        resourceIdKey: "examId",
        eligibilityDenialMode: "resource_not_found",
      },
      sensitive: false,
      proctorAccess: "not_applicable",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/attempts/:examId/start",
      legacyGate: "Candidate",
      permission: Permission.AttemptStart,
      scope: Scope.OwnAttempt,
      resolver: "exam",
      runtimeAuthz: {
        kind: "exam_eligibility",
        resourceIdKey: "examId",
        eligibilityDenialMode: "permission_denied",
      },
      sensitive: false,
      proctorAccess: "not_applicable",
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/attempts/:id",
      legacyGate: "Candidate",
      permission: Permission.AttemptViewOwn,
      scope: Scope.OwnAttempt,
      resolver: "attempt",
      runtimeAuthz: {
        kind: "own_attempt",
        resourceIdKey: "id",
      },
      sensitive: false,
      proctorAccess: "not_applicable",
      migrationStage: 7,
    },
    {
      // P4-1 §G.2 drift closure: the CandidateTakeSnapshot unified endpoint
      // (P0/L0 authority). Same own_attempt semantic as GET /attempts/:id.
      method: "GET",
      path: "/candidate/attempts/:attemptId/take",
      legacyGate: "Candidate",
      permission: Permission.AttemptViewOwn,
      scope: Scope.OwnAttempt,
      resolver: "attempt",
      runtimeAuthz: {
        kind: "own_attempt",
        resourceIdKey: "attemptId",
      },
      sensitive: false,
      proctorAccess: "not_applicable",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/attempts/:attemptId/answers/:questionId",
      legacyGate: "Candidate",
      permission: Permission.AttemptAnswerSave,
      scope: Scope.OwnAttempt,
      resolver: "attempt",
      runtimeAuthz: {
        kind: "own_attempt",
        resourceIdKey: "attemptId",
      },
      sensitive: false,
      proctorAccess: "not_applicable",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/attempts/:attemptId/submit",
      legacyGate: "Candidate",
      permission: Permission.AttemptSubmit,
      scope: Scope.OwnAttempt,
      resolver: "attempt",
      runtimeAuthz: {
        kind: "own_attempt",
        resourceIdKey: "attemptId",
      },
      auditAction: "attempt.submit",
      sensitive: false,
      proctorAccess: "not_applicable",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/attempts/:attemptId/heartbeat",
      legacyGate: "Candidate",
      permission: Permission.AttemptHeartbeatSend,
      scope: Scope.OwnAttempt,
      resolver: "attempt",
      runtimeAuthz: {
        kind: "own_attempt",
        resourceIdKey: "attemptId",
      },
      sensitive: false,
      proctorAccess: "not_applicable",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/attempts/:attemptId/restore",
      legacyGate: "Candidate",
      permission: Permission.AttemptRestore,
      scope: Scope.OwnAttempt,
      resolver: "attempt",
      runtimeAuthz: {
        kind: "own_attempt",
        resourceIdKey: "attemptId",
      },
      sensitive: false,
      proctorAccess: "not_applicable",
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/scores/attempts/:attemptId",
      legacyGate: "Admin+Candidate",
      permission: Permission.ScoreOwnView,
      scope: Scope.OwnScore,
      resolver: "score",
      sensitive: false,
      proctorAccess: "not_applicable",
      migrationStage: 7,
    },

    // ── Questions (course scope) ──
    {
      method: "GET",
      path: "/questions",
      legacyGate: "Admin",
      permission: Permission.QuestionView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: { type: "list", listOf: "question" },
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/questions/:id",
      legacyGate: "Admin",
      permission: Permission.QuestionView,
      scope: Scope.Course,
      resolver: "question",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/questions",
      legacyGate: "Admin",
      permission: Permission.QuestionCreate,
      scope: Scope.Course,
      resolver: "question",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/questions/:id",
      legacyGate: "Admin",
      permission: Permission.QuestionUpdate,
      scope: Scope.Course,
      resolver: "question",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "DELETE",
      path: "/questions/:id",
      legacyGate: "Admin",
      permission: Permission.QuestionDelete,
      scope: Scope.Course,
      resolver: "question",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/questions/import",
      legacyGate: "Admin",
      permission: Permission.QuestionImport,
      scope: Scope.Course,
      resolver: "question",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },

    // ── Candidates (organization scope) ──
    {
      method: "GET",
      path: "/candidates",
      legacyGate: "Admin",
      permission: Permission.CandidateView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: { type: "list", listOf: "candidate" },
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/candidates",
      legacyGate: "Admin",
      permission: Permission.CandidateCreate,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/candidates/:id",
      legacyGate: "Admin",
      permission: Permission.CandidateUpdate,
      scope: Scope.Candidate,
      resolver: "candidate",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/candidates/import",
      legacyGate: "Admin",
      permission: Permission.CandidateImport,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },

    // ── Scores (admin all-scope) ──
    {
      method: "GET",
      path: "/exams/:id/scores",
      legacyGate: "Admin",
      permission: Permission.ScoreAllView,
      scope: Scope.Exam,
      resolver: "exam",
      resource: { type: "list", listOf: "score" },
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },

    // ── Attempt admin / proctor (sensitive, attempt scope) — ADR §8 special mappings ──
    {
      method: "POST",
      path: "/admin/attempts/:attemptId/misconduct",
      legacyGate: "Admin",
      permission: Permission.AttemptMisconductMark,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "attempt.misconductFlagged",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/attempts/:attemptId/force-submit",
      legacyGate: "Admin",
      permission: Permission.AttemptForceSubmit,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "attempt.forceSubmit",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/attempts/:attemptId/time-grants",
      legacyGate: "Admin",
      permission: Permission.AttemptTimeGrant,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "attempt.timeGrant",
      sensitive: true,
      proctorAccess: "deferred",
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/attempts/:attemptId/timeline",
      legacyGate: "Admin",
      permission: Permission.AttemptTimelineView,
      scope: Scope.Attempt,
      resolver: "attempt",
      sensitive: true,
      proctorAccess: "assignment_scoped",
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/attempts/:attemptId/export",
      legacyGate: "Admin",
      permission: Permission.AttemptExport,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "attempt.exported",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/attempts/:attemptId/export/csv",
      legacyGate: "Admin",
      permission: Permission.AttemptExport,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "attempt.exported",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },

    // ── Proctor monitoring (exam/attempt scope) ──
    {
      method: "GET",
      path: "/admin/proctor/exams",
      legacyGate: "Admin",
      permission: Permission.ExamRoomView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: {
        type: "list",
        listOf: "exam",
        filterSpec: "proctor-discoverable-exams",
      },
      sensitive: true,
      proctorAccess: "assignment_filtered_collection",
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/exams/:examId/proctor/attempts",
      legacyGate: "Admin",
      permission: Permission.ExamRoomView,
      scope: Scope.Exam,
      resolver: "exam",
      resource: { type: "list", listOf: "attempt" },
      sensitive: true,
      proctorAccess: "assignment_scoped",
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/attempts/:attemptId/proctor-events",
      legacyGate: "Admin",
      permission: Permission.AttemptTimelineView,
      scope: Scope.Attempt,
      resolver: "attempt",
      sensitive: true,
      proctorAccess: "assignment_scoped",
      migrationStage: 7,
    },
    {
      // P4-1 §G.3 drift closure: the proctor-incident write is already
      // requireCapability-gated at runtime and records a distinct canonical
      // incident observation rather than changing attempt misconduct state.
      method: "POST",
      path: "/admin/attempts/:attemptId/proctor-incident",
      legacyGate: "Admin",
      permission: Permission.AttemptMisconductMark,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "proctor.incident_marked",
      sensitive: true,
      // J4-I1B (ADR-015 §16): legacy audit-only marker; the grant is removed
      // from the Proctor preset, so the route is effectively Admin-only.
      proctorAccess: "admin_only",
      migrationStage: 7,
    },

    // ── Grading (exam/attempt scope) — ADR §8 special mappings ──
    {
      method: "GET",
      path: "/admin/grading-queue",
      legacyGate: "Admin",
      permission: Permission.GradingQueueView,
      scope: Scope.Exam,
      resolver: "exam",
      resource: { type: "list", listOf: "attempt" },
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/attempts/:attemptId/grading-details",
      legacyGate: "Admin",
      permission: Permission.GradingDetailView,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "grading.detail_viewed",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/attempts/:attemptId/grade-question",
      legacyGate: "Admin",
      permission: Permission.GradingScoreWrite,
      scope: Scope.Attempt,
      resolver: "attempt",
      auditAction: "grading.score_entered",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },

    // ── Users (organization scope) ──
    {
      method: "GET",
      path: "/users",
      legacyGate: "Admin",
      permission: Permission.UserView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: { type: "list", listOf: "user" },
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/users",
      legacyGate: "Admin",
      permission: Permission.UserCreate,
      scope: Scope.Organization,
      resolver: "organization",
      auditAction: "user.create",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/users/:id",
      legacyGate: "Admin",
      permission: Permission.UserUpdate,
      scope: Scope.Organization,
      resolver: "user",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/users/:id/reset-password",
      legacyGate: "Admin",
      permission: Permission.UserPasswordReset,
      scope: Scope.Organization,
      resolver: "user",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "DELETE",
      path: "/users/:id",
      legacyGate: "Admin",
      permission: Permission.UserDelete,
      scope: Scope.Organization,
      resolver: "user",
      auditAction: "user.delete",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },

    // ── Exports ──
    {
      method: "GET",
      path: "/exams/:id/export/scores",
      legacyGate: "Admin",
      permission: Permission.ScoreExport,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "export_scores",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },

    // ── Courses ──
    {
      method: "GET",
      path: "/courses",
      legacyGate: "Admin",
      permission: Permission.CourseView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: { type: "list", listOf: "course" },
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/courses/:id",
      legacyGate: "Admin",
      permission: Permission.CourseView,
      scope: Scope.Course,
      resolver: "course",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/courses",
      legacyGate: "Admin",
      permission: Permission.CourseCreate,
      scope: Scope.Organization,
      resolver: "organization",
      auditAction: "course.create",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/courses/:id",
      legacyGate: "Admin",
      permission: Permission.CourseUpdate,
      scope: Scope.Course,
      resolver: "course",
      auditAction: "course.update",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "DELETE",
      path: "/courses/:id",
      legacyGate: "Admin",
      permission: Permission.CourseDelete,
      scope: Scope.Course,
      resolver: "course",
      auditAction: "course.delete",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },

    // ── Import logs / audit logs / settings / system ──
    {
      method: "GET",
      path: "/admin/import-logs",
      legacyGate: "Admin",
      permission: Permission.AuditLogView,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/admin/settings",
      legacyGate: "Admin",
      permission: Permission.SettingsView,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/admin/settings/branding",
      legacyGate: "Admin",
      permission: Permission.SettingsView,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/admin/settings/branding",
      legacyGate: "Admin",
      permission: Permission.SettingsUpdate,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/admin/audit-logs",
      legacyGate: "Admin",
      permission: Permission.AuditLogView,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/system/health",
      legacyGate: "Admin",
      permission: Permission.SystemHealthView,
      scope: Scope.System,
      resolver: "system",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/system/dashboard",
      legacyGate: "Admin",
      permission: Permission.SystemHealthView,
      scope: Scope.System,
      resolver: "system",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      // P7-E2A (ADR-017 D8): the diagnostics route gate is the operational
      // SystemDiagnosticsView capability; the business-integrity block inside
      // the response is projected server-side by the actor's
      // system.business_integrity.view capability (Admin-only). The registry
      // records the route gate; the field-level projection is enforced in the
      // handler (routes/system.ts).
      method: "GET",
      path: "/system/diagnostics",
      legacyGate: "Admin",
      permission: Permission.SystemDiagnosticsView,
      scope: Scope.System,
      resolver: "system",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },

    // ── Exam lifecycle ──
    {
      method: "GET",
      path: "/exams",
      legacyGate: "Admin",
      permission: Permission.ExamView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: { type: "list", listOf: "exam" },
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/exams/:id",
      legacyGate: "Admin",
      permission: Permission.ExamView,
      scope: Scope.Exam,
      resolver: "exam",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams",
      legacyGate: "Admin",
      permission: Permission.ExamCreate,
      scope: Scope.Course,
      resolver: "exam",
      auditAction: "exam.create",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/exams/:id",
      legacyGate: "Admin",
      permission: Permission.ExamUpdate,
      scope: Scope.Exam,
      resolver: "exam",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams/:id/publish",
      legacyGate: "Admin",
      permission: Permission.ExamPublish,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.publish",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/exams/:id/close",
      legacyGate: "Admin",
      permission: Permission.ExamClose,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.close",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/exams/:id/unpublish",
      legacyGate: "Admin",
      permission: Permission.ExamUnpublish,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.unpublish",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams/:id/extend",
      legacyGate: "Admin",
      permission: Permission.ExamExtend,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.extend",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams/:id/cancel",
      legacyGate: "Admin",
      permission: Permission.ExamCancel,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.cancel",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams/:id/archive",
      legacyGate: "Admin",
      permission: Permission.ExamArchive,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.archive",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams/:id/publish-results",
      legacyGate: "Admin",
      permission: Permission.ExamResultPublish,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.publish_results",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },
    {
      method: "DELETE",
      path: "/exams/:id",
      legacyGate: "Admin",
      permission: Permission.ExamDelete,
      scope: Scope.Exam,
      resolver: "exam",
      auditAction: "exam.delete",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/exams/:examId/enrollments",
      legacyGate: "Admin",
      permission: Permission.ExamEnrollmentManage,
      scope: Scope.Exam,
      resolver: "exam",
      resource: { type: "list", listOf: "enrollment" },
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/exams/:examId/enrollments",
      legacyGate: "Admin",
      permission: Permission.ExamEnrollmentManage,
      scope: Scope.Exam,
      resolver: "exam",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "DELETE",
      path: "/exams/:examId/enrollments/:enrollmentId",
      legacyGate: "Admin",
      permission: Permission.ExamEnrollmentManage,
      scope: Scope.Exam,
      resolver: "enrollment",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "GET",
      path: "/admin/exams/:examId/candidates/status",
      legacyGate: "Admin",
      permission: Permission.ExamEnrollmentManage,
      scope: Scope.Exam,
      resolver: "exam",
      resource: { type: "list", listOf: "candidate" },
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },

    // ── Candidate fields ──
    {
      method: "GET",
      path: "/candidate-fields",
      legacyGate: "Admin",
      permission: Permission.CandidateFieldView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: { type: "list", listOf: "candidate" },
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "POST",
      path: "/candidate-fields",
      legacyGate: "Admin",
      permission: Permission.CandidateFieldCreate,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "PATCH",
      path: "/candidate-fields/:id",
      legacyGate: "Admin",
      permission: Permission.CandidateFieldUpdate,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      method: "DELETE",
      path: "/candidate-fields/:id",
      legacyGate: "Admin",
      permission: Permission.CandidateFieldDelete,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    {
      // P4-1 §G.1 drift closure: the import-template download is an
      // Admin-gated read of the candidate-field schema (Organization scope).
      method: "GET",
      path: "/candidate-fields/template",
      legacyGate: "Admin",
      permission: Permission.CandidateFieldView,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 6,
    },
    // ── Role assignments (RBAC-M8) — admin capability surface ──
    {
      method: "GET",
      path: "/roles/assignable",
      legacyGate: "Admin",
      permission: Permission.UserRoleAssign,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: false,
      proctorAccess: "admin_only",
      migrationStage: 8,
    },
    {
      method: "GET",
      path: "/users/:id/role-assignments",
      legacyGate: "Admin",
      permission: Permission.UserView,
      scope: Scope.Organization,
      resolver: "user",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 8,
    },
    {
      method: "POST",
      path: "/users/:id/role-assignments",
      legacyGate: "Admin",
      permission: Permission.UserRoleAssign,
      scope: Scope.Organization,
      resolver: "user",
      auditAction: "user.role_changed",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 8,
    },
    {
      method: "PATCH",
      path: "/role-assignments/:assignmentId",
      legacyGate: "Admin",
      permission: Permission.UserRoleAssign,
      scope: Scope.Organization,
      resolver: "organization",
      auditAction: "user.role_changed",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 8,
    },
    {
      method: "DELETE",
      path: "/role-assignments/:assignmentId",
      legacyGate: "Admin",
      permission: Permission.UserRoleAssign,
      scope: Scope.Organization,
      resolver: "organization",
      auditAction: "user.role_changed",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 8,
    },

    // ── Proctor-to-Exam assignments (ADR-015 §16, J4-I1C) — Admin-only ──
    {
      method: "POST",
      path: "/admin/exams/:examId/proctors",
      legacyGate: "Admin",
      permission: Permission.ExamProctorAssignmentManage,
      scope: Scope.Exam,
      resolver: "exam",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 8,
    },
    {
      method: "GET",
      path: "/admin/exams/:examId/proctors",
      legacyGate: "Admin",
      permission: Permission.ExamProctorAssignmentView,
      scope: Scope.Exam,
      resolver: "exam",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 8,
    },
    {
      method: "POST",
      path: "/admin/exams/:examId/proctors/:proctorUserId/revoke",
      legacyGate: "Admin",
      permission: Permission.ExamProctorAssignmentManage,
      scope: Scope.Exam,
      resolver: "exam",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 8,
    },

    // ── Exam incidents (ADR-014 routes; registry entries added by J4-I1B) ──
    {
      method: "POST",
      path: "/admin/exams/:examId/incidents",
      legacyGate: "Admin",
      permission: Permission.IncidentCreate,
      scope: Scope.Exam,
      resolver: "exam",
      sensitive: true,
      proctorAccess: "assignment_scoped",
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/exams/:examId/incidents",
      legacyGate: "Admin",
      permission: Permission.IncidentView,
      scope: Scope.Exam,
      resolver: "exam",
      resource: { type: "list", listOf: "incident" },
      sensitive: true,
      proctorAccess: "assignment_scoped",
      migrationStage: 7,
    },
    {
      method: "GET",
      path: "/admin/incidents/:incidentId",
      legacyGate: "Admin",
      permission: Permission.IncidentView,
      scope: Scope.Exam,
      resolver: "incident",
      sensitive: true,
      proctorAccess: "assignment_scoped",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/incidents/:incidentId/investigate",
      legacyGate: "Admin",
      permission: Permission.IncidentInvestigate,
      scope: Scope.Exam,
      resolver: "incident",
      sensitive: true,
      proctorAccess: "assignment_scoped",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/incidents/:incidentId/notes",
      legacyGate: "Admin",
      permission: Permission.IncidentInvestigate,
      scope: Scope.Exam,
      resolver: "incident",
      sensitive: true,
      proctorAccess: "assignment_scoped",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/incidents/:incidentId/severity",
      legacyGate: "Admin",
      permission: Permission.IncidentInvestigate,
      scope: Scope.Exam,
      resolver: "incident",
      sensitive: true,
      proctorAccess: "assignment_scoped",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/incidents/:incidentId/resolve",
      legacyGate: "Admin",
      permission: Permission.IncidentResolve,
      scope: Scope.Exam,
      resolver: "incident",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/incidents/:incidentId/dismiss",
      legacyGate: "Admin",
      permission: Permission.IncidentResolve,
      scope: Scope.Exam,
      resolver: "incident",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/incidents/:incidentId/actions",
      legacyGate: "Admin",
      permission: Permission.IncidentInvestigate,
      scope: Scope.Exam,
      resolver: "incident",
      sensitive: true,
      proctorAccess: "assignment_scoped",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/incidents/:incidentId/attempts",
      legacyGate: "Admin",
      permission: Permission.IncidentInvestigate,
      scope: Scope.Exam,
      resolver: "incident",
      sensitive: true,
      proctorAccess: "assignment_scoped",
      migrationStage: 7,
    },
    {
      method: "POST",
      path: "/admin/incidents/:incidentId/interruptions",
      legacyGate: "Admin",
      permission: Permission.IncidentInvestigate,
      scope: Scope.Exam,
      resolver: "incident",
      sensitive: true,
      proctorAccess: "assignment_scoped",
      migrationStage: 7,
    },

    // ── Admin Recovery Center (J5-I1A, contract §5.4 / §6.3) ──
    // Admin-only organization-wide recovery queue + aggregate incident detail.
    // `IncidentRecoveryView` is granted ONLY to Admin (catalog.ts / presets.ts);
    // a Proctor with `incident.view` + active assignment is STILL denied
    // (proctorAccess: admin_only — the Recovery queue is not the runtime
    // incident surface, contract §15 adjudication). BOTH surfaces use the flat
    // `requireCapability` gate as the runtime authority; the repo owns all
    // fail-closed scope validation (org boundary + relationship graph) and
    // surfaces broken parent chains as 503 AUTHZ_UNAVAILABLE (queue + detail).
    {
      method: "GET",
      path: "/admin/recovery/incidents",
      legacyGate: "Admin",
      permission: Permission.IncidentRecoveryView,
      scope: Scope.Organization,
      resolver: "organization",
      resource: { type: "list", listOf: "incident" },
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 8,
    },
    {
      method: "GET",
      path: "/admin/recovery/incidents/:incidentId",
      legacyGate: "Admin",
      permission: Permission.IncidentRecoveryView,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 8,
    },
    {
      method: "GET",
      path: "/admin/recovery/attempts/:attemptId",
      legacyGate: "Admin",
      permission: Permission.IncidentRecoveryView,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 8,
    },
    {
      method: "GET",
      path: "/admin/recovery/exams/:examId",
      legacyGate: "Admin",
      permission: Permission.IncidentRecoveryView,
      scope: Scope.Organization,
      resolver: "organization",
      sensitive: true,
      proctorAccess: "admin_only",
      migrationStage: 8,
    },
  ];
