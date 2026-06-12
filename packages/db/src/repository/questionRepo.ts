import type { Database } from "../types.js";
import { questions } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

export function createQuestionRepo(db: Database) {
  return createAsyncTenantCrudRepo(db, questions);
}
