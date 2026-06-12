import type { Database } from "../types.js";
import { courses } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

export function createCourseRepo(db: Database) {
  return createAsyncTenantCrudRepo(db, courses);
}
