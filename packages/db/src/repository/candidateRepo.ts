import type { AnyDatabase, PostgresDatabase } from "../types.js";
import { isSqlite } from "../types.js";
import { candidateProfiles as sqliteCandidateProfiles } from "../schema/sqlite.js";
import { candidateProfiles as pgCandidateProfiles } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

export function createCandidateRepo(db: AnyDatabase) {
  const repo = createAsyncTenantCrudRepo(db, {
    sqlite: sqliteCandidateProfiles,
    pg: pgCandidateProfiles,
  });

  return {
    ...repo,
    async findByUserId(ctx: TenantContext | RequestContext, userId: string) {
      const orgId = resolveOptionalOrganizationId(ctx);
      if (isSqlite(db)) {
        return (
          (db
            .select()
            .from(sqliteCandidateProfiles)
            .where(
              and(
                eq(sqliteCandidateProfiles.organizationId, orgId),
                eq(sqliteCandidateProfiles.userId, userId),
              ),
            )
            .get() as
            | typeof sqliteCandidateProfiles.$inferSelect
            | undefined) ?? null
        );
      }
      const rows = await (db as PostgresDatabase)
        .select()
        .from(pgCandidateProfiles)
        .where(
          and(
            eq(pgCandidateProfiles.organizationId, orgId),
            eq(pgCandidateProfiles.userId, userId),
          ),
        );
      return (
        (rows[0] as typeof sqliteCandidateProfiles.$inferSelect | undefined) ??
        null
      );
    },
  };
}
