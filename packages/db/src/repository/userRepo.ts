import type { SqliteDatabase } from "../sqlite.js";
import { users } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";

export function createUserRepo(db: SqliteDatabase) {
  return createTenantCrudRepo(db, users);
}
