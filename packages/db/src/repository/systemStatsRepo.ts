import type { RequestContext } from "@exam/domain";
import { and, eq, gte } from "drizzle-orm";
import type { AnyDatabase, PostgresDatabase } from "../types.js";
import type { SqliteDatabase } from "../types.js";
import { isSqlite } from "../types.js";
import { sqliteSchema } from "../schema/sqlite.js";
import { pgSchema } from "../schema/pg.js";

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
  if (ctx.role === "SuperAdmin") {
    return ctx.targetOrganizationId ?? ctx.organizationId;
  }
  return ctx.organizationId;
}

export function createSystemStatsRepo(db: AnyDatabase) {
  return {
    async getDashboardStats(ctx: RequestContext): Promise<DashboardStats> {
      const orgId = getOrgId(ctx);

      if (isSqlite(db)) {
        const s = db as SqliteDatabase;
        const totalQuestions = s
          .select({ id: sqliteSchema.questions.id })
          .from(sqliteSchema.questions)
          .where(eq(sqliteSchema.questions.organizationId, orgId))
          .all().length;

        const activeExams = s
          .select({ id: sqliteSchema.exams.id })
          .from(sqliteSchema.exams)
          .where(
            and(
              eq(sqliteSchema.exams.organizationId, orgId),
              eq(sqliteSchema.exams.status, "open"),
            ),
          )
          .all().length;

        const totalCandidates = s
          .select({ id: sqliteSchema.candidateProfiles.id })
          .from(sqliteSchema.candidateProfiles)
          .where(eq(sqliteSchema.candidateProfiles.organizationId, orgId))
          .all().length;

        const now = new Date();
        const startOfDay = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        const todayAttempts = s
          .select({ id: sqliteSchema.examAttempts.id })
          .from(sqliteSchema.examAttempts)
          .where(
            and(
              eq(sqliteSchema.examAttempts.organizationId, orgId),
              gte(sqliteSchema.examAttempts.startedAt, startOfDay),
            ),
          )
          .all().length;

        return { totalQuestions, activeExams, totalCandidates, todayAttempts };
      }

      const p = db as PostgresDatabase;
      const totalQuestions = (
        await p
          .select({ id: pgSchema.questions.id })
          .from(pgSchema.questions)
          .where(eq(pgSchema.questions.organizationId, orgId))
      ).length;

      const activeExams = (
        await p
          .select({ id: pgSchema.exams.id })
          .from(pgSchema.exams)
          .where(
            and(
              eq(pgSchema.exams.organizationId, orgId),
              eq(pgSchema.exams.status, "open"),
            ),
          )
      ).length;

      const totalCandidates = (
        await p
          .select({ id: pgSchema.candidateProfiles.id })
          .from(pgSchema.candidateProfiles)
          .where(eq(pgSchema.candidateProfiles.organizationId, orgId))
      ).length;

      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const todayAttempts = (
        await p
          .select({ id: pgSchema.examAttempts.id })
          .from(pgSchema.examAttempts)
          .where(
            and(
              eq(pgSchema.examAttempts.organizationId, orgId),
              gte(pgSchema.examAttempts.startedAt, startOfDay),
            ),
          )
      ).length;

      return { totalQuestions, activeExams, totalCandidates, todayAttempts };
    },

    async getRecentExams(ctx: RequestContext): Promise<RecentExam[]> {
      const orgId = getOrgId(ctx);

      if (isSqlite(db)) {
        const s = db as SqliteDatabase;
        return s
          .select({
            id: sqliteSchema.exams.id,
            title: sqliteSchema.exams.title,
            status: sqliteSchema.exams.status,
          })
          .from(sqliteSchema.exams)
          .where(eq(sqliteSchema.exams.organizationId, orgId))
          .limit(10)
          .all()
          .map((exam) => ({ ...exam, participantCount: 0 }));
      }

      const p = db as PostgresDatabase;
      const rows = await p
        .select({
          id: pgSchema.exams.id,
          title: pgSchema.exams.title,
          status: pgSchema.exams.status,
        })
        .from(pgSchema.exams)
        .where(eq(pgSchema.exams.organizationId, orgId))
        .limit(10);
      return rows.map((exam) => ({ ...exam, participantCount: 0 }));
    },

    async pingDb(): Promise<number> {
      const start = performance.now();
      if (isSqlite(db)) {
        const s = db as SqliteDatabase;
        s.select({ id: sqliteSchema.organizations.id })
          .from(sqliteSchema.organizations)
          .limit(1)
          .get();
      } else {
        const p = db as PostgresDatabase;
        await p
          .select({ id: pgSchema.organizations.id })
          .from(pgSchema.organizations)
          .limit(1);
      }
      return Math.round((performance.now() - start) * 100) / 100;
    },
  };
}
