import type { SqliteDatabase } from "../sqlite.js";
import { users } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";
import type { RequestContext } from "@exam/domain";
import { eq } from "drizzle-orm";

export function createUserRepo(db: SqliteDatabase) {
  const repo = createTenantCrudRepo(db, users);

  return {
    ...repo,
    findByUsername(username: string) {
      return (
        db.select().from(users).where(eq(users.username, username)).get() ??
        null
      );
    },
  };
}
