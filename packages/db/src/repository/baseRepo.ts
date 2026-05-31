import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { ValidationError } from "@exam/domain";
import { and, eq } from "drizzle-orm";
import type { AnySQLiteColumn, AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core/query-builders/update";
import type { SqliteDatabase } from "../sqlite.js";

export function resolveOrganizationId(ctx: RequestContext): string {
  if (ctx.role === "SuperAdmin") {
    if (!ctx.targetOrganizationId) {
      throw new ValidationError(
        "SuperAdmin repository operations require targetOrganizationId",
      );
    }
    return ctx.targetOrganizationId;
  }

  return ctx.organizationId;
}

export function now(): Date {
  return new Date();
}

type TenantTable = AnySQLiteTable & {
  id: AnySQLiteColumn;
  organizationId: AnySQLiteColumn;
  createdAt: AnySQLiteColumn;
  updatedAt?: AnySQLiteColumn;
};

export function createTenantCrudRepo<TTable extends TenantTable>(
  db: SqliteDatabase,
  table: TTable,
) {
  type Insert = TTable["$inferInsert"];
  type Select = TTable["$inferSelect"];
  type ManagedColumn = "id" | "organizationId" | "createdAt" | "updatedAt";
  type CreateInput = Omit<Insert, ManagedColumn>;
  type UpdateInput = Partial<CreateInput>;

  function findById(ctx: RequestContext, entityId: string): Select | null {
    return (
      (db
        .select()
        .from(table)
        .where(
          and(
            eq(table.organizationId, resolveOrganizationId(ctx)),
            eq(table.id, entityId),
          ),
        )
        .get() as Select | undefined) ?? null
    );
  }

  return {
    create(ctx: RequestContext, input: CreateInput): Select {
      const timestamp = now();
      const row = {
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        createdAt: timestamp,
        ...("updatedAt" in table ? { updatedAt: timestamp } : {}),
        ...input,
      } as Insert;
      db.insert(table).values(row).run();
      return row as Select;
    },
    findById,
    list(ctx: RequestContext): Select[] {
      return db
        .select()
        .from(table)
        .where(eq(table.organizationId, resolveOrganizationId(ctx)))
        .all() as Select[];
    },
    update(
      ctx: RequestContext,
      entityId: string,
      input: UpdateInput,
    ): Select | null {
      const changes = {
        ...input,
        ...("updatedAt" in table ? { updatedAt: now() } : {}),
      } as SQLiteUpdateSetSource<TTable>;
      db.update(table)
        .set(changes)
        .where(
          and(
            eq(table.organizationId, resolveOrganizationId(ctx)),
            eq(table.id, entityId),
          ),
        )
        .run();
      return findById(ctx, entityId);
    },
    delete(ctx: RequestContext, entityId: string): boolean {
      const result = db
        .delete(table)
        .where(
          and(
            eq(table.organizationId, resolveOrganizationId(ctx)),
            eq(table.id, entityId),
          ),
        )
        .run();
      return result.changes > 0;
    },
  };
}
