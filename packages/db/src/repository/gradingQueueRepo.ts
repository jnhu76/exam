import type { Database } from "../types.js";
import { exams, candidateProfiles, users } from "../schema/pg.js";
import { resolveOrganizationId } from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

type ExamSelect = typeof exams.$inferSelect;
type CandidateSelect = typeof candidateProfiles.$inferSelect;
type UserSelect = typeof users.$inferSelect;

/**
 * Creates a repository for grading-queue specific queries that join
 * attempts with exams, candidates, and manual-grading entries.
 *
 * Keeps the route layer free of schema imports.
 */
export function createGradingQueueRepo(db: Database) {
  return {
    /**
     * Finds an exam by ID, scoped to the tenant.
     */
    async findExamById(
      ctx: TenantContext | RequestContext,
      examId: string,
    ): Promise<ExamSelect | null> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select()
        .from(exams)
        .where(and(eq(exams.organizationId, orgId), eq(exams.id, examId)));
      return (rows[0] as ExamSelect | undefined) ?? null;
    },

    /**
     * Finds a candidate profile with joined user data, scoped to the tenant.
     */
    async findCandidateWithUser(
      ctx: TenantContext | RequestContext,
      candidateId: string,
    ): Promise<{ profile: CandidateSelect; user: UserSelect } | null> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select({
          profile: candidateProfiles,
          user: users,
        })
        .from(candidateProfiles)
        .innerJoin(users, eq(candidateProfiles.userId, users.id))
        .where(
          and(
            eq(candidateProfiles.organizationId, orgId),
            eq(candidateProfiles.id, candidateId),
            // Same-org predicate on the User join: candidate_profiles.user_id
            // is a global FK, so a caller-org profile can reference another
            // org's User. Without it the join projects the foreign user's
            // name and password hash into the caller's process.
            eq(users.organizationId, orgId),
          ),
        );
      return (
        (rows[0] as
          | { profile: CandidateSelect; user: UserSelect }
          | undefined) ?? null
      );
    },
  };
}
