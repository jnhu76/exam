import type { RequestContext } from "@exam/domain";
import { and, eq, gte } from "drizzle-orm";
import type { Database } from "../types.js";
import { schema } from "../schema/pg.js";

/** Aggregate dashboard statistics for the organization. */
export interface DashboardStats {
  totalQuestions: number;
  activeExams: number;
  totalCandidates: number;
  todayAttempts: number;
}

/** Summary of a recent exam for dashboard display. */
export interface RecentExam {
  id: string;
  title: string;
  status: string;
  participantCount: number;
}

/** Dashboard data combining stats and recent exams. */
export interface DashboardData extends DashboardStats {
  recentExams: RecentExam[];
}

/** Extracts `organizationId` from request context. */
function getOrgId(ctx: RequestContext): string {
  return ctx.organizationId;
}

/** Creates a repository for dashboard statistics and health checks. */
export function createSystemStatsRepo(db: Database) {
  return {
    /**
     * Returns aggregate dashboard stats: total questions, active (open) exams,
     * total candidate profiles, and today's started attempts, all scoped to the tenant.
     */
    async getDashboardStats(ctx: RequestContext): Promise<DashboardStats> {
      const orgId = getOrgId(ctx);

      const totalQuestions = (
        await db
          .select({ id: schema.questions.id })
          .from(schema.questions)
          .where(eq(schema.questions.organizationId, orgId))
      ).length;

      const activeExams = (
        await db
          .select({ id: schema.exams.id })
          .from(schema.exams)
          .where(
            and(
              eq(schema.exams.organizationId, orgId),
              eq(schema.exams.status, "open"),
            ),
          )
      ).length;

      const totalCandidates = (
        await db
          .select({ id: schema.candidateProfiles.id })
          .from(schema.candidateProfiles)
          .where(eq(schema.candidateProfiles.organizationId, orgId))
      ).length;

      // ADR-006: reporting/dashboard day-boundary only — NOT exam business time.
      // This is allowed under the time-authority allowlist strictly because it is
      // a non-authoritative reporting bucket, but it has stronger semantics than
      // baseRepo's storage stamp, so it carries a TODO:
      //   1. reporting/dashboard only;
      //   2. NOT used for exam lifecycle / deadline / submit / score-export gate;
      //   3. NOT authoritative for candidate/admin runtime decisions;
      //   4. TODO: future cleanup should derive startOfDay from APP_TIMEZONE or
      //      the organization's timezone explicitly instead of the process wall
      //      clock + local-date arithmetic.
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const todayAttempts = (
        await db
          .select({ id: schema.examAttempts.id })
          .from(schema.examAttempts)
          .where(
            and(
              eq(schema.examAttempts.organizationId, orgId),
              gte(schema.examAttempts.startedAt, startOfDay),
            ),
          )
      ).length;

      return { totalQuestions, activeExams, totalCandidates, todayAttempts };
    },

    /**
     * Returns the 10 most recent exams for the tenant, with `participantCount`
     * set to 0 (placeholder — enrollment count not yet computed).
     */
    async getRecentExams(ctx: RequestContext): Promise<RecentExam[]> {
      const orgId = getOrgId(ctx);

      const rows = await db
        .select({
          id: schema.exams.id,
          title: schema.exams.title,
          status: schema.exams.status,
        })
        .from(schema.exams)
        .where(eq(schema.exams.organizationId, orgId))
        .limit(10);
      return rows.map((exam) => ({ ...exam, participantCount: 0 }));
    },

    /**
     * Pings the database with a lightweight query and returns the round-trip
     * time in milliseconds (to two decimal places).
     */
    async pingDb(): Promise<number> {
      const start = performance.now();
      await db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .limit(1);
      return Math.round((performance.now() - start) * 100) / 100;
    },
  };
}
