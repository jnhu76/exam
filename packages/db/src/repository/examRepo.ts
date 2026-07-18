import type { Database } from "../types.js";
import {
  candidateProfiles,
  courses,
  examEnrollments,
  exams,
  organizations,
} from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, asc, eq, inArray } from "drizzle-orm";

type ExamSelect = typeof exams.$inferSelect;

/**
 * Creates the tenant-scoped repository for the `exams` table. Extends the
 * generic CRUD repo with a row-locked lookup used by admin operations.
 */
export function createExamRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, exams);

  return {
    ...repo,
    async listProctorDiscoverable(ctx: TenantContext | RequestContext) {
      const orgId = resolveOrganizationId(ctx);
      return db
        .select({
          examId: exams.id,
          title: exams.title,
          status: exams.status,
          openAt: exams.openAt,
          closeAt: exams.closeAt,
        })
        .from(exams)
        .where(
          and(
            eq(exams.organizationId, orgId),
            inArray(exams.status, ["published", "open", "closed"]),
          ),
        )
        .orderBy(asc(exams.openAt), asc(exams.id));
    },
    async findAuthorizationChain(
      ctx: TenantContext | RequestContext,
      examId: string,
    ) {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select({
          examId: exams.id,
          examOrganizationId: exams.organizationId,
          linkedCourseId: exams.courseId,
          courseId: courses.id,
          courseOrganizationId: courses.organizationId,
          organizationId: organizations.id,
        })
        .from(exams)
        .leftJoin(courses, eq(exams.courseId, courses.id))
        .leftJoin(organizations, eq(courses.organizationId, organizations.id))
        .where(and(eq(exams.organizationId, orgId), eq(exams.id, examId)))
        .limit(1);
      return rows[0] ?? null;
    },
    /**
     * Candidate exam-eligibility chain (RBAC-M10-A, archetype B).
     *
     * Single query that loads the exam→course→organization authorization chain
     * AND the candidate profile (by `userId === ctx.actorId`) AND that
     * candidate's enrollment for this exam. The eligibility capability
     * preHandler uses it to authorize candidate exam detail / queue / start
     * without role-name branching: the actor must (a) resolve a candidate
     * profile under the org anchor, (b) have an enrollment for this exam.
     *
     * Cross-candidate probing (exam exists under the org anchor but the actor
     * has no profile / no enrollment) is mapped by the resolver to
     * `resource_not_found` (404), preserving the anti-enumeration invariant
     * proven by `candidateOwnership.test.ts`. Org/chain inconsistency stays 403.
     *
     * The candidate profile is LEFT JOINed so a non-candidate actor (no
     * profile) still resolves the exam chain for an org-anchor verdict; the
     * enrollment is LEFT JOINed onto (candidateProfile.id, examId) so a missing
     * enrollment surfaces as `enrollmentId: null` rather than dropping the row.
     */
    async findCandidateEligibilityChain(
      ctx: TenantContext | RequestContext,
      examId: string,
      userId: string,
    ) {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select({
          examId: exams.id,
          examOrganizationId: exams.organizationId,
          linkedCourseId: exams.courseId,
          courseId: courses.id,
          courseOrganizationId: courses.organizationId,
          organizationId: organizations.id,
          candidateProfileId: candidateProfiles.id,
          candidateProfileOrganizationId: candidateProfiles.organizationId,
          ownerUserId: candidateProfiles.userId,
          enrollmentId: examEnrollments.id,
          enrollmentOrganizationId: examEnrollments.organizationId,
        })
        .from(exams)
        .leftJoin(courses, eq(exams.courseId, courses.id))
        .leftJoin(organizations, eq(courses.organizationId, organizations.id))
        .leftJoin(
          candidateProfiles,
          and(
            eq(candidateProfiles.organizationId, orgId),
            eq(candidateProfiles.userId, userId),
          ),
        )
        .leftJoin(
          examEnrollments,
          and(
            eq(examEnrollments.organizationId, orgId),
            eq(examEnrollments.examId, exams.id),
            eq(examEnrollments.candidateId, candidateProfiles.id),
          ),
        )
        .where(and(eq(exams.organizationId, orgId), eq(exams.id, examId)))
        .limit(1);
      return rows[0] ?? null;
    },
    /**
     * Finds an exam by `id` with `FOR UPDATE` row lock, scoped to the tenant.
     *
     * ADR-005 construction hard rule: every admin operation (close, extend,
     * unpublish, archive, ...) must lock the exam row before reconciling and
     * mutating, so no concurrent admin op or scanner races the decision.
     */
    async findByIdForUpdate(
      ctx: TenantContext | RequestContext,
      examId: string,
    ): Promise<ExamSelect | null> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select()
        .from(exams)
        .for("update")
        .where(and(eq(exams.organizationId, orgId), eq(exams.id, examId)));
      return (rows[0] as ExamSelect | undefined) ?? null;
    },
  };
}
