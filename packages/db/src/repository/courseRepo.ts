import type { AnyDatabase } from "../types.js";
import { isSqlite } from "../types.js";
import { courses as sqliteCourses } from "../schema/sqlite.js";
import { courses as pgCourses } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

export function createCourseRepo(db: AnyDatabase) {
  return createAsyncTenantCrudRepo(db, {
    sqlite: sqliteCourses,
    pg: pgCourses,
  });
}
