import type { Database } from "../types.js";
import { pgNum } from "../types.js";
import {
  examAttempts,
  candidateProfiles,
  users,
  exams,
  courses,
  organizations,
} from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
} from "./baseRepo.js";
import { resolveOrganizationId } from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm";

type AttemptSelect = typeof examAttempts.$inferSelect;
type CandidateSelect = typeof candidateProfiles.$inferSelect;
type UserSelect = typeof users.$inferSelect;

/**
 * Creates the exam attempt repository with CRUD plus lookup methods
 * for finding attempts by enrollment, candidate, and status.
 * @param db - Database instance.
 */
export function createAttemptRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, examAttempts);

  return {
    ...repo,
    async findAuthorizationChain(
      ctx: TenantContext | RequestContext,
      attemptId: string,
    ) {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select({
          attemptId: examAttempts.id,
          attemptOrganizationId: examAttempts.organizationId,
          linkedExamId: examAttempts.examId,
          examId: exams.id,
          examOrganizationId: exams.organizationId,
          linkedCourseId: exams.courseId,
          courseId: courses.id,
          courseOrganizationId: courses.organizationId,
          organizationId: organizations.id,
        })
        .from(examAttempts)
        .leftJoin(exams, eq(examAttempts.examId, exams.id))
        .leftJoin(courses, eq(exams.courseId, courses.id))
        .leftJoin(organizations, eq(courses.organizationId, organizations.id))
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.id, attemptId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    /**
     * Score-authorization ownership chain (RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1).
     *
     * Extends {@link findAuthorizationChain} with the attempt's candidate +
     * candidate-user identity, so the score capability preHandler can arbitrate
     * `score.own.view` (requires `attempt.candidateProfile.userId === actorId`)
     * vs `score.all.view` (org-scoped, any attempt) without role-name branching.
     *
     * Source of truth per ADR §Resource Resolver Matrix: `score → attempt →
     * candidate + exam`; the ownership fact is `candidateProfiles.userId`.
     */
    async findScoreOwnershipChain(
      ctx: TenantContext | RequestContext,
      attemptId: string,
    ) {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select({
          attemptId: examAttempts.id,
          attemptOrganizationId: examAttempts.organizationId,
          candidateId: examAttempts.candidateId,
          ownerUserId: candidateProfiles.userId,
          linkedExamId: examAttempts.examId,
          examId: exams.id,
          examOrganizationId: exams.organizationId,
          linkedCourseId: exams.courseId,
          courseId: courses.id,
          courseOrganizationId: courses.organizationId,
          organizationId: organizations.id,
        })
        .from(examAttempts)
        .leftJoin(
          candidateProfiles,
          eq(examAttempts.candidateId, candidateProfiles.id),
        )
        .leftJoin(exams, eq(examAttempts.examId, exams.id))
        .leftJoin(courses, eq(exams.courseId, courses.id))
        .leftJoin(organizations, eq(courses.organizationId, organizations.id))
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.id, attemptId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    /**
     * Finds an attempt by `id` with `FOR UPDATE` row lock, scoped to the tenant.
     * Used for optimistic concurrency during answer saves and submissions.
     */
    async findByIdForUpdate(
      ctx: TenantContext | RequestContext,
      attemptId: string,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examAttempts)
        .for("update")
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.id, attemptId),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    /**
     * Finds the most recent active attempt (in_progress or disrupted) for a
     * given enrollment, scoped to the tenant.
     */
    async findActiveByEnrollment(
      ctx: TenantContext | RequestContext,
      enrollmentId: string,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examAttempts)
        .for("update")
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.enrollmentId, enrollmentId),
            inArray(examAttempts.status, ["in_progress", "disrupted"]),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    /**
     * Finds an attempt by enrollment ID and attempt number, scoped to the tenant.
     */
    async findByEnrollmentAndAttemptNo(
      ctx: TenantContext | RequestContext,
      enrollmentId: string,
      attemptNo: number,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.enrollmentId, enrollmentId),
            eq(examAttempts.attemptNo, attemptNo),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    /**
     * Finds all attempts for a given exam and candidate, scoped to the tenant.
     */
    async findByExamAndCandidate(
      ctx: TenantContext | RequestContext,
      examId: string,
      candidateId: string,
    ): Promise<AttemptSelect[]> {
      const orgId = resolveOptionalOrganizationId(ctx);
      return (await db
        .select()
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.examId, examId),
            eq(examAttempts.candidateId, candidateId),
          ),
        )) as AttemptSelect[];
    },
    /**
     * Finds a specific attempt by ID and candidate profile ID, scoped to the tenant.
     */
    async findByIdAndCandidate(
      ctx: TenantContext | RequestContext,
      attemptId: string,
      candidateId: string,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.id, attemptId),
            eq(examAttempts.candidateId, candidateId),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    /**
     * Finds the most recent active attempt (in_progress or disrupted) for a
     * specific exam and candidate, scoped to the tenant.
     */
    async findActiveByExamAndCandidate(
      ctx: TenantContext | RequestContext,
      examId: string,
      candidateId: string,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.examId, examId),
            eq(examAttempts.candidateId, candidateId),
            inArray(examAttempts.status, ["in_progress", "disrupted"]),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    /**
     * Lists all in-progress attempts across the tenant organization.
     * Used by heartbeat scanning and proctoring.
     */
    async listInProgress(
      ctx: TenantContext | RequestContext,
    ): Promise<AttemptSelect[]> {
      const orgId = resolveOptionalOrganizationId(ctx);
      return (await db
        .select()
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.status, "in_progress"),
          ),
        )) as AttemptSelect[];
    },
    /**
     * DEADLINE SCANNER CANDIDATE DISCOVERY (DERIVED, NOT AUTHORITY).
     *
     * Returns in_progress/disrupted attempts that are CANDIDATES for deadline
     * auto-submission. The predicate mirrors the canonical
     * `computeEffectiveDeadline` expiry decision EXACTLY over the full
     * scanner-eligible domain (reachable + defensive NULL):
     *
     *   exam.closeAt <= now
     *   OR
     *   (attempt.deadlineAt IS NOT NULL AND attempt.deadlineAt <= now)
     *
     * REACHABILITY BOUNDARY (P0-C1): the `exam.closeAt <= now` arm is the
     * DEFENSIVE recovery coverage for schema-admissible NULL `deadlineAt`
     * rows — NOT evidence of a Phase-1 timing mode in which active attempts
     * normally carry a NULL deadline. The reachable-domain invariant
     * (ACTIVE-DEADLINE-001) is that every protocol-reachable active attempt
     * has a non-null `deadlineAt`; ordinary production always writes one at
     * attempt creation. Discovery therefore agrees with the canonical
     * `isAttemptDeadlineExpired` seam over BOTH domains so that a legacy /
     * corrupt / historical NULL row whose exam window has closed cannot stay
     * active forever — but that row is a defensive-recovery state, not a
     * valid protocol timing state.
     *
     * The OR-with-exam-closeAt arm also catches an attempt whose per-attempt
     * deadlineAt is still in the future but whose exam window has closed — the
     * divergence bug fixed alongside this query (P0-B).
     *
     * This query is CANDIDATE DISCOVERY ONLY. The authoritative expiry
     * decision is `isAttemptDeadlineExpired` (exam-engine), re-evaluated by
     * the scanner under `Attempt FOR UPDATE` + authoritative `Exam FOR UPDATE`
     * read. A candidate returned here MUST NOT be auto-submitted without that
     * under-lock recheck (it may have been extended, reconciled, or be a stale
     * snapshot).
     *
     * Renamed from listExpirableByDeadline to reflect its candidate-discovery
     * role, not protocol authority.
     */
    async listDeadlineCandidates(
      ctx: TenantContext | RequestContext,
      before: Date,
    ): Promise<AttemptSelect[]> {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select({ attempt: examAttempts })
        .from(examAttempts)
        .innerJoin(exams, eq(examAttempts.examId, exams.id))
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            inArray(examAttempts.status, ["in_progress", "disrupted"]),
            or(
              lte(exams.closeAt, before),
              and(
                isNotNull(examAttempts.deadlineAt),
                lte(examAttempts.deadlineAt, before),
              ),
            ),
          ),
        );
      return rows.map((r) => r.attempt) as AttemptSelect[];
    },
    /**
     * Lists ALL attempts for a given exam, joined with candidate profiles and
     * users to include candidate name. Unlike listGradedByExam, this returns
     * attempts in ANY status (not just graded). Used by the proctor dashboard
     * status aggregation (P2C-J5).
     */
    async listByExam(ctx: TenantContext | RequestContext, examId: string) {
      const orgId = resolveOptionalOrganizationId(ctx);
      return (await db
        .select({
          attempt: examAttempts,
          candidateProfile: candidateProfiles,
          candidateUser: users,
        })
        .from(examAttempts)
        .innerJoin(
          candidateProfiles,
          eq(examAttempts.candidateId, candidateProfiles.id),
        )
        .innerJoin(users, eq(candidateProfiles.userId, users.id))
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.examId, examId),
            eq(candidateProfiles.organizationId, orgId),
            eq(users.organizationId, orgId),
          ),
        )) as {
        attempt: AttemptSelect;
        candidateProfile: CandidateSelect;
        candidateUser: UserSelect;
      }[];
    },

    /**
     * Lists graded attempts for an exam with optional pass/fail filter,
     * sorting, and pagination. Joins with candidate profiles and users
     * to include candidate name.
     */
    async listGradedByExam(
      ctx: TenantContext | RequestContext,
      examId: string,
      options: {
        passFilter?: "all" | "passed" | "failed";
        sortBy?: "score" | "submittedAt" | "candidateName";
        sortOrder?: "asc" | "desc";
        limit?: number;
        offset?: number;
      } = {},
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      let baseWhere = and(
        eq(examAttempts.organizationId, orgId),
        eq(examAttempts.examId, examId),
        eq(examAttempts.status, "graded"),
        isNotNull(examAttempts.score),
      );

      if (options.passFilter === "passed") {
        baseWhere = and(baseWhere, eq(examAttempts.passed, true));
      } else if (options.passFilter === "failed") {
        baseWhere = and(baseWhere, eq(examAttempts.passed, false));
      }

      type GradedRow = {
        attempt: AttemptSelect;
        candidateProfile: CandidateSelect;
        candidateUser: UserSelect;
      };

      const allResults = (await db
        .select({
          attempt: examAttempts,
          candidateProfile: candidateProfiles,
          candidateUser: users,
        })
        .from(examAttempts)
        .innerJoin(
          candidateProfiles,
          eq(examAttempts.candidateId, candidateProfiles.id),
        )
        .innerJoin(users, eq(candidateProfiles.userId, users.id))
        .where(baseWhere)) as GradedRow[];

      return sortAndPaginateGraded(allResults, options);
    },
    /**
     * Returns aggregate statistics (count, avg, max, min, pass rate) for
     * graded attempts on a given exam, scoped to the tenant.
     */
    async getGradedStats(ctx: TenantContext | RequestContext, examId: string) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const baseWhere = and(
        eq(examAttempts.organizationId, orgId),
        eq(examAttempts.examId, examId),
        eq(examAttempts.status, "graded"),
        isNotNull(examAttempts.score),
      );

      type StatsRow = {
        count: number;
        avg: number | null;
        max: number | null;
        min: number | null;
        passed: number | null;
      };

      const rows = await db
        .select({
          count: sql<number>`count(*)`,
          avg: sql<number | null>`avg(${examAttempts.score})`,
          max: sql<number | null>`max(${examAttempts.score})`,
          min: sql<number | null>`min(${examAttempts.score})`,
          passed: sql<
            number | null
          >`sum(case when ${examAttempts.passed} = true then 1 else 0 end)`,
        })
        .from(examAttempts)
        .where(baseWhere);
      return buildStats(rows[0] as StatsRow);
    },
    /**
     * Counts graded attempts for an exam with optional pass/fail filter,
     * scoped to the tenant.
     */
    async countGradedByExam(
      ctx: TenantContext | RequestContext,
      examId: string,
      options: {
        passFilter?: "all" | "passed" | "failed";
      } = {},
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      let baseWhere = and(
        eq(examAttempts.organizationId, orgId),
        eq(examAttempts.examId, examId),
        eq(examAttempts.status, "graded"),
        isNotNull(examAttempts.score),
      );

      if (options.passFilter === "passed") {
        baseWhere = and(baseWhere, eq(examAttempts.passed, true));
      } else if (options.passFilter === "failed") {
        baseWhere = and(baseWhere, eq(examAttempts.passed, false));
      }

      const rows = await db
        .select({ count: sql<number>`count(*)` })
        .from(examAttempts)
        .where(baseWhere);
      return pgNum((rows[0] as { count: number }).count);
    },

    /**
     * Counts unresolved (not-yet-finalized) attempts for an exam, scoped to
     * the tenant. Used by the admin close guard (ADR-005 Slice 1 §3.3) and
     * the scores/export guard (§Close & export policy): an exam may not close
     * and results may not be exported while unresolved attempts remain.
     *
     * Unresolved = not in a finalized state (`graded` / `voided`).
     */
    async countUnresolvedByExam(
      ctx: TenantContext | RequestContext,
      examId: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select({ count: sql<number>`count(*)` })
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.examId, examId),
            inArray(examAttempts.status, [
              "queued",
              "in_progress",
              "disrupted",
              "submitted",
              "grading",
            ]),
          ),
        );
      return pgNum((rows[0] as { count: number }).count);
    },
  };
}

/** Sorts and paginates joined graded-attempt results in memory. */
function sortAndPaginateGraded(
  allResults: Array<{
    attempt: AttemptSelect;
    candidateProfile: CandidateSelect;
    candidateUser: UserSelect;
  }>,
  options: {
    sortBy?: "score" | "submittedAt" | "candidateName";
    sortOrder?: "asc" | "desc";
    limit?: number;
    offset?: number;
  },
) {
  const sortBy = options.sortBy ?? "submittedAt";
  const sortDir = options.sortOrder === "asc" ? 1 : -1;
  allResults.sort((a, b) => {
    if (sortBy === "score") {
      return ((a.attempt.score ?? 0) - (b.attempt.score ?? 0)) * sortDir;
    }
    if (sortBy === "candidateName") {
      return a.candidateUser.name.localeCompare(b.candidateUser.name) * sortDir;
    }
    const aTime = a.attempt.submittedAt?.getTime() ?? 0;
    const bTime = b.attempt.submittedAt?.getTime() ?? 0;
    return (aTime - bTime) * sortDir;
  });

  const offset = options.offset ?? 0;
  const limit = options.limit;
  if (limit != null) {
    return allResults.slice(offset, offset + limit);
  }
  return allResults.slice(offset);
}

/** Builds a stats summary from raw aggregate query results. */
function buildStats(result: {
  count: number;
  avg: number | null;
  max: number | null;
  min: number | null;
  passed: number | null;
}) {
  const count = pgNum(result.count);
  const passed = pgNum(result.passed);
  const built = {
    totalGraded: count,
    averageScore: pgNum(result.avg),
    maxScore: pgNum(result.max),
    minScore: pgNum(result.min),
    passRate: count > 0 ? passed / count : 0,
  };
  return built;
}
