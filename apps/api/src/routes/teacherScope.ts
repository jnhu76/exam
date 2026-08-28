import type { FastifyInstance } from "fastify";
import type { RequestContext } from "@exam/domain";
import { Role } from "@exam/authz";
import { createTeacherCourseAssignmentRepo } from "@exam/db/src/repository/teacherCourseAssignmentRepo.js";
import type { RuntimeRequestContext } from "../types/requestContext.js";

/**
 * Resolves the actor's Teacher course scope for LIST-route filtering
 * (issue #286 §3F). Returns `null` when the actor is Admin (org-wide — apply
 * no course filter); otherwise the ACTIVE assigned course-id set, where an
 * EMPTY set means "assigned to nothing → see nothing" (never "no filter").
 *
 * Resolved fresh from the DB on every call — assignment revocation is
 * effective on the next request by construction. LIST handlers MUST apply
 * the filter in the SQL query BEFORE pagination/count, never post-filter.
 */
export async function resolveTeacherCourseScope(
  db: FastifyInstance["db"],
  ctx: RequestContext,
): Promise<string[] | null> {
  const runtimeCtx = ctx as RuntimeRequestContext;
  if (runtimeCtx.roles?.includes(Role.Admin)) return null;
  return createTeacherCourseAssignmentRepo(db).listActiveCourseIdsByTeacher(
    ctx,
    ctx.actorId,
  );
}

/**
 * True when the actor is Admin (org-wide authority — every scoped gate
 * short-circuits). Mirrors the Admin short-circuit inside
 * requireScopedCapability; used by handlers for create/update side rules
 * (e.g. self-assignment on course create).
 */
export function isOrgWideAdmin(ctx: RequestContext): boolean {
  return (ctx as RuntimeRequestContext).roles?.includes(Role.Admin) ?? false;
}
