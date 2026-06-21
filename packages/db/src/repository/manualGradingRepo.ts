import type { Database } from "../types.js";
import { manualGradingEntries } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";
import { resolveOrganizationId } from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

type ManualGradingEntrySelect = (typeof manualGradingEntries)["$inferSelect"];

/**
 * Creates the manual-grading-entry repository with CRUD plus two read-only
 * finders. Write operations (upsert/create) are intentionally NOT provided
 * here — they belong to the grading command layer (P2D-J3). This job only
 * defines the model and the read path.
 */
export function createManualGradingRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, manualGradingEntries);

  return {
    ...repo,
    /**
     * Lists all manual grading entries for an attempt, scoped to the tenant.
     */
    async findByAttempt(
      ctx: TenantContext | RequestContext,
      attemptId: string,
    ): Promise<ManualGradingEntrySelect[]> {
      const orgId = resolveOrganizationId(ctx);
      return db
        .select()
        .from(manualGradingEntries)
        .where(
          and(
            eq(manualGradingEntries.organizationId, orgId),
            eq(manualGradingEntries.attemptId, attemptId),
          ),
        );
    },
    /**
     * Finds the single manual grading entry for a given attempt + question,
     * scoped to the tenant. Returns null when no entry exists yet.
     */
    async findByAttemptAndQuestion(
      ctx: TenantContext | RequestContext,
      attemptId: string,
      questionId: string,
    ): Promise<ManualGradingEntrySelect | null> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select()
        .from(manualGradingEntries)
        .where(
          and(
            eq(manualGradingEntries.organizationId, orgId),
            eq(manualGradingEntries.attemptId, attemptId),
            eq(manualGradingEntries.questionId, questionId),
          ),
        );
      return (rows[0] as ManualGradingEntrySelect | undefined) ?? null;
    },
  };
}
