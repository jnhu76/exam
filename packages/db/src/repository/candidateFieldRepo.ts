import type { Database } from "../types.js";
import { candidateFields } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

export function createCandidateFieldRepo(db: Database) {
  return createAsyncTenantCrudRepo(db, candidateFields);
}
