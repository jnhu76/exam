import type { SqliteDatabase } from "../sqlite.js";
import { candidateFields } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";

export function createCandidateFieldRepo(db: SqliteDatabase) {
  return createTenantCrudRepo(db, candidateFields);
}
