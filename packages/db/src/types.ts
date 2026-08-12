import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type {
  AttemptTimingPolicySnapshot,
  Permission,
  Role,
} from "@exam/domain";
import type { schema } from "./schema/pg.js";

/** Drizzle database type bound to the application schema. */
export type Database = PostgresJsDatabase<typeof schema>;

declare const transactionDatabaseBrand: unique symbol;

/**
 * Database handle proven to belong to the active transaction callback.
 * Only {@link executeInTransaction} creates this branded view.
 */
export type TransactionDatabase = Database & {
  readonly [transactionDatabaseBrand]: true;
};

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

/** Projects the four explicit attempt snapshot columns into the domain value. */
export function projectAttemptTimingPolicySnapshot(input: {
  interruptionPolicySnapshotVersion: number;
  interruptionTimePolicySnapshot:
    | "strict"
    | "bounded_grace"
    | "operator_incident";
  interruptionGracePerIncidentSecondsSnapshot: number | null;
  interruptionGracePerAttemptSecondsSnapshot: number | null;
}): AttemptTimingPolicySnapshot {
  return {
    schemaVersion: 1,
    policy: input.interruptionTimePolicySnapshot,
    perIncidentCapSeconds: input.interruptionGracePerIncidentSecondsSnapshot,
    perAttemptAggregateCapSeconds:
      input.interruptionGracePerAttemptSecondsSnapshot,
  };
}

/** PostgreSQL retryable error codes (transient concurrency failures only). */
const RETRYABLE_ERROR_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
]);

/** Max retry attempts for retryable transaction failures. */
const MAX_RETRIES = 3;

/**
 * True when the error — or any error in its `cause` chain, because Drizzle
 * wraps the underlying PostgreSQL error — carries the given PostgreSQL
 * error code (e.g. `23505` unique_violation). Uses a `visited` Set to guard
 * against circular `cause` references.
 */
export function hasPostgresErrorCode(err: unknown, code: string): boolean {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      (current as { code: unknown }).code === code
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
 * Checks if an error represents a retryable transaction concurrency error.
 * Walks the error chain (Drizzle wraps the underlying Postgres error).
 */
function isRetryableError(err: unknown): boolean {
  return [...RETRYABLE_ERROR_CODES].some((code) =>
    hasPostgresErrorCode(err, code),
  );
}

/**
 * Executes the provided function inside a Drizzle database transaction
 * with automatic retry for concurrency failures.
 *
 * The transaction defaults to REPEATABLE READ isolation to ensure
 * consistent behavior across all environments regardless of database
 * defaults. Under REPEATABLE READ, concurrent transactions that modify
 * the same row trigger serialization_failure (40001) which is retried.
 *
 * Some callers (e.g., the attempt-start race) use READ COMMITTED because
 * REPEATABLE READ does not see rows INSERTed by a concurrent transaction
 * even after commit, which breaks the double-click idempotency pattern
 * (the second transaction must find the existing attempt). In READ COMMITTED,
 * each query sees the latest committed data, so `FOR UPDATE` on the attempt
 * table finds the row created by the concurrent transaction.
 *
 * Retries automatically when the transaction fails with:
 * - 40001: serialization_failure (REPEATABLE READ concurrent update)
 * - 40P01: deadlock_detected
 *
 * Note: unique_violation (23505) is NOT retried globally — most unique
 * violations are permanent conflicts (duplicate email, username, etc.)
 * and retrying them wastes resources.
 *
 * @param db - Database instance.
 * @param fn - Async function that receives a transactional `Database` handle.
 * @param isolationLevel - Transaction isolation level (default: "repeatable read").
 * @returns The value returned by `fn`.
 */
export async function executeInTransaction<T>(
  db: Database,
  fn: (tx: TransactionDatabase) => Promise<T>,
  isolationLevel: "read committed" | "repeatable read" = "repeatable read",
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
          return fn(tx as unknown as TransactionDatabase);
        },
        { isolationLevel },
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
