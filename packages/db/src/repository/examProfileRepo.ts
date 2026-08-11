// ── P7-M2: exam policy profile repository ─────────────────────────
//
// Organization-scoped CRUD for `exam_policy_profiles`. A profile is ordinary
// authoring data — no locks, no versioning, no lifecycle state machine (M2
// design §28/§29). Deletion is a hard delete: exams materialize profile values
// at creation (copy-on-apply), so no Exam depends on a profile row.

import type { Database } from "../types.js";
import { examPolicyProfiles } from "../schema/pg.js";
import { eq } from "drizzle-orm";
import {
  createAsyncTenantCrudRepo,
  resolveOrganizationId,
} from "./baseRepo.js";
import type { RequestContext } from "@exam/domain";

/** Creates a tenant-scoped CRUD repository for the `examPolicyProfiles` table. */
export function createExamProfileRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, examPolicyProfiles);

  return {
    create: repo.create,
    findById: repo.findById,
    update: repo.update,
    delete: repo.delete,
    /**
     * Lists all profiles for the organization, newest first (deterministic
     * createdAt + id tie-break). Profile counts are small authoring data —
     * no pagination.
     */
    async list(ctx: RequestContext) {
      const orgId = resolveOrganizationId(ctx);
      return db
        .select()
        .from(examPolicyProfiles)
        .where(eq(examPolicyProfiles.organizationId, orgId))
        .orderBy(examPolicyProfiles.createdAt, examPolicyProfiles.id);
    },
  };
}
