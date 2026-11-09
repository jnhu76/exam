import type { Database } from "../types.js";
import { examEnrollments } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
  type TenantCrudUpdateInput,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

type EnrollmentSelect = typeof examEnrollments.$inferSelect;

/**
 * Non-lifecycle update input for the `exam_enrollments` row (EXSEM-014).
 * `status` is the enrollment lifecycle state: it is written only by the
 * engine command funnel through {@link createEnrollmentRepo}'s
 * `updateIncludingLifecycleState` seam, never through `update`.
 */
type EnrollmentUpdateInput = Omit<
  TenantCrudUpdateInput<typeof examEnrollments>,
  "status" | "gradingStatus"
>;

/** Creates a tenant-scoped CRUD repository for `examEnrollments` with candidate/exam lookups. */
export function createEnrollmentRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, examEnrollments);

  return {
    ...repo,
    /**
     * EXSEM-014: input excludes the lifecycle column `status`. Lifecycle
     * transitions run through the engine command funnel
     * (`updateIncludingLifecycleState`); this override forwards to it for
     * non-lifecycle fields only.
     */
    update(
      ctx: TenantContext | RequestContext,
      enrollmentId: string,
      input: EnrollmentUpdateInput,
    ) {
      return repo.update(ctx, enrollmentId, input);
    },
    /** Finds an enrollment by ID and locks it for a transactional mutation. */
    async findByIdForUpdate(
      ctx: TenantContext | RequestContext,
      enrollmentId: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examEnrollments)
        .for("update")
        .where(
          and(
            eq(examEnrollments.organizationId, orgId),
            eq(examEnrollments.id, enrollmentId),
          ),
        )
        .limit(1);
      return (rows[0] as EnrollmentSelect | undefined) ?? null;
    },
    /**
     * Finds an enrollment by exam and candidate profile ID, scoped to the tenant.
     */
    async findByExamAndCandidate(
      ctx: TenantContext | RequestContext,
      examId: string,
      candidateId: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examEnrollments)
        .where(
          and(
            eq(examEnrollments.organizationId, orgId),
            eq(examEnrollments.examId, examId),
            eq(examEnrollments.candidateId, candidateId),
          ),
        );
      return (
        (rows[0] as typeof examEnrollments.$inferSelect | undefined) ?? null
      );
    },
    /**
     * Finds an enrollment by exam and candidate with `FOR UPDATE` row lock,
     * scoped to the tenant. Used for concurrency-safe enrollment updates.
     */
    async findByExamAndCandidateForUpdate(
      ctx: TenantContext | RequestContext,
      examId: string,
      candidateId: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examEnrollments)
        .for("update")
        .where(
          and(
            eq(examEnrollments.organizationId, orgId),
            eq(examEnrollments.examId, examId),
            eq(examEnrollments.candidateId, candidateId),
          ),
        );
      return (
        (rows[0] as typeof examEnrollments.$inferSelect | undefined) ?? null
      );
    },
    /**
     * Lists all enrollments for a given candidate profile, scoped to the tenant.
     */
    async findByCandidate(
      ctx: TenantContext | RequestContext,
      candidateId: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      return (await db
        .select()
        .from(examEnrollments)
        .where(
          and(
            eq(examEnrollments.organizationId, orgId),
            eq(examEnrollments.candidateId, candidateId),
          ),
        )) as EnrollmentSelect[];
    },

    /**
     * Lists all enrollments for a given exam, scoped to the tenant.
     * Replaces route-level list(ctx).filter() pattern.
     */
    async listByExam(
      ctx: TenantContext | RequestContext,
      examId: string,
    ): Promise<EnrollmentSelect[]> {
      const orgId = resolveOptionalOrganizationId(ctx);
      return (await db
        .select()
        .from(examEnrollments)
        .where(
          and(
            eq(examEnrollments.organizationId, orgId),
            eq(examEnrollments.examId, examId),
          ),
        )) as EnrollmentSelect[];
    },
  };
}
