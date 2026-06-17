import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { and, eq } from "drizzle-orm";
import type { PgTable, TableConfig } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database } from "../types.js";
import type {
  AuthLookupContext,
  PlatformContext,
  TenantContext,
} from "../types.js";

/** Extracts `organizationId` from a tenant or request context. */
export function resolveOrganizationId(
  ctx: TenantContext | RequestContext,
): string {
  return ctx.organizationId;
}

/** Extracts `organizationId` from a tenant or request context (alias for resolveOrganizationId). */
export function resolveOptionalOrganizationId(
  ctx: TenantContext | RequestContext,
): string {
  return ctx.organizationId;
}

/** Returns the current date/time. */
export function now(): Date {
  return new Date();
}

/** Drizzle table type with required `id`, `organizationId`, `createdAt`, and optional `updatedAt` columns. */
type TenantTable = PgTable<TableConfig> & {
  id: AnyPgColumn;
  organizationId: AnyPgColumn;
  createdAt: AnyPgColumn;
  updatedAt?: AnyPgColumn;
};

export type { TenantTable };

type PgDrizzleTable = PgTable<TableConfig>;

/** Casts a tenant table to a plain Drizzle table type for generic operations. */
function asDrizzleTable<T extends TenantTable>(t: T): PgDrizzleTable {
  return t as PgDrizzleTable;
}

/**
 * Creates a generic CRUD repository for a tenant-scoped Drizzle table.
 * All operations filter by `organizationId` from the provided context.
 * `id`, `organizationId`, `createdAt`, and `updatedAt` are managed automatically.
 * @param db - Database instance.
 * @param table - Drizzle table definition with tenant columns.
 */
export function createAsyncTenantCrudRepo<T extends TenantTable>(
  db: Database,
  table: T,
) {
  type Select = T["$inferSelect"];
  type Insert = T["$inferInsert"];
  type ManagedColumn = "id" | "organizationId" | "createdAt" | "updatedAt";
  type CreateInput = Omit<Insert, ManagedColumn>;
  type UpdateInput = Partial<CreateInput>;

  const orgId = (ctx: TenantContext | RequestContext) =>
    resolveOrganizationId(ctx);

  const tbl = asDrizzleTable(table);

  async function findById(
    ctx: TenantContext | RequestContext,
    entityId: string,
  ): Promise<Select | null> {
    const rows = await db
      .select()
      .from(tbl)
      .where(and(eq(table.organizationId, orgId(ctx)), eq(table.id, entityId)));
    return (rows[0] as Select | undefined) ?? null;
  }

  return {
    /**
     * Creates a new row with auto-generated `id`, `organizationId`, and timestamps.
     * Returns the created row read from the database.
     */
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
        ...("updatedAt" in table ? { updatedAt: timestamp } : {}),
      };

      const row = { ...managed, ...input } as Insert;
      await db.insert(tbl).values(row);

      const created = await findById(ctx, id);
      if (!created) {
        throw new NotFoundError("Failed to read back created entity");
      }
      return created;
    },
    /** Finds a single row by `id` scoped to the tenant's `organizationId`. */
    findById,
    /** Lists all rows for the tenant's organization. */
    async list(ctx: TenantContext | RequestContext): Promise<Select[]> {
      return db
        .select()
        .from(tbl)
        .where(eq(table.organizationId, orgId(ctx))) as Promise<Select[]>;
    },
    /** Returns the total row count for the tenant's organization. */
    async count(ctx: TenantContext | RequestContext): Promise<number> {
      return (
        await db
          .select({ id: table.id })
          .from(tbl)
          .where(eq(table.organizationId, orgId(ctx)))
      ).length;
    },
    /**
     * Lists rows for the tenant's organization with pagination.
     * @returns `{ items, total }` where `total` is the unpaginated count.
     */
    async listPaginated(
      ctx: TenantContext | RequestContext,
      page: number,
      pageSize: number,
    ): Promise<{ items: Select[]; total: number }> {
      const oid = orgId(ctx);
      const offset = (page - 1) * pageSize;
      const items = (await db
        .select()
        .from(tbl)
        .where(eq(table.organizationId, oid))
        .orderBy(table.createdAt, table.id)
        .limit(pageSize)
        .offset(offset)) as Select[];
      const total = (
        await db
          .select({ id: table.id })
          .from(tbl)
          .where(eq(table.organizationId, oid))
      ).length;
      return { items, total };
    },
    /**
     * Updates a row by `id` scoped to the tenant, setting `updatedAt`.
     * Returns the updated row or null if not found.
     */
    async update(
      ctx: TenantContext | RequestContext,
      entityId: string,
      input: UpdateInput,
    ): Promise<Select | null> {
      const changes = {
        ...input,
        ...("updatedAt" in table ? { updatedAt: now() } : {}),
      };
      await db
        .update(tbl)
        .set(changes)
        .where(
          and(eq(table.organizationId, orgId(ctx)), eq(table.id, entityId)),
        );
      return findById(ctx, entityId);
    },
    /**
     * Deletes a row by `id` scoped to the tenant's organization.
     * Returns true if at least one row was deleted.
     */
    async delete(
      ctx: TenantContext | RequestContext,
      entityId: string,
    ): Promise<boolean> {
      const result = await db
        .delete(tbl)
        .where(
          and(eq(table.organizationId, orgId(ctx)), eq(table.id, entityId)),
        );
      return (result.count ?? 0) > 0;
    },
  };
}

/** Interface for tenant-scoped async CRUD repositories. */
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

/** Interface for platform-level (cross-tenant) async CRUD repositories. */
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

/** Interface for authentication-lookup repositories that only need `findById`. */
export interface AsyncAuthLookupRepo<Select> {
  findById(ctx: AuthLookupContext, id: string): Promise<Select | null>;
}
