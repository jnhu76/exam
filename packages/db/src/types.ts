import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Permission, Role } from "@exam/domain";
import type { schema } from "./schema/pg.js";

/** Drizzle database type bound to the application schema. */
export type Database = PostgresJsDatabase<typeof schema>;

/** Context for repository operations scoped to a specific organization (tenant). */
export interface TenantContext {
  organizationId: string;
  actorId: string;
  role: Role;
  permissions: Permission[];
  targetOrganizationId?: string;
}

/** Context for repository operations at the platform level (cross-tenant). */
export interface PlatformContext {
  actorId: string;
  role: Role;
  permissions: Permission[];
  targetOrganizationId?: string;
}

/** Context for authentication-related lookups that do not require tenant scoping. */
export interface AuthLookupContext {
  purpose: "auth_lookup";
}

/** Discriminated union of all valid repository contexts. */
export type RepoContext = TenantContext | PlatformContext | AuthLookupContext;

/** Type guard that narrows `ctx` to {@link TenantContext} when `organizationId` is present. */
export function isTenantContext(ctx: RepoContext): ctx is TenantContext {
  return (
    "organizationId" in ctx &&
    typeof (ctx as TenantContext).organizationId === "string"
  );
}

/** Type guard that narrows `ctx` to {@link PlatformContext} when no `organizationId` is present. */
export function isPlatformContext(ctx: RepoContext): ctx is PlatformContext {
  return !("organizationId" in ctx) && "actorId" in ctx;
}

/** Safely converts a value to a finite number, returning `fallback` if the result is not finite. */
export function pgNum(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Executes the provided function inside a Drizzle database transaction.
 * @param db - Database instance.
 * @param fn - Async function that receives a transactional `Database` handle.
 * @returns The value returned by `fn`.
 */
export async function executeInTransaction<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    return fn(tx as Database);
  });
}
