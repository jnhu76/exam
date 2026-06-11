import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Permission, Role } from "@exam/domain";
import type { sqliteSchema } from "./schema/sqlite.js";
import type { pgSchema } from "./schema/pg.js";

export type SqliteDatabase = BetterSQLite3Database<typeof sqliteSchema>;
export type PostgresDatabase = PostgresJsDatabase<typeof pgSchema>;
export type AnyDatabase = SqliteDatabase | PostgresDatabase;

export function isSqlite(db: AnyDatabase): db is SqliteDatabase {
  return "all" in db;
}

export interface TenantContext {
  organizationId: string;
  actorId: string;
  role: Role;
  permissions: Permission[];
  targetOrganizationId?: string;
}

export interface PlatformContext {
  actorId: string;
  role: Role;
  permissions: Permission[];
  targetOrganizationId?: string;
}

export interface AuthLookupContext {
  purpose: "auth_lookup";
}

export type RepoContext = TenantContext | PlatformContext | AuthLookupContext;

export function isTenantContext(ctx: RepoContext): ctx is TenantContext {
  return (
    "organizationId" in ctx &&
    typeof (ctx as TenantContext).organizationId === "string"
  );
}

export function isPlatformContext(ctx: RepoContext): ctx is PlatformContext {
  return !("organizationId" in ctx) && "actorId" in ctx;
}

export async function executeInTransaction<T>(
  db: AnyDatabase,
  fn: (tx: AnyDatabase) => Promise<T>,
): Promise<T> {
  if (isSqlite(db)) {
    return fn(db);
  }
  return (db as PostgresDatabase).transaction(async (tx) => {
    return fn(tx as unknown as AnyDatabase);
  });
}
