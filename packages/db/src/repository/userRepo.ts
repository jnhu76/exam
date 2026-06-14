import type { Database } from "../types.js";
import { users } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
  resolveOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import { UserAlreadyExistsError, type RequestContext } from "@exam/domain";
import { and, eq, inArray } from "drizzle-orm";

function getConstraintName(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const error = err as Record<string, unknown>;
  if (typeof error.constraint === "string") return error.constraint;
  const cause = error.cause;
  if (typeof cause === "object" && cause !== null) {
    const causeRecord = cause as Record<string, unknown>;
    if (typeof causeRecord.constraint === "string")
      return causeRecord.constraint;
  }
  return undefined;
}

export function createUserRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, users);

  async function findByOrganizationAndUsername(
    ctx: TenantContext | RequestContext,
    username: string,
  ) {
    const orgId = resolveOptionalOrganizationId(ctx);
    const rows = await db
      .select()
      .from(users)
      .where(
        and(eq(users.organizationId, orgId), eq(users.username, username)),
      );
    return (rows[0] as typeof users.$inferSelect | undefined) ?? null;
  }

  return {
    ...repo,
    findByOrganizationAndUsername,
    async findByOrganizationAndId(
      ctx: TenantContext | RequestContext,
      id: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(users)
        .where(and(eq(users.organizationId, orgId), eq(users.id, id)));
      return (rows[0] as typeof users.$inferSelect | undefined) ?? null;
    },
    async listPaginatedByRoles(
      ctx: TenantContext | RequestContext,
      roles: readonly string[],
      page: number,
      pageSize: number,
    ): Promise<{
      items: (typeof users.$inferSelect)[];
      total: number;
    }> {
      const orgId = resolveOrganizationId(ctx);
      const offset = (page - 1) * pageSize;
      const where = and(
        eq(users.organizationId, orgId),
        inArray(users.role, roles as string[]),
      );
      const items = (await db
        .select()
        .from(users)
        .where(where)
        .orderBy(users.createdAt, users.id)
        .limit(pageSize)
        .offset(offset)) as (typeof users.$inferSelect)[];
      const total = (await db.select({ id: users.id }).from(users).where(where))
        .length;
      return { items, total };
    },
    async countActiveByRole(
      ctx: TenantContext | RequestContext,
      role: string,
    ): Promise<number> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organizationId, orgId),
            eq(users.role, role),
            eq(users.isActive, true),
          ),
        );
      return rows.length;
    },
    async createUnique(
      ctx: TenantContext | RequestContext,
      input: Parameters<typeof repo.create>[1],
    ) {
      const existing = await findByOrganizationAndUsername(ctx, input.username);
      if (existing) {
        throw new UserAlreadyExistsError();
      }
      try {
        return await repo.create(ctx, input);
      } catch (err) {
        if (getConstraintName(err) === "users_org_username_unique") {
          throw new UserAlreadyExistsError();
        }
        throw err;
      }
    },
  };
}
