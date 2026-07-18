/**
 * Fastify plugin that registers the resource-aware capability decorator
 * `requireScopedCapability` (RBAC-M10-finish, P4-2A).
 *
 * This wires the pure {@link buildScopedCapabilityPreHandler} to the live
 * dependency set: the `@exam/authz` role-preset matrix (the same source
 * `requireCapability` uses) and the DB-backed scope resolvers
 * (`createAttemptResolver` / `createExamResolver`). The decorator is the
 * accepted request-path wiring seam for resource-aware authorization
 * (`docs/phase3/rbac/adr-scoped-rbac-architecture.md` §3.9, §Resource Resolver
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
import {
  type PermissionKey,
  type ResourceResolverKey,
  type RoleKey,
} from "@exam/authz";
import { presetAllows } from "../lib/presetCache.js";
import {
  buildScopedCapabilityPreHandler,
  type ResolverRegistry,
} from "../authz/scopedCapability.js";
import {
  createAttemptResolver,
  createExamResolver,
} from "../authz/resolvers/attemptResolver.js";
import { buildScoreCapabilityPreHandler } from "../authz/scoreCapability.js";
import { buildCandidateContextCapabilityPreHandler } from "../authz/candidateContextCapability.js";
import { buildExamEligibilityCapabilityPreHandler } from "../authz/examEligibilityCapability.js";
import { buildOwnAttemptCapabilityPreHandler } from "../authz/ownAttemptCapability.js";
import type { AuthzPreHandler } from "../types/fastify-auth.d.js";
import type { EligibilityDenialMode } from "../types/fastify-auth.d.js";

const authzScopedPlugin: FastifyPluginAsync = async (fastify) => {
  // Resolver registry: one DB-backed resolver per resource family the flipped
  // routes reference. Add families here as more routes adopt scoped capability.
  const resolvers: ResolverRegistry = {
    attempt: createAttemptResolver(fastify.db, fastify.log),
    exam: createExamResolver(fastify.db, fastify.log),
    // NOTE: the `score` family is NOT a generic ScopeResolver — its resolution
    // carries ownership facts the generic interface cannot express, so the
    // score route uses the dedicated `requireScoreCapability` decorator below
    // (which calls resolveScoreScope directly) instead of this registry.
  };

  fastify.decorate(
    "requireScopedCapability",
    (
      permission: PermissionKey,
      resolverKey: ResourceResolverKey,
      resourceIdKey: string,
    ) => {
      const handler = buildScopedCapabilityPreHandler({
        permission,
        resolverKey,
        resourceIdKey,
        resolvers,
        presetAllows: (request: FastifyRequest, perm: PermissionKey) => {
          const ctx = request.ctx;
          if (!ctx) return false;
          return presetAllows(ctx.role as RoleKey, perm);
        },
      });
      const preHandler: AuthzPreHandler = (request, reply) =>
        handler(request, reply);
      preHandler.authz = {
        kind: "scoped",
        permission,
        resolverKey,
        resourceIdKey,
      };
      return preHandler;
    },
  );

  // Score-route capability gate (RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1).
  // Capability + ownership arbitration for `GET /scores/attempts/:attemptId`.
  // Own/all is resolved from the role preset (ScoreAllView / ScoreOwnView) plus
  // the resolved attempt ownership — never from a role-name branch.
  const scoreHandler = buildScoreCapabilityPreHandler({
    db: fastify.db,
    logger: fastify.log,
    presetAllows,
  });
  fastify.decorate("requireScoreCapability", () => {
    return (request: FastifyRequest, reply: FastifyReply) =>
      scoreHandler(request, reply);
  });

  // Candidate-context capability gate (RBAC-M10-A archetype A).
  // Preset-only gate for `GET /candidate/exams`; the handler scopes the list to
  // the candidate profile (defense-in-depth, directive §6.6). No DB resolver.
  const candidateContextHandler = buildCandidateContextCapabilityPreHandler(
    (role: RoleKey, perm: PermissionKey) => presetAllows(role, perm),
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
    presetAllows,
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
    presetAllows,
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
