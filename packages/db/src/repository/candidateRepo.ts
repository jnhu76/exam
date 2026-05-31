import type { SqliteDatabase } from "../sqlite.js";
import { candidateProfiles } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";

export function createCandidateRepo(db: SqliteDatabase) {
  return createTenantCrudRepo(db, candidateProfiles);
}
