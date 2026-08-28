import type { FastifyInstance } from "fastify";
import type { RequestContext } from "@exam/domain";
import { Role } from "@exam/authz";
import { createGraderExamAssignmentRepo } from "@exam/db/src/repository/graderExamAssignmentRepo.js";
import type { RuntimeRequestContext } from "../types/requestContext.js";
import { isOrgWideAdmin } from "./teacherScope.js";

/**
 * Resolves the actor's Grader exam scope for the grading-queue LIST filter
 * (issue #296). Returns `null` when the actor is Admin (org-wide — apply no
 * exam filter); otherwise the ACTIVE assigned exam-id set, where an EMPTY
 * set means "assigned to nothing → see nothing" (never "no filter").
 *
 * Resolved fresh from the DB on every call — assignment revocation is
 * effective on the next request by construction. The queue handler MUST
 * apply the filter in the SQL query BEFORE pagination AND before the total
 * count, never post-filter, and list/count must agree.
 */
export async function resolveGraderExamScope(
  db: FastifyInstance["db"],
  ctx: RequestContext,
): Promise<string[] | null> {
  const runtimeCtx = ctx as RuntimeRequestContext;
  if (runtimeCtx.roles?.includes(Role.Admin)) return null;
  return createGraderExamAssignmentRepo(db).listActiveExamIdsByGrader(
    ctx,
    ctx.actorId,
  );
}

export { isOrgWideAdmin };
