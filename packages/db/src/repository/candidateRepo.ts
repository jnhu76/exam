import type { SqliteDatabase } from "../sqlite.js";
import { candidateProfiles } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

export function createCandidateRepo(db: SqliteDatabase) {
  const repo = createTenantCrudRepo(db, candidateProfiles);

  return {
    ...repo,
    findByUserId(ctx: RequestContext, userId: string) {
      const orgId = ctx.targetOrganizationId ?? ctx.organizationId;
      return (
        (db
          .select()
          .from(candidateProfiles)
          .where(
            and(
              eq(candidateProfiles.organizationId, orgId),
              eq(candidateProfiles.userId, userId),
            ),
          )
          .get() as typeof candidateProfiles.$inferSelect | undefined) ?? null
      );
    },
  };
}
