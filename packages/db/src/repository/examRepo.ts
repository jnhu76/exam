import type { Database } from "../types.js";
import { exams } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

export function createExamRepo(db: Database) {
  return createAsyncTenantCrudRepo(db, exams);
}
