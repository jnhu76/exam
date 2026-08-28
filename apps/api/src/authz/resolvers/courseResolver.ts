import type { FastifyBaseLogger } from "fastify";
import type { Database, TenantContext } from "@exam/db/src/types.js";
import { createCourseRepo } from "@exam/db/src/repository/courseRepo.js";
import { createQuestionRepo } from "@exam/db/src/repository/questionRepo.js";
import {
  Scope,
  type ResolverContext,
  type ResolvedScope,
  type DeniedScope,
  type ScopeResolver,
} from "@exam/authz";
import { resolveAuthorizationChain } from "./attemptResolver.js";

function repoCtx(ctx: ResolverContext): TenantContext {
  return {
    actorId: ctx.actorId,
    organizationId: ctx.organizationId,
    role: "Admin" as TenantContext["role"],
    permissions: [],
  };
}

/**
 * Course scope resolver (issue #286): resolves a course id to Scope.Course
 * under the org anchor. The chain carries the single `course` node — the
 * Teacher course-assignment gate reads it to enforce the active
 * teacher_course_assignments episode.
 */
export function createCourseResolver(
  db: Database,
  logger?: FastifyBaseLogger,
): ScopeResolver {
  return {
    key: "course",
    async resolve(ctx, ref): Promise<ResolvedScope | DeniedScope> {
      return resolveAuthorizationChain({
        logger,
        ctx,
        resourceId: ref.id,
        resolver: "course",
        scope: Scope.Course,
        load: async () => {
          const row = await createCourseRepo(db).findAuthorizationChain(
            repoCtx(ctx),
            ref.id,
          );
          return row
            ? {
                resourceId: row.courseId,
                resourceOrganizationId: row.courseOrganizationId,
                organizationIds: [row.courseOrganizationId, row.organizationId],
                chain: [{ type: "course", id: row.courseId }],
              }
            : null;
        },
      });
    },
  };
}

/**
 * Question scope resolver (issue #286): resolves a question id through its
 * durable parent course (questions.courseId — never a client-supplied
 * courseId) to Scope.Course under the org anchor.
 */
export function createQuestionResolver(
  db: Database,
  logger?: FastifyBaseLogger,
): ScopeResolver {
  return {
    key: "question",
    async resolve(ctx, ref): Promise<ResolvedScope | DeniedScope> {
      return resolveAuthorizationChain({
        logger,
        ctx,
        resourceId: ref.id,
        resolver: "question",
        scope: Scope.Course,
        load: async () => {
          const row = await createQuestionRepo(db).findAuthorizationChain(
            repoCtx(ctx),
            ref.id,
          );
          return row
            ? {
                resourceId: row.questionId,
                resourceOrganizationId: row.questionOrganizationId,
                organizationIds: [
                  row.questionOrganizationId,
                  row.courseOrganizationId,
                  row.organizationId,
                ],
                chain: [
                  { type: "question", id: row.questionId },
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
