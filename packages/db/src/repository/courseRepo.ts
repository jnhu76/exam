import type { SqliteDatabase } from "../sqlite.js";
import { courses } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";

export function createCourseRepo(db: SqliteDatabase) {
  return createTenantCrudRepo(db, courses);
}
