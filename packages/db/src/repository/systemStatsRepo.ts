import type { RequestContext } from "@exam/domain";
import { and, eq, gte } from "drizzle-orm";
import type { Database } from "../types.js";
import { schema } from "../schema/pg.js";

export interface DashboardStats {
  totalQuestions: number;
  activeExams: number;
  totalCandidates: number;
  todayAttempts: number;
}

export interface RecentExam {
  id: string;
  title: string;
  status: string;
  participantCount: number;
}

export interface DashboardData extends DashboardStats {
  recentExams: RecentExam[];
}

function getOrgId(ctx: RequestContext): string {
  return ctx.organizationId;
}

export function createSystemStatsRepo(db: Database) {
  return {
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
