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

/** PostgreSQL retryable error codes. */
const RETRYABLE_ERROR_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "23505", // unique_violation
]);

/** Max retry attempts for retryable transaction failures. */
const MAX_RETRIES = 3;

/**
 * Checks if an error represents a retryable transaction concurrency error.
 * Walks the error chain (Drizzle wraps the underlying Postgres error).
 */
function isRetryableError(err: unknown): boolean {
  let current: unknown = err;
  while (current) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      typeof (current as { code: unknown }).code === "string" &&
      RETRYABLE_ERROR_CODES.has((current as { code: string }).code)
    ) {
      return true;
    }
    if (typeof current === "object" && current !== null && "cause" in current) {
      current = (current as { cause: unknown }).cause;
    } else {
      break;
    }
  }
  return false;
}

/**
 * Executes the provided function inside a Drizzle database transaction
 * with automatic retry for concurrency failures.
 *
 * Retries automatically when the transaction fails with:
 * - 40001: serialization_failure (REPEATABLE READ concurrent update)
 * - 40P01: deadlock_detected
 * - 23505: unique_violation (concurrent INSERT after race condition on read)
 *
 * @param db - Database instance.
 * @param fn - Async function that receives a transactional `Database` handle.
 * @returns The value returned by `fn`.
 */
export async function executeInTransaction<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 20ms, 40ms, 80ms
      await new Promise((resolve) =>
        setTimeout(resolve, 20 * 2 ** (attempt - 1)),
      );
    }
    try {
      return await db.transaction(async (tx) => {
        return fn(tx as Database);
      });
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES || !isRetryableError(err)) {
        throw err;
      }
    }
  }

  throw lastError;
}
