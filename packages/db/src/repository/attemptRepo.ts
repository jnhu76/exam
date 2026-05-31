import type { SqliteDatabase } from "../sqlite.js";
import { examAttempts } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";

export function createAttemptRepo(db: SqliteDatabase) {
  return createTenantCrudRepo(db, examAttempts);
}
