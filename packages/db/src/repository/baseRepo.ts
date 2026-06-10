import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { NotFoundError, ValidationError } from "@exam/domain";
import { and, eq } from "drizzle-orm";
import type { AnySQLiteColumn, AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core/query-builders/update";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core/query-builders/update";
import type { SqliteDatabase } from "../types.js";
import type { PostgresDatabase } from "../types.js";
import type { AnyDatabase } from "../types.js";
import { isSqlite } from "../types.js";
import type {
  AuthLookupContext,
  PlatformContext,
  TenantContext,
} from "../types.js";

export function resolveOrganizationId(
  ctx: TenantContext | RequestContext,
): string {
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

export function resolveOptionalOrganizationId(
  ctx: TenantContext | RequestContext,
): string {
  if (ctx.role === "SuperAdmin") {
    return ctx.targetOrganizationId ?? ctx.organizationId;
  }
  return ctx.organizationId;
}

export function now(): Date {
  return new Date();
}

type SQLiteTenantTable = AnySQLiteTable & {
  id: AnySQLiteColumn;
  organizationId: AnySQLiteColumn;
  createdAt: AnySQLiteColumn;
  updatedAt?: AnySQLiteColumn;
};

type PGTenantTable = PgTable & {
  id: AnyPgColumn;
  organizationId: AnyPgColumn;
  createdAt: AnyPgColumn;
  updatedAt?: AnyPgColumn;
};

export interface TenantTablePair {
  sqlite: SQLiteTenantTable;
  pg: PGTenantTable;
}

export function createAsyncTenantCrudRepo(
  db: AnyDatabase,
  tables: TenantTablePair,
) {
  type SqliteSelect = (typeof tables.sqlite)["$inferSelect"];
  type SqliteInsert = (typeof tables.sqlite)["$inferInsert"];
  type PgInsert = (typeof tables.pg)["$inferInsert"];

  type Select = SqliteSelect;
  type ManagedColumn = "id" | "organizationId" | "createdAt" | "updatedAt";
  type CreateInput = Omit<SqliteInsert, ManagedColumn>;
  type UpdateInput = Partial<CreateInput>;

  const orgId = (ctx: TenantContext | RequestContext) =>
    resolveOrganizationId(ctx);

  async function findById(
    ctx: TenantContext | RequestContext,
    entityId: string,
  ): Promise<Select | null> {
    if (isSqlite(db)) {
      return (
        (db
          .select()
          .from(tables.sqlite)
          .where(
            and(
              eq(tables.sqlite.organizationId, orgId(ctx)),
              eq(tables.sqlite.id, entityId),
            ),
          )
          .get() as Select | undefined) ?? null
      );
    }
    const rows = await (db as PostgresDatabase)
      .select()
      .from(tables.pg)
      .where(
        and(
          eq(tables.pg.organizationId, orgId(ctx)),
          eq(tables.pg.id, entityId),
        ),
      );
    return (rows[0] as Select | undefined) ?? null;
  }

  return {
    async create(
      ctx: TenantContext | RequestContext,
      input: CreateInput,
    ): Promise<Select> {
      const id = randomUUID();
      const timestamp = now();
      const managed = {
        id,
        organizationId: orgId(ctx),
        createdAt: timestamp,
        ...("updatedAt" in tables.sqlite ? { updatedAt: timestamp } : {}),
      };

      if (isSqlite(db)) {
        const row = { ...managed, ...input } as SqliteInsert;
        db.insert(tables.sqlite).values(row).run();
      } else {
        const row = { ...managed, ...input } as PgInsert;
        await (db as PostgresDatabase).insert(tables.pg).values(row);
      }

      const created = await findById(ctx, id);
      if (!created) {
        throw new NotFoundError("Failed to read back created entity");
      }
      return created;
    },
    findById,
    async list(ctx: TenantContext | RequestContext): Promise<Select[]> {
      if (isSqlite(db)) {
        return db
          .select()
          .from(tables.sqlite)
          .where(eq(tables.sqlite.organizationId, orgId(ctx)))
          .all() as Select[];
      }
      return (await (db as PostgresDatabase)
        .select()
        .from(tables.pg)
        .where(eq(tables.pg.organizationId, orgId(ctx)))) as Select[];
    },
    async count(ctx: TenantContext | RequestContext): Promise<number> {
      const oid = orgId(ctx);
      if (isSqlite(db)) {
        return db
          .select({ id: tables.sqlite.id })
          .from(tables.sqlite)
          .where(eq(tables.sqlite.organizationId, oid))
          .all().length;
      }
      return (
        await (db as PostgresDatabase)
          .select({ id: tables.pg.id })
          .from(tables.pg)
          .where(eq(tables.pg.organizationId, oid))
      ).length;
    },
    async listPaginated(
      ctx: TenantContext | RequestContext,
      page: number,
      pageSize: number,
    ): Promise<{ items: Select[]; total: number }> {
      const oid = orgId(ctx);
      const offset = (page - 1) * pageSize;
      if (isSqlite(db)) {
        const items = db
          .select()
          .from(tables.sqlite)
          .where(eq(tables.sqlite.organizationId, oid))
          .limit(pageSize)
          .offset(offset)
          .all() as Select[];
        const total = db
          .select({ id: tables.sqlite.id })
          .from(tables.sqlite)
          .where(eq(tables.sqlite.organizationId, oid))
          .all().length;
        return { items, total };
      }
      const items = (await (db as PostgresDatabase)
        .select()
        .from(tables.pg)
        .where(eq(tables.pg.organizationId, oid))
        .limit(pageSize)
        .offset(offset)) as Select[];
      const total = (
        await (db as PostgresDatabase)
          .select({ id: tables.pg.id })
          .from(tables.pg)
          .where(eq(tables.pg.organizationId, oid))
      ).length;
      return { items, total };
    },
    async update(
      ctx: TenantContext | RequestContext,
      entityId: string,
      input: UpdateInput,
    ): Promise<Select | null> {
      const changes = {
        ...input,
        ...("updatedAt" in tables.sqlite ? { updatedAt: now() } : {}),
      };
      if (isSqlite(db)) {
        db.update(tables.sqlite)
          .set(changes as SQLiteUpdateSetSource<typeof tables.sqlite>)
          .where(
            and(
              eq(tables.sqlite.organizationId, orgId(ctx)),
              eq(tables.sqlite.id, entityId),
            ),
          )
          .run();
      } else {
        await (db as PostgresDatabase)
          .update(tables.pg)
          .set(changes as PgUpdateSetSource<typeof tables.pg>)
          .where(
            and(
              eq(tables.pg.organizationId, orgId(ctx)),
              eq(tables.pg.id, entityId),
            ),
          );
      }
      return findById(ctx, entityId);
    },
    async delete(
      ctx: TenantContext | RequestContext,
      entityId: string,
    ): Promise<boolean> {
      if (isSqlite(db)) {
        const result = db
          .delete(tables.sqlite)
          .where(
            and(
              eq(tables.sqlite.organizationId, orgId(ctx)),
              eq(tables.sqlite.id, entityId),
            ),
          )
          .run();
        return result.changes > 0;
      }
      const result = await (db as PostgresDatabase)
        .delete(tables.pg)
        .where(
          and(
            eq(tables.pg.organizationId, orgId(ctx)),
            eq(tables.pg.id, entityId),
          ),
        );
      return (result.count ?? 0) > 0;
    },
  };
}

export interface AsyncTenantRepo<Select, CreateInput, UpdateInput> {
  create(ctx: TenantContext, input: CreateInput): Promise<Select>;
  findById(ctx: TenantContext, id: string): Promise<Select | null>;
  list(ctx: TenantContext): Promise<Select[]>;
  update(
    ctx: TenantContext,
    id: string,
    input: UpdateInput,
  ): Promise<Select | null>;
  delete(ctx: TenantContext, id: string): Promise<boolean>;
}

export interface AsyncPlatformRepo<Select, CreateInput, UpdateInput> {
  create(ctx: PlatformContext, input: CreateInput): Promise<Select>;
  findById(ctx: PlatformContext, id: string): Promise<Select | null>;
  list(ctx: PlatformContext): Promise<Select[]>;
  update(
    ctx: PlatformContext,
    id: string,
    input: UpdateInput,
  ): Promise<Select | null>;
  delete(ctx: PlatformContext, id: string): Promise<boolean>;
}

export interface AsyncAuthLookupRepo<Select> {
  findById(ctx: AuthLookupContext, id: string): Promise<Select | null>;
}
