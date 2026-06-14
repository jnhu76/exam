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

export function resolveOrganizationId(
  ctx: TenantContext | RequestContext,
): string {
  return ctx.organizationId;
}

export function resolveOptionalOrganizationId(
  ctx: TenantContext | RequestContext,
): string {
  return ctx.organizationId;
}

export function now(): Date {
  return new Date();
}

type TenantTable = PgTable<TableConfig> & {
  id: AnyPgColumn;
  organizationId: AnyPgColumn;
  createdAt: AnyPgColumn;
  updatedAt?: AnyPgColumn;
};

export type { TenantTable };

type PgDrizzleTable = PgTable<TableConfig>;

function asDrizzleTable<T extends TenantTable>(t: T): PgDrizzleTable {
  return t as PgDrizzleTable;
}

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
    findById,
    async list(ctx: TenantContext | RequestContext): Promise<Select[]> {
      return db
        .select()
        .from(tbl)
        .where(eq(table.organizationId, orgId(ctx))) as Promise<Select[]>;
    },
    async count(ctx: TenantContext | RequestContext): Promise<number> {
      return (
        await db
          .select({ id: table.id })
          .from(tbl)
          .where(eq(table.organizationId, orgId(ctx)))
      ).length;
    },
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
