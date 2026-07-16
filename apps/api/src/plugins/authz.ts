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
  permissionsForRole,
  type PermissionKey,
  type ResolverKey,
  type RoleKey,
} from "@exam/authz";
import {
  buildScopedCapabilityPreHandler,
  type ResolverRegistry,
} from "../authz/scopedCapability.js";
import {
  createAttemptResolver,
  createExamResolver,
} from "../authz/resolvers/attemptResolver.js";

/**
 * Memoized role-preset permission sets (mirrors `plugins/auth.ts`). Presets are
 * static, so the cache is safe for the process lifetime.
 */
const PRESET_SETS = new Map<RoleKey, ReadonlySet<PermissionKey>>();
function presetSet(role: RoleKey): ReadonlySet<PermissionKey> {
  let set = PRESET_SETS.get(role);
  if (!set) {
    set = new Set<PermissionKey>(permissionsForRole(role));
    PRESET_SETS.set(role, set);
  }
  return set;
}

const authzScopedPlugin: FastifyPluginAsync = async (fastify) => {
  // Resolver registry: one DB-backed resolver per resource family the flipped
  // routes reference. Add families here as more routes adopt scoped capability.
  const resolvers: ResolverRegistry = {
    attempt: createAttemptResolver(fastify.db, fastify.log),
    exam: createExamResolver(fastify.db, fastify.log),
  };

  fastify.decorate(
    "requireScopedCapability",
    (
      permission: PermissionKey,
      resolverKey: ResolverKey,
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
          return presetSet(ctx.role as RoleKey).has(perm);
        },
      });
      return (request: FastifyRequest, reply: FastifyReply) =>
        handler(request, reply);
    },
  );
};

export default fp(authzScopedPlugin);
