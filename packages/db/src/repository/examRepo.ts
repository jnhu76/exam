import type { Database } from "../types.js";
import { exams } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

/** Creates a tenant-scoped CRUD repository for the `exams` table. */
export function createExamRepo(db: Database) {
  return createAsyncTenantCrudRepo(db, exams);
}
