import type { AnyDatabase } from "../types.js";
import { isSqlite } from "../types.js";
import { questions as sqliteQuestions } from "../schema/sqlite.js";
import { questions as pgQuestions } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

export function createQuestionRepo(db: AnyDatabase) {
  return createAsyncTenantCrudRepo(db, {
    sqlite: sqliteQuestions,
    pg: pgQuestions,
  });
}
