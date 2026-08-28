/**
 * Resource-aware capability preHandler (RBAC-M10-finish, P4-2A).
 *
 * Composes the flat role-preset capability check (auth.ts `requireCapability`)
 * with a registered scope resolver (attemptResolver / examResolver), and maps
 * resolver denials per ADR §3.9 (AuthZ Failure Mode Invariant):
 *
 *   resource_not_found      -> 404  (anti-enumeration; canonical not-found)
 *   organization_mismatch   -> 403  (scope inconsistency, never allow)
 *   ownership_mismatch      -> 403
 *   broken_parent_chain     -> 403
 *   resolver_error          -> 503 AUTHZ_UNAVAILABLE (never fail open; never
 *                              masquerade an operational failure as 403)
 *
 * The capability (preset) denial stays 403 PERMISSION_DENIED, identical to the
 * base `requireCapability` decorator — this preHandler is a strict superset of
 * it, so flipping a route from `requireCapability` to `requireScopedCapability`
 * cannot widen access; it only adds the resource-aware layer.
 *
 * ADR §10.3 (legacy stays authoritative during shadow) is unaffected: this
 * preHandler does not run shadow — it is the live capability+resolver gate on
 * routes that have already flipped off `requireRole`.
 *
 * Source of truth: `docs/adr/ADR-010-scoped-rbac-architecture.md` §3.9,
 * §Resource Resolver Matrix, §3.4 (organization anchor).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { buildErrorResponse } from "../lib/errorResponse.js";
import type { RuntimeRequestContext } from "../types/requestContext.js";
import {
  isScopeDenied,
  Role,
  Scope,
  type PermissionKey,
  type ResolvedScope,
  type ResourceRef,
  type ResourceResolverKey,
  type ScopeResolver,
} from "@exam/authz";

/** A resolver lookup keyed by ResolverKey (built by the Fastify plugin).
 *  Partial: a deployment registers only the resolver families its flipped
 *  routes reference (attempt/exam today); an unregistered key surfaces as 503
 *  AUTHZ_UNAVAILABLE at runtime (never fail open). */
export type ResolverRegistry = Partial<
  Record<ResourceResolverKey, ScopeResolver>
>;

/** Predicate that decides the flat role-preset capability verdict. */
export type PresetAllows = (
  request: FastifyRequest,
  permission: PermissionKey,
) => boolean;

/**
 * Proctor-to-Exam assignment gate (J4-I1B, ADR-015 §4.3). Injected by the
 * authz plugin; consults `exam_proctor_assignments` (active row for
 * organizationId + resolvedExamId + actorId) per request. NEVER cached across
 * requests and never placed into JWTs.
 */
export interface ProctorAssignmentGate {
  check(request: FastifyRequest, resolvedExamId: string): Promise<boolean>;
}

/**
 * Teacher-to-Course assignment gate (issue #286). Injected by the authz
 * plugin; consults `teacher_course_assignments` (active row for
 * organizationId + resolvedCourseId + actorId) per request. NEVER cached
 * across requests and never placed into JWTs. Authority semantics: the
 * assignment row is NECESSARY but not sufficient — the Teacher role preset
 * capability check (stage 1) must also pass, so a stale row for a revoked
 * Teacher grants nothing.
 */
export interface TeacherCourseAssignmentGate {
  check(request: FastifyRequest, resolvedCourseId: string): Promise<boolean>;
}

/**
 * Extracts the resolved Exam id from a successful scope resolution. The
 * parent chain's `exam` node is authoritative when present (the incident
 * resolver reduces to Scope.Exam but its resourceId is the INCIDENT id, not
 * the exam id); for plain Exam-scoped resolutions the resourceId IS the exam
 * id.
 */
function resolvedExamId(resolution: ResolvedScope): string | null {
  const examNode = resolution.chain?.find((n) => n.type === "exam");
  if (examNode?.id) return examNode.id;
  if (resolution.scope === Scope.Exam) {
    return resolution.resourceId ?? null;
  }
  return null;
}

/**
 * Extracts the resolved Course id from a successful scope resolution
 * (issue #286). The parent chain's `course` node is authoritative — it
 * carries the DURABLE parent (exams.courseId / questions.courseId), never a
 * client-supplied courseId. For plain Course-scoped resolutions (the course
 * resolver itself) the resourceId IS the course id.
 */
function resolvedCourseId(resolution: ResolvedScope): string | null {
  const courseNode = resolution.chain?.find((n) => n.type === "course");
  if (courseNode?.id) return courseNode.id;
  if (resolution.scope === Scope.Course) {
    return resolution.resourceId ?? null;
  }
  return null;
}

/** Input to the resource-aware preHandler builder. */
export interface ScopedCapabilityInput {
  /** The Phase 3 permission this route requires. */
  permission: PermissionKey;
  /** Which registered resolver reduces the resource to a scope. */
  resolverKey: ResourceResolverKey;
  /** The request key carrying the resource id (e.g. "attemptId"). */
  resourceIdKey: string;
  /**
   * Where the resource id is sourced from. Defaults to `"params"` (the
   * historical behavior). `"body"` supports create-style routes whose parent
   * reference arrives in the request body (e.g. POST /questions courseId) —
   * the route registry's `idSource` already models this distinction.
   */
  resourceIdSource?: "params" | "body";
  /** Resolver lookup (injected; built by the authz plugin from fastify.db). */
  resolvers: ResolverRegistry;
  /** Flat role-preset predicate (injected; wraps @exam/authz permissionsForRole). */
  presetAllows: PresetAllows;
  /**
   * J4-I1B (ADR-015 §4.3): when `"assignment_scoped"`, Proctor actors must
   * hold an ACTIVE Proctor-to-Exam assignment to the resolved Exam. Admin
   * short-circuits the assignment requirement (the resolver still runs). A
   * missing assignment is folded into the 404 `RESOURCE_NOT_FOUND` bucket
   * (anti-enumeration, ADR-015 §9).
   */
  proctorAccess?: "assignment_scoped";
  /** Assignment checker (injected by the authz plugin from fastify.db). */
  proctorAssignment?: ProctorAssignmentGate;
  /**
   * Issue #286: when `"course_assignment_scoped"`, non-Admin actors must hold
   * an ACTIVE Teacher-to-Course assignment to the resolved Course. Admin
   * short-circuits the assignment requirement (the resolver still runs). A
   * missing assignment is folded into the 404 `RESOURCE_NOT_FOUND` bucket
   * (anti-enumeration, same contract as proctorAccess).
   */
  teacherAccess?: "course_assignment_scoped";
  /** Assignment checker (injected by the authz plugin from fastify.db). */
  teacherAssignment?: TeacherCourseAssignmentGate;
}

/**
 * Builds the resource-aware capability preHandler. Pure: all dependencies
 * (resolvers, preset predicate) are injected, so the ADR §3.9 denial mapping
 * is unit-testable without DB fixtures.
 *
 * Order: preset check first (cheap, 0 DB reads) -> resolver (≤2 DB reads per
 * ADR §22.2). A preset denial never reaches the resolver.
 */
export function buildScopedCapabilityPreHandler(
  input: ScopedCapabilityInput,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const {
    permission,
    resolverKey,
    resourceIdKey,
    resourceIdSource = "params",
    resolvers,
    presetAllows,
    proctorAccess,
    proctorAssignment,
    teacherAccess,
    teacherAssignment,
  } = input;
  return async (request, reply) => {
    const ctx = request.ctx;
    if (!ctx) {
      return reply
        .code(401)
        .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
    }

    // Stage 1: flat role-preset capability (identical to requireCapability).
    if (!presetAllows(request, permission)) {
      return reply
        .code(403)
        .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
    }

    // Stage 2: resource-aware scope resolution. The resource id is sourced
    // from request.params per the route's registry resource spec.
    const resolver = resolvers[resolverKey];
    if (!resolver) {
      // Configuration error: a route declared a resolver no plugin registered.
      // Never fail open (ADR §3.9); surface as 503 so it is not masked as 403.
      request.log.error(
        { resolverKey, permission, route: request.url },
        "authz scoped-capability resolver not registered",
      );
      return reply
        .code(503)
        .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
    }

    const resourceRecord =
      resourceIdSource === "body"
        ? ((request.body ?? {}) as Record<string, unknown>)
        : ((request.params ?? {}) as Record<string, unknown>);
    const resourceId = resourceRecord[resourceIdKey] as string | undefined;
    if (!resourceId || typeof resourceId !== "string") {
      // No resource id on the request (mis-declared route). Fail closed.
      request.log.error(
        { resolverKey, permission, resourceIdKey, route: request.url },
        "authz scoped-capability resource id missing on request",
      );
      return reply
        .code(503)
        .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
    }

    const resourceRef: ResourceRef = { type: resolverKey, id: resourceId };
    const resolution = await resolver.resolve(
      { actorId: ctx.actorId, organizationId: ctx.organizationId },
      resourceRef,
    );

    if (isScopeDenied(resolution)) {
      // ADR §3.9 deny mapping.
      switch (resolution.reason) {
        case "resource_not_found":
          // Preserve the anti-enumeration norm: a missing resource is the
          // handler's canonical 404, not an authz 403.
          return reply
            .code(404)
            .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
        case "organization_mismatch":
        case "ownership_mismatch":
        case "broken_parent_chain":
          // Scope inconsistency: never allow. 403 (ADR §3.9 allows 403/409;
          // 403 keeps it indistinguishable from a capability denial for an
          // unprivileged actor, avoiding existence leak).
          return reply
            .code(403)
            .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
        case "resolver_error":
          // Operational failure: never fail open, never masquerade as 403.
          return reply
            .code(503)
            .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
        default:
          // Unknown deny reason: fail closed as 503 (defensive; ADR §3.9).
          return reply
            .code(503)
            .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
      }
    }

    // Resolved scope: pass the gate. The handler runs and applies its own
    // business-state + organization predicates (defense-in-depth, ADR §3.4).

    // J4-I1B Proctor-to-Exam assignment enforcement (ADR-015 §4.3): runs
    // AFTER the capability check and AFTER the resource resolver, for
    // non-Admin actors only. Admin short-circuits the assignment requirement
    // but the resolver above already validated target existence, tenant, and
    // parent chain. A missing assignment is a 404 RESOURCE_NOT_FOUND —
    // indistinguishable from a missing resource (anti-enumeration, §9).
    if (proctorAccess === "assignment_scoped") {
      if (!proctorAssignment) {
        // Configuration error: a route declared Proctor assignment scope
        // without wiring the gate. Never fail open.
        request.log.error(
          { resolverKey, permission, route: request.url },
          "authz proctor-assignment gate not wired",
        );
        return reply
          .code(503)
          .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
      }
      const runtimeCtx = ctx as RuntimeRequestContext;
      if (!runtimeCtx.roles.includes(Role.Admin)) {
        const examId = resolvedExamId(resolution);
        if (!examId) {
          // The resolution produced no Exam identity — the enforcement cannot
          // run. Fail closed (mis-declared route).
          request.log.error(
            { resolverKey, permission, route: request.url },
            "authz proctor-assignment enforcement: no resolved Exam id",
          );
          return reply
            .code(503)
            .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
        }
        let assigned: boolean;
        try {
          assigned = await proctorAssignment.check(request, examId);
        } catch (error) {
          // Operational failure (DB down, timeout, repo error): never fail
          // open, never masquerade as 403/404 — same 503 AUTHZ_UNAVAILABLE
          // contract the resolvers use for `resolver_error` (ADR §3.9).
          request.log.error(
            {
              err: error,
              resolverKey,
              permission,
              examId,
              route: request.url,
            },
            "authz proctor-assignment lookup failed",
          );
          return reply
            .code(503)
            .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
        }
        if (!assigned) {
          return reply
            .code(404)
            .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
        }
      }
    }

    // Issue #286 Teacher-to-Course assignment enforcement: mirrors the
    // proctorAccess block above (capability first, then resolver, then
    // episode gate for non-Admin actors only; missing assignment folds into
    // 404 RESOURCE_NOT_FOUND). Deliberately a PARALLEL option, not a shared
    // "scoped-assignment framework" — the two carriers have different
    // semantics (exam episode with operation receipts vs. course config
    // episode) and the campaign prohibits speculative unification.
    if (teacherAccess === "course_assignment_scoped") {
      if (!teacherAssignment) {
        // Configuration error: a route declared Teacher assignment scope
        // without wiring the gate. Never fail open.
        request.log.error(
          { resolverKey, permission, route: request.url },
          "authz teacher-assignment gate not wired",
        );
        return reply
          .code(503)
          .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
      }
      const runtimeCtx = ctx as RuntimeRequestContext;
      if (!runtimeCtx.roles.includes(Role.Admin)) {
        const courseId = resolvedCourseId(resolution);
        if (!courseId) {
          // The resolution produced no Course identity — the enforcement
          // cannot run. Fail closed (mis-declared route).
          request.log.error(
            { resolverKey, permission, route: request.url },
            "authz teacher-assignment enforcement: no resolved Course id",
          );
          return reply
            .code(503)
            .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
        }
        let assigned: boolean;
        try {
          assigned = await teacherAssignment.check(request, courseId);
        } catch (error) {
          // Operational failure: never fail open, never masquerade as
          // 403/404 — same 503 AUTHZ_UNAVAILABLE contract as proctorAccess.
          request.log.error(
            {
              err: error,
              resolverKey,
              permission,
              courseId,
              route: request.url,
            },
            "authz teacher-assignment lookup failed",
          );
          return reply
            .code(503)
            .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
        }
        if (!assigned) {
          return reply
            .code(404)
            .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
        }
      }
    }
  };
}
