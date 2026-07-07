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

/** PostgreSQL retryable error codes (transient concurrency failures only). */
const RETRYABLE_ERROR_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
]);

/** Max retry attempts for retryable transaction failures. */
const MAX_RETRIES = 3;

/**
 * Checks if an error represents a retryable transaction concurrency error.
 * Walks the error chain (Drizzle wraps the underlying Postgres error).
 * Uses a `visited` Set to guard against circular `cause` references.
 */
function isRetryableError(err: unknown): boolean {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
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
 * The transaction explicitly uses REPEATABLE READ isolation to ensure
 * consistent behavior across all environments regardless of database
 * defaults. Under REPEATABLE READ, concurrent transactions that modify
 * the same row trigger serialization_failure (40001) which is retried.
 *
 * Retries automatically when the transaction fails with:
 * - 40001: serialization_failure (REPEATABLE READ concurrent update)
 * - 40P01: deadlock_detected
 *
 * Note: unique_violation (23505) is NOT retried globally — most unique
 * violations are permanent conflicts (duplicate email, username, etc.)
 * and retrying them wastes resources. The startAttempt race is handled
 * by the enrollment FOR UPDATE lock which triggers 40001 under REPEATABLE READ.
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
      return await db.transaction(
        async (tx) => {
          return fn(tx as Database);
        },
        { isolationLevel: "repeatable read" },
      );
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES || !isRetryableError(err)) {
        throw err;
      }
    }
  }

  throw lastError;
}
