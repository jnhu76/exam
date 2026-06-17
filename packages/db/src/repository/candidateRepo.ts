import type { Database } from "../types.js";
import { candidateProfiles } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

/** Creates a tenant-scoped CRUD repository for `candidateProfiles` with user lookup. */
export function createCandidateRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, candidateProfiles);

  return {
    ...repo,
    /**
     * Finds a candidate profile by the associated user ID, scoped to the tenant.
     */
    async findByUserId(ctx: TenantContext | RequestContext, userId: string) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(candidateProfiles)
        .where(
          and(
            eq(candidateProfiles.organizationId, orgId),
            eq(candidateProfiles.userId, userId),
          ),
        );
      return (
        (rows[0] as typeof candidateProfiles.$inferSelect | undefined) ?? null
      );
    },
  };
}
