import type { Database } from "../types.js";
import { questions } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

/** Creates a tenant-scoped CRUD repository for the `questions` table. */
export function createQuestionRepo(db: Database) {
  return createAsyncTenantCrudRepo(db, questions);
}
