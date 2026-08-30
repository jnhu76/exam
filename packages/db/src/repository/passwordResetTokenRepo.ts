import type { RequestContext } from "@exam/domain";
import { PasswordResetCooldownError } from "@exam/domain";
import { randomUUID } from "node:crypto";
import { and, desc, eq, exists, gt, isNull, lt, sql } from "drizzle-orm";
import type { Database, TenantContext } from "../types.js";
import { hasPostgresErrorCode } from "../types.js";
import { passwordResetTokens, users } from "../schema/pg.js";
import { now, resolveOrganizationId } from "./baseRepo.js";

/**
 * Password-reset token row — the `password_reset_tokens` select shape (#297).
 */
export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;

/** Input for issuing a password-reset token (state only — no raw token). */
export interface IssuePasswordResetTokenInput {
  userId: string;
  /** Hex SHA-256 of the raw token (never the raw token itself). */
  tokenHash: string;
  expiresAt: Date;
  /** Explicit clock: the command layer (fastify.now) owns time (ADR-006). */
  now: Date;
}

/**
 * Maps a unique-violation (SQLSTATE 23505) on the INSERT to the typed
 * cooldown error. The only reachable unique violations on this INSERT are
 * the ≤1-open-token partial index `password_reset_tokens_user_open_unique`
 * (a concurrent issuer won the slot) and the token-hash unique index (a
 * SHA-256 collision — cryptographically impossible). The constraint NAME is
 * not matched because the postgres-js driver does not expose it on the
 * error object — the SQLSTATE is the stable signal.
 */
function isUniqueViolation(err: unknown): boolean {
  return hasPostgresErrorCode(err, "23505");
}

/**
 * Creates a repository for the `password_reset_tokens` table (#297).
 *
 * LOCK ORDER (canonical, #297 credential lifecycle):
 *
 *   USER row lock (userRepo.lockBy{Username,Id}WithinTransaction)
 *     → PASSWORD_RESET_TOKEN(S) statements
 *       → credential/auth_epoch mutation
 *
 * Reset-request issuance, reset consume, and account deactivation ALL
 * follow this order. Deactivation locks the user row (its UPDATE) before
 * burning tokens; issuance and consume lock the user row via userRepo
 * before touching token rows. A transaction that mutated token rows before
 * acquiring the user row would deadlock against deactivation. There is no
 * retry/mutex layer — PostgreSQL row locks are the only serialization.
 *
 * Revalidation invariant: every gate (user exists, org matches, account
 * active, cooldown, email eligibility) is evaluated INSIDE the transaction
 * after the user row lock is held. Observations read before the
 * transaction are advisory only.
 *
 * Invariants enforced HERE (not in callers):
 *  - newest-token-wins: issuing consumes any open token for the user in the
 *    same transaction, then inserts the replacement;
 *  - at most one unconsumed token per user (partial unique index backstop;
 *    a losing concurrent issuer surfaces as
 *    {@link PasswordResetCooldownError});
 *  - consumption requires an unconsumed, unexpired token whose user is still
 *    ACTIVE in the same organization — the CAS re-checks the user-state
 *    guard even though callers hold the user row lock (defense in depth),
 *    so deactivation fail-closes outstanding tokens in every schedule.
 *
 * @param db - Drizzle database connection (or an open transaction).
 */
export function createPasswordResetTokenRepo(db: Database) {
  /**
   * Issues a new token for `userId`, invalidating the previous open token.
   * MUST be called with the user row lock held (canonical order — see the
   * module header), after the caller revalidated user state under that
   * lock. Throws {@link PasswordResetCooldownError} when a concurrent
   * issuer won the open-token slot (reachable only for callers that skip
   * the lock discipline; the partial unique index is the backstop).
   */
  async function issueWithinTransaction(
    ctx: TenantContext | RequestContext,
    input: IssuePasswordResetTokenInput,
  ): Promise<PasswordResetTokenRow> {
    const orgId = resolveOrganizationId(ctx);
    // Newest-token-wins: only one open token per user may exist, and any
    // prior open token is dead the moment a new one is issued.
    await db
      .update(passwordResetTokens)
      .set({ consumedAt: input.now })
      .where(
        and(
          eq(passwordResetTokens.userId, input.userId),
          isNull(passwordResetTokens.consumedAt),
        ),
      );
    // Retention backstop: consumed/expired rows carry no recoverable fact
    // (the audit log owns the request history) — prune old rows per user so
    // the table stays bounded without a dedicated cleanup job.
    const staleBefore = new Date(
      input.now.getTime() - 30 * 24 * 60 * 60 * 1000,
    );
    await db
      .delete(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, input.userId),
          lt(passwordResetTokens.createdAt, staleBefore),
        ),
      );
    try {
      const inserted = await db
        .insert(passwordResetTokens)
        .values({
          id: randomUUID(),
          organizationId: orgId,
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        })
        .returning();
      if (!inserted[0]) {
        throw new PasswordResetCooldownError();
      }
      return inserted[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new PasswordResetCooldownError();
      }
      throw err;
    }
  }

  /**
   * Identifies the owner of an OPEN, unexpired token WITHOUT mutating any
   * state (plain read, no row locks). Step 1 of the canonical consume order:
   * identify → lock the user row (userRepo.lockByIdWithinTransaction) →
   * CAS-consume via {@link consumeByTokenHashForUserWithinTransaction}.
   * Returns `{ userId, organizationId }`, or undefined when the token does
   * not exist in the organization or is no longer open. The result is only
   * a lock target — the CAS re-evaluates the full predicate.
   */
  async function findOpenUserIdByTokenHash(
    ctx: TenantContext | RequestContext,
    tokenHash: string,
    nowArg: Date,
  ): Promise<{ userId: string; organizationId: string } | undefined> {
    const orgId = resolveOrganizationId(ctx);
    const rows = await db
      .select({
        userId: passwordResetTokens.userId,
        organizationId: passwordResetTokens.organizationId,
      })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          eq(passwordResetTokens.organizationId, orgId),
          isNull(passwordResetTokens.consumedAt),
          gt(passwordResetTokens.expiresAt, nowArg),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * CAS consumption for an ALREADY-IDENTIFIED token, to be called with the
   * user row lock held (canonical order — see the module header). The
   * UPDATE re-evaluates its predicate after any row-lock wait (READ
   * COMMITTED): the token must still be unconsumed and unexpired, belong to
   * the locked user, and its user must still be active in the token's
   * organization. Concurrent double-submit yields exactly one consumed row;
   * every other outcome returns `undefined` — callers must fold all
   * failures into one generic error.
   */
  async function consumeByTokenHashForUserWithinTransaction(
    ctx: TenantContext | RequestContext,
    input: { tokenHash: string; userId: string },
    nowArg: Date,
  ): Promise<PasswordResetTokenRow | undefined> {
    const orgId = resolveOrganizationId(ctx);
    const rows = await db
      .update(passwordResetTokens)
      .set({ consumedAt: nowArg })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, input.tokenHash),
          eq(passwordResetTokens.organizationId, orgId),
          eq(passwordResetTokens.userId, input.userId),
          isNull(passwordResetTokens.consumedAt),
          gt(passwordResetTokens.expiresAt, nowArg),
          exists(
            db
              .select({ one: sql`1` })
              .from(users)
              .where(
                and(
                  eq(users.id, passwordResetTokens.userId),
                  eq(users.organizationId, passwordResetTokens.organizationId),
                  eq(users.isActive, true),
                ),
              ),
          ),
        ),
      )
      .returning();
    return rows[0];
  }

  /**
   * Returns the creation time of the user's most recent token (any state),
   * or null. Cooldown check input for the reset-request command; the uniform
   * response for a cooldown is identical to a successful request.
   */
  async function getLatestCreatedAt(
    ctx: TenantContext | RequestContext,
    userId: string,
  ): Promise<Date | null> {
    const orgId = resolveOrganizationId(ctx);
    const rows = await db
      .select({ createdAt: passwordResetTokens.createdAt })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.organizationId, orgId),
          eq(passwordResetTokens.userId, userId),
        ),
      )
      .orderBy(desc(passwordResetTokens.createdAt))
      .limit(1);
    return rows[0]?.createdAt ?? null;
  }

  /**
   * Deletes every token row for the user (open or already consumed).
   * Authority-grade hygiene used by account deactivation: a reset link
   * emailed before deactivation must not outlive a deactivate/reactivate
   * cycle, and consumed history is owned by the audit log, not this table.
   */
  async function deleteAllForUserWithinTransaction(
    ctx: TenantContext | RequestContext,
    userId: string,
  ): Promise<number> {
    const orgId = resolveOrganizationId(ctx);
    const rows = await db
      .delete(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.organizationId, orgId),
          eq(passwordResetTokens.userId, userId),
        ),
      )
      .returning();
    return rows.length;
  }

  return {
    issueWithinTransaction,
    findOpenUserIdByTokenHash,
    consumeByTokenHashForUserWithinTransaction,
    getLatestCreatedAt,
    deleteAllForUserWithinTransaction,
  };
}
