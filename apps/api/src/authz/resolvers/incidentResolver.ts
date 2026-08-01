import type { FastifyBaseLogger } from "fastify";
import type { Database, TenantContext } from "@exam/db/src/types.js";
import { createIncidentRepo } from "@exam/db/src/repository/incidentRepo.js";
import {
  Scope,
  type DeniedScope,
  type ResolvedScope,
  type ScopeResolver,
} from "@exam/authz";
import { resolveAuthorizationChain } from "./attemptResolver.js";

function repoCtx(ctx: {
  actorId: string;
  organizationId: string;
}): TenantContext {
  return {
    actorId: ctx.actorId,
    organizationId: ctx.organizationId,
    role: "Admin" as TenantContext["role"],
    permissions: [],
  };
}

/**
 * Incident → Exam resolver (J4-I1B, ADR-015 §8).
 *
 * Resolves `incidentId` → `exam_incidents.exam_id` → Exam → Course →
 * Organization and reduces to `Scope.Exam` with the full parent chain. The
 * incident's examId is read from the AUTHORITATIVE incident row — never from
 * the URL or request body — so a request cannot re-parent an incident by
 * supplying a different examId. Tenant-scoped, fail-closed: missing or
 * cross-org incident → `resource_not_found`; parent-chain inconsistency →
 * `broken_parent_chain`; DB failure → `resolver_error` (503 AUTHZ_UNAVAILABLE).
 */
export function createIncidentResolver(
  db: Database,
  logger?: FastifyBaseLogger,
): ScopeResolver {
  return {
    key: "incident",
    async resolve(
      ctx: { actorId: string; organizationId: string },
      ref: { type: string; id: string },
    ): Promise<ResolvedScope | DeniedScope> {
      return resolveAuthorizationChain({
        logger,
        ctx,
        resourceId: ref.id,
        resolver: "incident",
        scope: Scope.Exam,
        load: async () => {
          const row = await createIncidentRepo(db).findAuthorizationChain(
            repoCtx(ctx),
            ref.id,
          );
          return row
            ? {
                resourceId: row.incidentId,
                resourceOrganizationId: row.incidentOrganizationId,
                organizationIds: [
                  row.incidentOrganizationId,
                  row.examOrganizationId,
                  row.courseOrganizationId,
                  row.organizationId,
                ],
                chain: [
                  { type: "incident", id: row.incidentId },
                  { type: "exam", id: row.examId, linkedId: row.linkedExamId },
                  {
                    type: "course",
                    id: row.courseId,
                    linkedId: row.linkedCourseId,
                  },
                ],
              }
            : null;
        },
      });
    },
  };
}
