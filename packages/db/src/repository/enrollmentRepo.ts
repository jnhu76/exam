import type { AnyDatabase, PostgresDatabase } from "../types.js";
import { isSqlite } from "../types.js";
import { examEnrollments as sqliteExamEnrollments } from "../schema/sqlite.js";
import { examEnrollments as pgExamEnrollments } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

export function createEnrollmentRepo(db: AnyDatabase) {
  const repo = createAsyncTenantCrudRepo(db, {
    sqlite: sqliteExamEnrollments,
    pg: pgExamEnrollments,
  });

  return {
    ...repo,
    async findByExamAndCandidate(
      ctx: TenantContext | RequestContext,
      examId: string,
      candidateId: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      if (isSqlite(db)) {
        return (
          (db
            .select()
            .from(sqliteExamEnrollments)
            .where(
              and(
                eq(sqliteExamEnrollments.organizationId, orgId),
                eq(sqliteExamEnrollments.examId, examId),
                eq(sqliteExamEnrollments.candidateId, candidateId),
              ),
            )
            .get() as typeof sqliteExamEnrollments.$inferSelect | undefined) ??
          null
        );
      }
      const rows = await (db as PostgresDatabase)
        .select()
        .from(pgExamEnrollments)
        .where(
          and(
            eq(pgExamEnrollments.organizationId, orgId),
            eq(pgExamEnrollments.examId, examId),
            eq(pgExamEnrollments.candidateId, candidateId),
          ),
        );
      return (
        (rows[0] as typeof sqliteExamEnrollments.$inferSelect | undefined) ??
        null
      );
    },
    async findByCandidate(
      ctx: TenantContext | RequestContext,
      candidateId: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      if (isSqlite(db)) {
        return db
          .select()
          .from(sqliteExamEnrollments)
          .where(
            and(
              eq(sqliteExamEnrollments.organizationId, orgId),
              eq(sqliteExamEnrollments.candidateId, candidateId),
            ),
          )
          .all() as (typeof sqliteExamEnrollments.$inferSelect)[];
      }
      return (await (db as PostgresDatabase)
        .select()
        .from(pgExamEnrollments)
        .where(
          and(
            eq(pgExamEnrollments.organizationId, orgId),
            eq(pgExamEnrollments.candidateId, candidateId),
          ),
        )) as (typeof sqliteExamEnrollments.$inferSelect)[];
    },
  };
}
