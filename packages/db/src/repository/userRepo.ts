import type { AnyDatabase, PostgresDatabase } from "../types.js";
import { isSqlite } from "../types.js";
import { users as sqliteUsers } from "../schema/sqlite.js";
import { users as pgUsers } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

export function createUserRepo(db: AnyDatabase) {
  const repo = createAsyncTenantCrudRepo(db, {
    sqlite: sqliteUsers,
    pg: pgUsers,
  });

  return {
    ...repo,
    async findByOrganizationAndUsername(
      ctx: TenantContext | RequestContext,
      username: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      if (isSqlite(db)) {
        return (
          (db
            .select()
            .from(sqliteUsers)
            .where(
              and(
                eq(sqliteUsers.organizationId, orgId),
                eq(sqliteUsers.username, username),
              ),
            )
            .get() as typeof sqliteUsers.$inferSelect | undefined) ?? null
        );
      }
      const rows = await (db as PostgresDatabase)
        .select()
        .from(pgUsers)
        .where(
          and(
            eq(pgUsers.organizationId, orgId),
            eq(pgUsers.username, username),
          ),
        );
      return (rows[0] as typeof sqliteUsers.$inferSelect | undefined) ?? null;
    },
    async findByOrganizationAndId(
      ctx: TenantContext | RequestContext,
      id: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      if (isSqlite(db)) {
        return (
          (db
            .select()
            .from(sqliteUsers)
            .where(
              and(
                eq(sqliteUsers.organizationId, orgId),
                eq(sqliteUsers.id, id),
              ),
            )
            .get() as typeof sqliteUsers.$inferSelect | undefined) ?? null
        );
      }
      const rows = await (db as PostgresDatabase)
        .select()
        .from(pgUsers)
        .where(and(eq(pgUsers.organizationId, orgId), eq(pgUsers.id, id)));
      return (rows[0] as typeof sqliteUsers.$inferSelect | undefined) ?? null;
    },
  };
}
