import type { AnyDatabase } from "../types.js";
import { isSqlite } from "../types.js";
import { exams as sqliteExams } from "../schema/sqlite.js";
import { exams as pgExams } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

export function createExamRepo(db: AnyDatabase) {
  return createAsyncTenantCrudRepo(db, {
    sqlite: sqliteExams,
    pg: pgExams,
  });
}
