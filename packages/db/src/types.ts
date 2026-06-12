import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Permission, Role } from "@exam/domain";
import type { schema } from "./schema/pg.js";

export type Database = PostgresJsDatabase<typeof schema>;

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

export function pgNum(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export async function executeInTransaction<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    return fn(tx as Database);
  });
}
