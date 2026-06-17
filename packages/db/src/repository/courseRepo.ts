import type { Database } from "../types.js";
import { courses } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

/** Creates a tenant-scoped CRUD repository for the `courses` table. */
export function createCourseRepo(db: Database) {
  return createAsyncTenantCrudRepo(db, courses);
}
