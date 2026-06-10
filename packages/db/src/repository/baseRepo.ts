import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { ValidationError } from "@exam/domain";
import { and, eq } from "drizzle-orm";
import type { AnySQLiteColumn, AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core/query-builders/update";
import type { SqliteDatabase } from "../sqlite.js";
import type {
  AuthLookupContext,
  PlatformContext,
  TenantContext,
} from "../types.js";

/**
 * Resolves the organization ID for repository operations.
 * For SuperAdmin role, requires targetOrganizationId to be set.
 * @param ctx - The context containing organization information
 * @returns The organization ID to use for repository operations
 */
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

/**
 * Resolves the organization ID for optional organization filtering.
 * For SuperAdmin role, uses targetOrganizationId if set, otherwise falls back to organizationId.
 * @param ctx - The context containing organization information
 * @returns The organization ID to use for repository operations
 */
export function resolveOptionalOrganizationId(
  ctx: TenantContext | RequestContext,
): string {
  if (ctx.role === "SuperAdmin") {
    return ctx.targetOrganizationId ?? ctx.organizationId;
  }
  return ctx.organizationId;
}

/**
 * Returns the current timestamp as a Date object.
 * @returns The current date and time
 */
export function now(): Date {
  return new Date();
}

type TenantTable = AnySQLiteTable & {
  id: AnySQLiteColumn;
  organizationId: AnySQLiteColumn;
  createdAt: AnySQLiteColumn;
  updatedAt?: AnySQLiteColumn;
};

/**
 * Creates a CRUD repository factory for tenant-scoped tables.
 * @param db - The SQLite database instance
 * @param table - The table schema to create a repository for
 * @returns An object with CRUD operations scoped to the organization
 */
export function createTenantCrudRepo<TTable extends TenantTable>(
  db: SqliteDatabase,
  table: TTable,
) {
  type Insert = TTable["$inferInsert"];
  type Select = TTable["$inferSelect"];
  type ManagedColumn = "id" | "organizationId" | "createdAt" | "updatedAt";
  type CreateInput = Omit<Insert, ManagedColumn>;
  type UpdateInput = Partial<CreateInput>;

  /**
   * Finds an entity by ID within the current organization.
   * @param ctx - The request context
   * @param entityId - The entity ID to find
   * @returns The entity if found, null otherwise
   */
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
    /**
     * Creates a new entity in the repository.
     * @param ctx - The request context
     * @param input - The data to create the entity with
     * @returns The created entity with system fields populated
     */
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
    /**
     * Lists all entities within the current organization.
     * @param ctx - The request context
     * @returns Array of all entities in the organization
     */
    list(ctx: RequestContext): Select[] {
      return db
        .select()
        .from(table)
        .where(eq(table.organizationId, resolveOrganizationId(ctx)))
        .all() as Select[];
    },
    /**
     * Counts the number of entities within the current organization.
     * @param ctx - The request context
     * @returns The count of entities in the organization
     */
    count(ctx: RequestContext): number {
      const orgId = resolveOrganizationId(ctx);
      const result = db
        .select({ count: table.id })
        .from(table)
        .where(eq(table.organizationId, orgId))
        .all();
      return result.length;
    },
    /**
     * Lists entities with pagination within the current organization.
     * @param ctx - The request context
     * @param page - The page number (1-indexed)
     * @param pageSize - The number of items per page
     * @returns Object containing the items and total count
     */
    listPaginated(
      ctx: RequestContext,
      page: number,
      pageSize: number,
    ): { items: Select[]; total: number } {
      const orgId = resolveOrganizationId(ctx);
      const offset = (page - 1) * pageSize;
      const items = db
        .select()
        .from(table)
        .where(eq(table.organizationId, orgId))
        .limit(pageSize)
        .offset(offset)
        .all() as Select[];
      const result = db
        .select({ count: table.id })
        .from(table)
        .where(eq(table.organizationId, orgId))
        .all();
      return { items, total: result.length };
    },
    /**
     * Updates an existing entity within the current organization.
     * @param ctx - The request context
     * @param entityId - The ID of the entity to update
     * @param input - The data to update
     * @returns The updated entity if found, null otherwise
     */
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
    /**
     * Deletes an entity within the current organization.
     * @param ctx - The request context
     * @param entityId - The ID of the entity to delete
     * @returns true if the entity was deleted, false otherwise
     */
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

/**
 * Async repository contract for tenant-scoped entities.
 * Provides CRUD operations with promise-based API for tenant-level data.
 */
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

/**
 * Async repository contract for platform-scoped entities.
 * Provides CRUD operations with promise-based API for platform-wide data.
 */
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

/**
 * Async repository contract for authentication lookup operations.
 * Provides read-only operations for cross-tenant authentication lookups.
 */
export interface AsyncAuthLookupRepo<Select> {
  findById(ctx: AuthLookupContext, id: string): Promise<Select | null>;
}
