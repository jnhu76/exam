import type { Database } from "../types.js";
import { users } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

export function createUserRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, users);

  return {
    ...repo,
    async findByOrganizationAndUsername(
      ctx: TenantContext | RequestContext,
      username: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(users)
        .where(
          and(eq(users.organizationId, orgId), eq(users.username, username)),
        );
      return (rows[0] as typeof users.$inferSelect | undefined) ?? null;
    },
    async findByOrganizationAndId(
      ctx: TenantContext | RequestContext,
      id: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(users)
        .where(and(eq(users.organizationId, orgId), eq(users.id, id)));
      return (rows[0] as typeof users.$inferSelect | undefined) ?? null;
    },
  };
}
