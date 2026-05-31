import type { SqliteDatabase } from "../sqlite.js";
import { examEnrollments } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";

export function createEnrollmentRepo(db: SqliteDatabase) {
  return createTenantCrudRepo(db, examEnrollments);
}
