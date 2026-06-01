import type { SqliteDatabase } from "../sqlite.js";
import { users } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

export function createUserRepo(db: SqliteDatabase) {
  const repo = createTenantCrudRepo(db, users);

  return {
    ...repo,
    findByOrganizationAndUsername(organizationId: string, username: string) {
      return (
        db
          .select()
          .from(users)
          .where(
            and(
              eq(users.organizationId, organizationId),
              eq(users.username, username),
            ),
          )
          .get() ?? null
      );
    },
    findByOrganizationAndId(organizationId: string, id: string) {
      return (
        db
          .select()
          .from(users)
          .where(
            and(eq(users.organizationId, organizationId), eq(users.id, id)),
          )
          .get() ?? null
      );
    },
  };
}
