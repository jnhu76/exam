/**
 * Fastify plugin that registers the resource-aware capability decorator
 * `requireScopedCapability` (RBAC-M10-finish, P4-2A).
 *
 * This wires the pure {@link buildScopedCapabilityPreHandler} to the live
 * dependency set: the `@exam/authz` role-preset matrix (the same source
 * `requireCapability` uses) and the DB-backed scope resolvers
 * (`createAttemptResolver` / `createExamResolver`). The decorator is the
 * accepted request-path wiring seam for resource-aware authorization
 * (`docs/adr/ADR-010-scoped-rbac-architecture.md` §3.9, §Resource Resolver
 * Matrix; precedent: `plugins/tenant.ts` onRoute pattern).
 *
 * Routes opt in by replacing `fastify.requireCapability(perm)` with
 * `fastify.requireScopedCapability(perm, resolverKey, resourceIdKey)` in their
 * preHandler chain. The decorator is a strict superset of `requireCapability`
 * (preset check is identical), so flipping cannot widen access — it only adds
 * the resource-aware resolver layer.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { type PermissionKey, type ResourceResolverKey } from "@exam/authz";
import {
  buildScopedCapabilityPreHandler,
  type ProctorAssignmentGate,
  type TeacherCourseAssignmentGate,
  type GraderExamAssignmentGate,
  type ResolverRegistry,
} from "../authz/scopedCapability.js";
import {
  createAttemptResolver,
  createExamResolver,
} from "../authz/resolvers/attemptResolver.js";
import {
  createCourseResolver,
  createQuestionResolver,
} from "../authz/resolvers/courseResolver.js";
import { createIncidentResolver } from "../authz/resolvers/incidentResolver.js";
import { createProctorAssignmentRepo } from "@exam/db/src/repository/proctorAssignmentRepo.js";
import { createTeacherCourseAssignmentRepo } from "@exam/db/src/repository/teacherCourseAssignmentRepo.js";
import { createGraderExamAssignmentRepo } from "@exam/db/src/repository/graderExamAssignmentRepo.js";
import { buildScoreCapabilityPreHandler } from "../authz/scoreCapability.js";
import { buildCandidateContextCapabilityPreHandler } from "../authz/candidateContextCapability.js";
import { buildExamEligibilityCapabilityPreHandler } from "../authz/examEligibilityCapability.js";
import { buildOwnAttemptCapabilityPreHandler } from "../authz/ownAttemptCapability.js";
import type { AuthzPreHandler } from "../types/fastify-auth.d.js";
import type { EligibilityDenialMode } from "../types/fastify-auth.d.js";

/**
 * The single capability predicate every resource-aware gate uses
 * (RBAC-M10-E). Reads the authoritative `ctx.capabilities` union resolved at
 * authenticate time from `user_role_assignments` — NOT a role preset lookup.
 * Centralizing it here means every scoped / candidate / score gate switches
 * authority in lockstep with {@link requireCapability}.
 */
function ctxAllows(
  request: FastifyRequest,
  permission: PermissionKey,
): boolean {
  const ctx = request.ctx;
  return !!ctx && ctx.capabilities.includes(permission);
}

const authzScopedPlugin: FastifyPluginAsync = async (fastify) => {
  // Resolver registry: one DB-backed resolver per resource family the flipped
  // routes reference. Add families here as more routes adopt scoped capability.
  const resolvers: ResolverRegistry = {
    attempt: createAttemptResolver(fastify.db, fastify.log),
    exam: createExamResolver(fastify.db, fastify.log),
    course: createCourseResolver(fastify.db, fastify.log),
    question: createQuestionResolver(fastify.db, fastify.log),
    incident: createIncidentResolver(fastify.db, fastify.log),
    // NOTE: the `score` family is NOT a generic ScopeResolver — its resolution
    // carries ownership facts the generic interface cannot express, so the
    // score route uses the dedicated `requireScoreCapability` decorator below
    // (which calls resolveScoreScope directly) instead of this registry.
  };

  /**
   * J4-I1B Proctor-to-Exam assignment gate (ADR-015 §4.3). Reads the active
   * `exam_proctor_assignments` row for (ctx.organizationId, resolvedExamId,
   * ctx.actorId) per request — never cached across requests, never placed
   * into JWTs.
   */
  const proctorAssignmentGate: ProctorAssignmentGate = {
    check: async (request: FastifyRequest, resolvedExamId: string) => {
      const ctx = request.ctx;
      if (!ctx) return false;
      return createProctorAssignmentRepo(fastify.db).hasActiveAssignment(
        ctx,
        resolvedExamId,
        ctx.actorId,
      );
    },
  };

  /**
   * Issue #286 Teacher-to-Course assignment gate. Reads the active
   * `teacher_course_assignments` row for (ctx.organizationId, courseId,
   * ctx.actorId) per request — never cached across requests, never placed
   * into JWTs. Revocation is effective on the NEXT request by construction.
   */
  const teacherAssignmentGate: TeacherCourseAssignmentGate = {
    check: async (request: FastifyRequest, resolvedCourseId: string) => {
      const ctx = request.ctx;
      if (!ctx) return false;
      return createTeacherCourseAssignmentRepo(fastify.db).hasActiveAssignment(
        ctx,
        resolvedCourseId,
        ctx.actorId,
      );
    },
  };

  /**
   * Issue #296 Grader-to-Exam assignment gate. Reads the active
   * `grader_exam_assignments` row for (ctx.organizationId, examId,
   * ctx.actorId) per request — never cached across requests, never placed
   * into JWTs. Revocation is effective on the NEXT request by construction.
   */
  const graderAssignmentGate: GraderExamAssignmentGate = {
    check: async (request: FastifyRequest, resolvedExamId: string) => {
      const ctx = request.ctx;
      if (!ctx) return false;
      return createGraderExamAssignmentRepo(fastify.db).hasActiveAssignment(
        ctx,
        resolvedExamId,
        ctx.actorId,
      );
    },
  };

  fastify.decorate(
    "requireScopedCapability",
    (
      permission: PermissionKey,
      resolverKey: ResourceResolverKey,
      resourceIdKey: string,
      options?: {
        proctorAccess?: "assignment_scoped";
        teacherAccess?: "course_assignment_scoped";
        graderAccess?: "exam_assignment_scoped";
        resourceIdSource?: "params" | "body";
      },
    ) => {
      const handler = buildScopedCapabilityPreHandler({
        permission,
        resolverKey,
        resourceIdKey,
        ...(options?.resourceIdSource
          ? { resourceIdSource: options.resourceIdSource }
          : {}),
        resolvers,
        presetAllows: (request: FastifyRequest, perm: PermissionKey) =>
          ctxAllows(request, perm),
        ...(options?.proctorAccess === "assignment_scoped"
          ? {
              proctorAccess: "assignment_scoped" as const,
              proctorAssignment: proctorAssignmentGate,
            }
          : {}),
        ...(options?.teacherAccess === "course_assignment_scoped"
          ? {
              teacherAccess: "course_assignment_scoped" as const,
              teacherAssignment: teacherAssignmentGate,
            }
          : {}),
        ...(options?.graderAccess === "exam_assignment_scoped"
          ? {
              graderAccess: "exam_assignment_scoped" as const,
              graderAssignment: graderAssignmentGate,
            }
          : {}),
      });
      const preHandler: AuthzPreHandler = (request, reply) =>
        handler(request, reply);
      preHandler.authz = {
        kind: "scoped",
        permission,
        resolverKey,
        resourceIdKey,
        ...(options?.proctorAccess === "assignment_scoped"
          ? { proctorAccess: "assignment_scoped" as const }
          : {}),
        ...(options?.teacherAccess === "course_assignment_scoped"
          ? { teacherAccess: "course_assignment_scoped" as const }
          : {}),
        ...(options?.graderAccess === "exam_assignment_scoped"
          ? { graderAccess: "exam_assignment_scoped" as const }
          : {}),
      };
      return preHandler;
    },
  );

  // Score-route capability gate (RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1).
  // Capability + ownership arbitration for `GET /scores/attempts/:attemptId`.
  // Own/all is resolved from the actor's capability set (ScoreAllView /
  // ScoreOwnView) plus the resolved attempt ownership — never from a role-name
  // branch. Emits request.scoreView for the publication handler (P1-4).
  // Issue #286: the ScoreAllView path is course-scoped for non-Admin actors
  // through the same Teacher-to-Course gate the scoped routes use.
  const scoreHandler = buildScoreCapabilityPreHandler({
    db: fastify.db,
    logger: fastify.log,
    allows: (request: FastifyRequest, perm: PermissionKey) =>
      ctxAllows(request, perm),
    teacherCourseGate: teacherAssignmentGate,
  });
  fastify.decorate("requireScoreCapability", () => {
    // P4-C1: attach an introspection-only `_isScoreCapability: true` tag so the
    // whole-app route regression lock can classify this gate as a protected
    // capability/ownership gate. Unlike the other resource-aware gates this
    // decorator does not attach `.authz` metadata (the dedicated score gate is
    // documented in P4-V0 §7.2 / §8 as "80 metadata gates + 1 dedicated score
    // gate = 81"); the tag closes that introspection gap without changing any
    // runtime authorization decision. Production-neutral, mirrors the
    // `_isAuthenticate` / `_isRequireRole` tag convention.
    const preHandler = (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => scoreHandler(request, reply);
    Object.assign(preHandler, { _isScoreCapability: true });
    return preHandler;
  });

  // Candidate-context capability gate (RBAC-M10-A archetype A).
  // Preset-only gate for `GET /candidate/exams`; the handler scopes the list to
  // the candidate profile (defense-in-depth, directive §6.6). No DB resolver.
  const candidateContextHandler = buildCandidateContextCapabilityPreHandler(
    (request: FastifyRequest, perm: PermissionKey) => ctxAllows(request, perm),
  );
  fastify.decorate("requireCandidateContext", (permission: PermissionKey) => {
    const handler = candidateContextHandler(permission);
    const preHandler: AuthzPreHandler = (request, reply) =>
      handler(request, reply);
    preHandler.authz = { kind: "candidate_context", permission };
    return preHandler;
  });

  // Candidate exam-eligibility capability gate (RBAC-M10-A archetype B).
  // Capability + eligibility for exam detail / queue / start. Exam must resolve
  // under the org anchor AND the actor must have a candidate profile with an
  // enrollment for the exam (server-derived, no client candidateId trust).
  const examEligibilityHandler = buildExamEligibilityCapabilityPreHandler({
    db: fastify.db,
    logger: fastify.log,
    allows: (request: FastifyRequest, perm: PermissionKey) =>
      ctxAllows(request, perm),
  });
  fastify.decorate(
    "requireExamEligibility",
    (
      permission: PermissionKey,
      resourceIdKey: string,
      eligibilityDenialMode: EligibilityDenialMode,
    ) => {
      const handler = examEligibilityHandler(
        permission,
        resourceIdKey,
        eligibilityDenialMode,
      );
      const preHandler: AuthzPreHandler = (request, reply) =>
        handler(request, reply);
      preHandler.authz = {
        kind: "exam_eligibility",
        permission,
        resourceIdKey,
        eligibilityDenialMode,
      };
      return preHandler;
    },
  );

  // Own-attempt capability gate (RBAC-M10-A archetype C/D).
  // Capability + ownership for attempt view / take / answer-save / submit /
  // heartbeat / restore. Attempt must resolve under the org anchor AND its
  // owner (candidateProfiles.userId) must equal the actor. Anti-enumeration:
  // cross-candidate probe -> 404 (not 403).
  const ownAttemptHandler = buildOwnAttemptCapabilityPreHandler({
    db: fastify.db,
    logger: fastify.log,
    allows: (request: FastifyRequest, perm: PermissionKey) =>
      ctxAllows(request, perm),
  });
  fastify.decorate(
    "requireOwnAttempt",
    (permission: PermissionKey, resourceIdKey: string) => {
      const handler = ownAttemptHandler(permission, resourceIdKey);
      const preHandler: AuthzPreHandler = (request, reply) =>
        handler(request, reply);
      preHandler.authz = { kind: "own_attempt", permission, resourceIdKey };
      return preHandler;
    },
  );
};

export default fp(authzScopedPlugin);
