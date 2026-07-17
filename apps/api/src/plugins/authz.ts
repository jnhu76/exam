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
      return (request: FastifyRequest, reply: FastifyReply) =>
        handler(request, reply);
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
};

export default fp(authzScopedPlugin);
