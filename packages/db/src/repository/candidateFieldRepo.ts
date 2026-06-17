import type { Database } from "../types.js";
import { candidateFields } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

/** Creates a tenant-scoped CRUD repository for the `candidateFields` table. */
export function createCandidateFieldRepo(db: Database) {
  return createAsyncTenantCrudRepo(db, candidateFields);
}
