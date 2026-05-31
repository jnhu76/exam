import type { SqliteDatabase } from "../sqlite.js";
import { questions } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";

export function createQuestionRepo(db: SqliteDatabase) {
  return createTenantCrudRepo(db, questions);
}
