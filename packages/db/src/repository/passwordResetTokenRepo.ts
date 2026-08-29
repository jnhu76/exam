import type { RequestContext } from "@exam/domain";
import { PasswordResetCooldownError } from "@exam/domain";
import { randomUUID } from "node:crypto";
import { and, desc, eq, exists, gt, isNull, lt, sql } from "drizzle-orm";
import type { Database, TenantContext } from "../types.js";
import { passwordResetTokens, users } from "../schema/pg.js";
import { now, resolveOrganizationId } from "./baseRepo.js";

/**
 * Password-reset token row — the `password_reset_tokens` select shape (#297).
 */
export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;

/** Error-detail constraint name for the ≤1-open-token-per-user backstop. */
const USER_OPEN_UNIQUE_CONSTRAINT = "password_reset_tokens_user_open_unique";

/** Input for issuing a password-reset token (state only — no raw token). */
export interface IssuePasswordResetTokenInput {
  userId: string;
  /** Hex SHA-256 of the raw token (never the raw token itself). */
  tokenHash: string;
  expiresAt: Date;
  /** Explicit clock: the command layer (fastify.now) owns time (ADR-006). */
  now: Date;
}

/** Maps a unique-violation on the open-token index to the typed cooldown error. */
function isUserOpenUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  while (typeof current === "object" && current !== null) {
    const record = current as Record<string, unknown>;
    if (
      typeof record.constraint === "string" &&
      record.constraint === USER_OPEN_UNIQUE_CONSTRAINT
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

/**
 * Creates a repository for the `password_reset_tokens` table (#297).
 *
 * Invariants enforced HERE (not in callers):
 *  - newest-token-wins: issuing consumes any open token for the user in the
 *    same transaction, then inserts the replacement;
 *  - at most one unconsumed token per user (partial unique index backstop;
 *    a losing concurrent issuer surfaces as
 *    {@link PasswordResetCooldownError});
 *  - consumption requires an unconsumed, unexpired token whose user is still
 *    ACTIVE in the same organization — deactivation fail-closes outstanding
 *    tokens inside the single CAS statement, so no separate user re-read is
 *    needed and no race window exists.
 *
 * @param db - Drizzle database connection (or an open transaction).
 */
export function createPasswordResetTokenRepo(db: Database) {
  /**
   * Issues a new token for `userId`, invalidating the previous open token.
   * Throws {@link PasswordResetCooldownError} when a concurrent issuer won
   * the open-token slot.
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
      if (isUserOpenUniqueViolation(err)) {
        throw new PasswordResetCooldownError();
      }
      throw err;
    }
  }

  /**
   * Single-statement CAS consumption with an embedded user-state guard: the
   * token must be unconsumed and unexpired, and its user must still be
   * active in the token's organization. The UPDATE re-evaluates its
   * predicate after any row-lock wait (READ COMMITTED), so concurrent
   * double-submit yields exactly one consumed row; the loser gets
   * `undefined`. Returns the consumed row (carrying `userId` and
   * `organizationId` for the password mutation), or `undefined` on any
   * failure — callers must return one generic error for all outcomes.
   */
  async function consumeByTokenHashWithinTransaction(
    ctx: TenantContext | RequestContext,
    tokenHash: string,
    nowArg: Date,
  ): Promise<PasswordResetTokenRow | undefined> {
    const orgId = resolveOrganizationId(ctx);
    const rows = await db
      .update(passwordResetTokens)
      .set({ consumedAt: nowArg })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          eq(passwordResetTokens.organizationId, orgId),
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
    consumeByTokenHashWithinTransaction,
    getLatestCreatedAt,
    deleteAllForUserWithinTransaction,
  };
}
