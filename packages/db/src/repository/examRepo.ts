import type { SqliteDatabase } from "../sqlite.js";
import { exams } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";

export function createExamRepo(db: SqliteDatabase) {
  return createTenantCrudRepo(db, exams);
}
