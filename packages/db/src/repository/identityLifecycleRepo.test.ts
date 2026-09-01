import { randomUUID } from "node:crypto";

/** Deterministic clock for repo tests: explicit now params (ADR-006). */
const NOW = new Date("2026-08-29T12:00:00Z");
const HOUR = 60 * 60 * 1000;
import type { RequestContext } from "@exam/domain";
import { computeStaffInvitationStatus, ConflictError } from "@exam/domain";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { getIsolatedTestDb, resolveTestDbUrl } from "../testDb.js";
import { createDatabase } from "../database.js";
import {
  executeInTransaction,
  type Database,
  type TransactionDatabase,
} from "../types.js";
import { schema } from "../schema/pg.js";
import { createStaffInvitationRepo } from "./staffInvitationRepo.js";
import { createPasswordResetTokenRepo } from "./passwordResetTokenRepo.js";
import { createUserRepo } from "./userRepo.js";
import { hashToken, generateToken } from "@exam/auth/src/tokens.js";

function createContext(orgId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId: orgId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
    targetOrganizationId: orgId,
  };
}

/** Barrier primitive: deterministic inter-tx handoff, never sleeps. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Second INDEPENDENT connection to the same isolated schema. The schedules
 * below park one transaction mid-flight while another must run: with the
 * single-connection isolated drizzle instance that second transaction
 * would starve in the pool queue instead of contending on ROW locks —
 * the schedules must contend on locks, never on the pool.
 */
let auxConn: Awaited<ReturnType<typeof createDatabase>> | null = null;
let auxUrl: string | undefined;
let auxSchema: string | undefined;
async function auxDb(): Promise<Database> {
  auxConn ??= await createDatabase(auxUrl ?? resolveTestDbUrl(), auxSchema);
  return auxConn.db;
}

async function seedOrgAndUser(
  db: Database,
  username: string,
  opts: { isActive?: boolean } = {},
): Promise<{ orgId: string; userId: string; ctx: RequestContext }> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const now = new Date();
  await db.insert(schema.organizations).values({
    id: orgId,
    name: "Test",
    displayName: "Test",
    slug: `test-${orgId.slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.users).values({
    id: userId,
    organizationId: orgId,
    username,
    passwordHash: "x",
    name: username,
    role: "Candidate",
    isActive: opts.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  });
  return { orgId, userId, ctx: createContext(orgId) };
}

describe("staffInvitationRepo (#297)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const iso = await getIsolatedTestDb("staffinvit");
    db = iso.db;
    auxUrl = iso.databaseUrl;
    auxSchema = iso.schemaName;
    cleanup = iso.cleanup;
  }, 30_000);
  afterAll(async () => {
    await auxConn?.sql.end().catch(() => {});
    auxConn = null;
    await cleanup();
  });

  it("creates a pending invitation and supersedes a prior open one", async () => {
    const { orgId, userId, ctx } = await seedOrgAndUser(db, "inviter-1");
    const repo = createStaffInvitationRepo(db);
    const now = new Date();

    const first = await repo.createWithinTransaction(ctx, {
      email: "alice@example.com",
      role: "Teacher",
      tokenHash: hashToken(generateToken()),
      expiresAt: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
      createdBy: userId,
      now: NOW,
    });
    expect(
      computeStaffInvitationStatus({
        consumedAt: first.consumedAt,
        revokedAt: first.revokedAt,
        expiresAt: first.expiresAt,
        now: new Date(),
      }),
    ).toBe("pending");

    const second = await repo.createWithinTransaction(ctx, {
      email: "ALICE@example.com".toLowerCase(),
      role: "Grader",
      tokenHash: hashToken(generateToken()),
      expiresAt: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
      createdBy: userId,
      now: NOW,
    });

    const rows = await db.select().from(schema.staffInvitations);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(first.id)?.revokedAt).not.toBeNull();
    expect(byId.get(second.id)?.revokedAt).toBeNull();
    expect(orgId).toBe(second.organizationId);
  });

  it("consumes a valid open invitation exactly once (CAS)", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "inviter-2");
    const repo = createStaffInvitationRepo(db);
    const invitation = await repo.createWithinTransaction(ctx, {
      email: "bob@example.com",
      role: "Admin",
      tokenHash: hashToken("raw-token-bob"),
      expiresAt: new Date(Date.now() + 3600 * 1000),
      createdBy: userId,
      now: NOW,
    });

    const consumed = await executeInTransaction(db, (tx) =>
      createStaffInvitationRepo(tx).consumeByTokenHashWithinTransaction(
        ctx,
        hashToken("raw-token-bob"),
        NOW,
      ),
    );
    expect(consumed?.id).toBe(invitation.id);
    expect(consumed?.consumedAt).not.toBeNull();

    const again = await executeInTransaction(db, (tx) =>
      createStaffInvitationRepo(tx).consumeByTokenHashWithinTransaction(
        ctx,
        hashToken("raw-token-bob"),
        NOW,
      ),
    );
    expect(again).toBeUndefined();
  });

  it("refuses consumption of expired and revoked invitations", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "inviter-3");
    const repo = createStaffInvitationRepo(db);

    const expired = await repo.createWithinTransaction(ctx, {
      email: "carol@example.com",
      role: "Teacher",
      tokenHash: hashToken("raw-token-carol"),
      expiresAt: new Date(NOW.getTime() - 1000),
      createdBy: userId,
      now: NOW,
    });
    expect(
      await repo.consumeByTokenHashWithinTransaction(
        ctx,
        hashToken("raw-token-carol"),
        NOW,
      ),
    ).toBeUndefined();

    const revoked = await repo.createWithinTransaction(ctx, {
      email: "dave@example.com",
      role: "Teacher",
      tokenHash: hashToken("raw-token-dave"),
      expiresAt: new Date(Date.now() + 3600 * 1000),
      createdBy: userId,
      now: NOW,
    });
    await repo.revokeById(ctx, revoked.id, NOW);
    expect(
      await repo.consumeByTokenHashWithinTransaction(
        ctx,
        hashToken("raw-token-dave"),
        NOW,
      ),
    ).toBeUndefined();
    expect(
      (await db.select().from(schema.staffInvitations)).find(
        (r) => r.id === expired.id,
      )?.consumedAt,
    ).toBeNull();
  });

  it("refuses consumption from a foreign organization context", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "inviter-4");
    const other = await seedOrgAndUser(db, "inviter-4-other");
    await createStaffInvitationRepo(db).createWithinTransaction(ctx, {
      email: "eve@example.com",
      role: "Proctor",
      tokenHash: hashToken("raw-token-eve"),
      expiresAt: new Date(Date.now() + 3600 * 1000),
      createdBy: userId,
      now: NOW,
    });
    expect(
      await createStaffInvitationRepo(db).consumeByTokenHashWithinTransaction(
        other.ctx,
        hashToken("raw-token-eve"),
        NOW,
      ),
    ).toBeUndefined();
  });

  it("lets exactly one concurrent double-consume win", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "inviter-5");
    await createStaffInvitationRepo(db).createWithinTransaction(ctx, {
      email: "frank@example.com",
      role: "Maintainer",
      tokenHash: hashToken("raw-token-frank"),
      expiresAt: new Date(Date.now() + 3600 * 1000),
      createdBy: userId,
      now: NOW,
    });

    const attempts = await Promise.all(
      [0, 1, 2, 3].map(() =>
        executeInTransaction(db, (tx) =>
          createStaffInvitationRepo(tx).consumeByTokenHashWithinTransaction(
            ctx,
            hashToken("raw-token-frank"),
            NOW,
          ),
        ),
      ),
    );
    expect(attempts.filter((r) => r !== undefined)).toHaveLength(1);
  });

  it("revokeById is fail-closed for missing, foreign, or non-open invitations", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "inviter-6");
    const repo = createStaffInvitationRepo(db);
    const invitation = await repo.createWithinTransaction(ctx, {
      email: "gina@example.com",
      role: "Teacher",
      tokenHash: hashToken("raw-token-gina"),
      expiresAt: new Date(Date.now() + 3600 * 1000),
      createdBy: userId,
      now: NOW,
    });
    expect(await repo.revokeById(ctx, randomUUID(), NOW)).toBeNull();

    // Revoking the real invitation closes it; consumption then fails closed.
    expect(await repo.revokeById(ctx, invitation.id, NOW)).not.toBeNull();
    expect(
      await repo.consumeByTokenHashWithinTransaction(
        ctx,
        hashToken("raw-token-gina"),
        NOW,
      ),
    ).toBeUndefined();
    // Second revoke: already revoked -> 404-folded null.
    expect(await repo.revokeById(ctx, invitation.id, NOW)).toBeNull();
  });

  it("concurrent duplicate invite: exactly one success, the loser surfaces ConflictError (never a raw unique violation)", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "inviter-7");
    const aux = await auxDb();
    const invite = (dbArg: Database, tag: string) =>
      inTx(dbArg, (tx) =>
        createStaffInvitationRepo(tx).createWithinTransaction(ctx, {
          email: "dupe-race@example.com",
          role: "Teacher",
          tokenHash: hashToken(`dupe-race-${tag}`),
          expiresAt: new Date(Date.now() + 3600 * 1000),
          createdBy: userId,
          now: NOW,
        }),
      );
    // Genuinely concurrent: separate connections, so the two INSERTs really
    // contend on the partial unique index (not on a pool queue).
    const results = await Promise.allSettled([
      invite(db, "a"),
      invite(aux, "b"),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictError);
    // Exactly one OPEN invitation survives.
    const open = await db
      .select()
      .from(schema.staffInvitations)
      .where(
        and(
          eq(schema.staffInvitations.email, "dupe-race@example.com"),
          isNull(schema.staffInvitations.revokedAt),
          isNull(schema.staffInvitations.consumedAt),
        ),
      );
    expect(open).toHaveLength(1);
  });
});

/**
 * All flows and schedules below run "read committed" — the isolation the
 * production routes pass explicitly (see auth.ts) because the lock-ordered
 * revalidation/burn semantics require post-wait visibility of committed
 * state. The default repeatable read + retry wrapper of executeInTransaction
 * would (a) hide an issuance-commit from a waiting deactivation's burn and
 * (b) retry through already-resolved test barriers, so it must not be used
 * for these deterministic schedules.
 */
function inTx<T>(dbArg: Database, fn: (tx: TransactionDatabase) => Promise<T>) {
  return executeInTransaction(dbArg, fn, "read committed");
}

/**
 * Route-faithful consume composition (the POST /auth/password-reset/consume
 * transaction, minus audit): identify → lock USER row → CAS-consume →
 * credential mutation, all in the canonical lock order
 * USER → PASSWORD_RESET_TOKEN(S) → credential mutation.
 */
function consumeFlow(
  dbArg: Database,
  ctx: RequestContext,
  rawTokenHash: string,
  passwordHash = "new-hash",
) {
  return inTx(dbArg, async (tx) => {
    const tokenRepo = createPasswordResetTokenRepo(tx);
    const identified = await tokenRepo.findOpenUserIdByTokenHash(
      ctx,
      rawTokenHash,
      NOW,
    );
    if (!identified) return null;
    const locked = await createUserRepo(tx).lockByIdWithinTransaction(
      ctx,
      identified.userId,
    );
    if (!locked || !locked.isActive) return null;
    const consumed = await tokenRepo.consumeByTokenHashForUserWithinTransaction(
      ctx,
      { tokenHash: rawTokenHash, userId: identified.userId },
      NOW,
    );
    if (!consumed) return null;
    await createUserRepo(tx).updatePasswordAndAdvanceAuthEpoch(
      ctx,
      identified.userId,
      passwordHash,
    );
    return consumed;
  });
}

/**
 * Route-faithful issuance composition (POST /auth/password-reset/request,
 * minus email rendering/outbox/audit): lock USER row first, revalidate every
 * gate under it, then issue. Returns the internal routing outcome.
 */
function issueFlow(
  dbArg: Database,
  ctx: RequestContext,
  username: string,
  tokenHash: string,
) {
  return inTx(dbArg, async (tx) => {
    const locked = await createUserRepo(tx).lockByUsernameWithinTransaction(
      ctx,
      username,
    );
    if (!locked) return { outcome: "unknown_user" as const, userId: null };
    if (!locked.isActive) {
      return { outcome: "disabled_user" as const, userId: locked.id };
    }
    await createPasswordResetTokenRepo(tx).issueWithinTransaction(ctx, {
      userId: locked.id,
      tokenHash,
      expiresAt: new Date(NOW.getTime() + HOUR),
      now: NOW,
    });
    return { outcome: "issued" as const, userId: locked.id };
  });
}

/** Route-faithful deactivation composition (PATCH /users/:id tx, minus audit). */
function deactivateFlow(dbArg: Database, ctx: RequestContext, userId: string) {
  return inTx(dbArg, async (tx) => {
    const userRepo = createUserRepo(tx);
    const updated = await userRepo.update(ctx, userId, { isActive: false });
    if (!updated) return false;
    await userRepo.advanceAuthEpoch(ctx, userId);
    await createPasswordResetTokenRepo(tx).deleteAllForUserWithinTransaction(
      ctx,
      userId,
    );
    return true;
  });
}

describe("passwordResetTokenRepo (#297)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const iso = await getIsolatedTestDb("pwreset");
    db = iso.db;
    auxUrl = iso.databaseUrl;
    auxSchema = iso.schemaName;
    cleanup = iso.cleanup;
  }, 30_000);
  afterAll(async () => {
    await auxConn?.sql.end().catch(() => {});
    auxConn = null;
    await cleanup();
  });

  it("newest token wins: issuing invalidates the previous open token", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "resetter-1");
    const repo = createPasswordResetTokenRepo(db);

    const first = await repo.issueWithinTransaction(ctx, {
      userId,
      tokenHash: hashToken("raw-reset-1"),
      expiresAt: new Date(NOW.getTime() + HOUR),
      now: NOW,
    });
    const second = await repo.issueWithinTransaction(ctx, {
      userId,
      tokenHash: hashToken("raw-reset-2"),
      expiresAt: new Date(NOW.getTime() + HOUR),
      now: new Date(NOW.getTime() + 1000),
    });

    const firstReread = (
      await db.select().from(schema.passwordResetTokens)
    ).find((r) => r.id === first.id);
    expect(firstReread?.consumedAt).not.toBeNull();
    expect(await consumeFlow(db, ctx, hashToken("raw-reset-1"))).toBeNull();
    expect((await consumeFlow(db, ctx, hashToken("raw-reset-2")))?.id).toBe(
      second.id,
    );
  });

  it("single-use: the second consume of the same token fails", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "resetter-2");
    await createPasswordResetTokenRepo(db).issueWithinTransaction(ctx, {
      userId,
      tokenHash: hashToken("raw-reset-3"),
      expiresAt: new Date(NOW.getTime() + HOUR),
      now: NOW,
    });
    expect(await consumeFlow(db, ctx, hashToken("raw-reset-3"))).not.toBeNull();
    expect(await consumeFlow(db, ctx, hashToken("raw-reset-3"))).toBeNull();
  });

  it("refuses expired tokens and tokens of deactivated users", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "resetter-3");
    await createPasswordResetTokenRepo(db).issueWithinTransaction(ctx, {
      userId,
      tokenHash: hashToken("raw-reset-4"),
      expiresAt: new Date(NOW.getTime() - 1000),
      now: NOW,
    });
    expect(await consumeFlow(db, ctx, hashToken("raw-reset-4"))).toBeNull();

    const deactivated = await seedOrgAndUser(db, "resetter-3-disabled", {
      isActive: false,
    });
    await createPasswordResetTokenRepo(db).issueWithinTransaction(
      deactivated.ctx,
      {
        userId: deactivated.userId,
        tokenHash: hashToken("raw-reset-5"),
        expiresAt: new Date(NOW.getTime() + HOUR),
        now: NOW,
      },
    );
    void userId;
    expect(
      await consumeFlow(db, deactivated.ctx, hashToken("raw-reset-5")),
    ).toBeNull();
  });

  it("lets exactly one concurrent double-consume win", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "resetter-4");
    await createPasswordResetTokenRepo(db).issueWithinTransaction(ctx, {
      userId,
      tokenHash: hashToken("raw-reset-6"),
      expiresAt: new Date(NOW.getTime() + HOUR),
      now: NOW,
    });
    const attempts = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        consumeFlow(db, ctx, hashToken("raw-reset-6"), `winner-${i}`),
      ),
    );
    const winners = attempts.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    // The credential mutation belongs to the same single winner.
    const user = (
      await db.select().from(schema.users).where(eq(schema.users.id, userId))
    )[0]!;
    expect(user.passwordHash).toMatch(/^winner-/);
  });

  it("concurrent duplicate issuance leaves exactly ONE open token", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "resetter-5");
    await Promise.allSettled(
      [0, 1, 2, 3].map((i) =>
        executeInTransaction(db, (tx) =>
          createPasswordResetTokenRepo(tx).issueWithinTransaction(ctx, {
            userId,
            tokenHash: hashToken(`raw-race-${i}`),
            expiresAt: new Date(NOW.getTime() + HOUR),
            now: NOW,
          }),
        ),
      ),
    );
    // Every issuance either commits (newest-wins) or fails closed on the
    // partial unique index; no interleaving may leave more than one
    // unconsumed token behind. How many happened to win the race is a
    // scheduling accident, not a contract — the open-token count IS.
    const openRows = await db
      .select()
      .from(schema.passwordResetTokens)
      .where(
        and(
          eq(schema.passwordResetTokens.userId, userId),
          isNull(schema.passwordResetTokens.consumedAt),
        ),
      );
    expect(openRows).toHaveLength(1);
  });

  it("the partial unique index backstops the one-open-token invariant", async () => {
    const { orgId, userId } = await seedOrgAndUser(db, "resetter-5b");
    const now = new Date();
    const base = {
      organizationId: orgId,
      userId,
      expiresAt: new Date(now.getTime() + 3600 * 1000),
      createdAt: now,
    };
    await db.insert(schema.passwordResetTokens).values({
      ...base,
      id: randomUUID(),
      tokenHash: hashToken("raw-open-a"),
    });
    await expect(
      db.insert(schema.passwordResetTokens).values({
        ...base,
        id: randomUUID(),
        tokenHash: hashToken("raw-open-b"),
      }),
    ).rejects.toThrow();
  });

  it("deleteAllForUser removes outstanding tokens (deactivation hygiene)", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "resetter-6");
    const repo = createPasswordResetTokenRepo(db);
    await repo.issueWithinTransaction(ctx, {
      userId,
      tokenHash: hashToken("raw-reset-7"),
      expiresAt: new Date(NOW.getTime() + HOUR),
      now: NOW,
    });
    expect(await repo.deleteAllForUserWithinTransaction(ctx, userId)).toBe(1);
    expect(await consumeFlow(db, ctx, hashToken("raw-reset-7"))).toBeNull();
  });

  // ── Deterministic deactivation schedules (adversarial remediation) ──
  // Each schedule serializes on the canonical lock order
  // USER → PASSWORD_RESET_TOKEN(S) → credential mutation. Barriers prove
  // the interleaving; every schedule completing IS the no-deadlock proof
  // (a PostgreSQL deadlock would reject one tx with SQLSTATE 40P01).

  it("schedule A — deactivation commits before in-flight issuance: NO reset capability survives, even across reactivation", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "sched-a");
    // Stale pre-transaction observation: the user LOOKS active (the race
    // window the pre-lock implementation trusted).
    const stale = await createUserRepo(db).findByOrganizationAndUsername(
      ctx,
      "sched-a",
    );
    expect(stale?.isActive).toBe(true);

    // Deactivation commits completely (burns tokens, bumps epoch).
    expect(await deactivateFlow(db, ctx, userId)).toBe(true);

    // The issuance transaction runs only afterwards — under the canonical
    // order it must revalidate the account state under the user row lock,
    // never trust the stale observation.
    const result = await issueFlow(db, ctx, "sched-a", hashToken("sched-a"));
    expect(result.outcome).toBe("disabled_user");

    // No capability exists to survive the deactivate/reactivate cycle.
    expect(
      await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, userId)),
    ).toHaveLength(0);

    // Reactivation cannot resurrect anything: still zero tokens, and the
    // pre-deactivation epoch bump keeps old sessions dead.
    await createUserRepo(db).update(ctx, userId, { isActive: true });
    expect(
      await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, userId)),
    ).toHaveLength(0);
    const user = (
      await db.select().from(schema.users).where(eq(schema.users.id, userId))
    )[0]!;
    expect(user.authEpoch).toBeGreaterThanOrEqual(1);
  });

  it("schedule B — issuance wins the user lock before deactivation: the issued token is burned", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "sched-b");
    const aux = await auxDb();
    const locked = deferred();
    const release = deferred();

    // The parked issuance runs on the AUX connection; the deactivation must
    // genuinely block on the USER ROW LOCK, not on a pool queue.
    const issuance = inTx(aux, async (tx) => {
      const lockedUser = await createUserRepo(
        tx,
      ).lockByUsernameWithinTransaction(ctx, "sched-b");
      if (!lockedUser?.isActive) return "disabled_user" as const;
      locked.resolve(); // we now HOLD the user row lock
      await release.promise;
      await createPasswordResetTokenRepo(tx).issueWithinTransaction(ctx, {
        userId,
        tokenHash: hashToken("sched-b"),
        expiresAt: new Date(NOW.getTime() + HOUR),
        now: NOW,
      });
      return "issued" as const;
    });

    await locked.promise;
    // Deactivation MUST block on the user row lock until issuance commits.
    const burn = deactivateFlow(db, ctx, userId);
    release.resolve();
    const [outcome, deactivated] = await Promise.all([issuance, burn]);
    expect(outcome).toBe("issued");
    expect(deactivated).toBe(true);

    // Final state: the capability deactivation found was burned.
    expect(
      await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, userId)),
    ).toHaveLength(0);
  });

  it("schedule C1 — consume races deactivation and wins the user lock first: reset applies, deactivation still lands, old sessions die", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "sched-c1");
    const tokenHash = hashToken("sched-c1");
    await createPasswordResetTokenRepo(db).issueWithinTransaction(ctx, {
      userId,
      tokenHash,
      expiresAt: new Date(NOW.getTime() + HOUR),
      now: NOW,
    });
    const before = (
      await db.select().from(schema.users).where(eq(schema.users.id, userId))
    )[0]!;

    const aux = await auxDb();
    const locked = deferred();
    const release = deferred();
    // Parked consume runs on the AUX connection (see schedule B).
    const consume = inTx(aux, async (tx) => {
      const tokenRepo = createPasswordResetTokenRepo(tx);
      const identified = await tokenRepo.findOpenUserIdByTokenHash(
        ctx,
        tokenHash,
        NOW,
      );
      if (!identified) return "fail" as const;
      const lockedUser = await createUserRepo(tx).lockByIdWithinTransaction(
        ctx,
        identified.userId,
      );
      if (!lockedUser?.isActive) return "fail" as const;
      locked.resolve(); // consume HOLDS the user row lock
      await release.promise;
      const consumed =
        await tokenRepo.consumeByTokenHashForUserWithinTransaction(
          ctx,
          { tokenHash, userId: identified.userId },
          NOW,
        );
      if (!consumed) return "fail" as const;
      await createUserRepo(tx).updatePasswordAndAdvanceAuthEpoch(
        ctx,
        identified.userId,
        "reset-hash",
      );
      return "reset" as const;
    });

    await locked.promise;
    // Deactivation blocks on the user row lock until the reset commits.
    const burn = deactivateFlow(db, ctx, userId);
    release.resolve();
    const [outcome, deactivated] = await Promise.all([consume, burn]);
    expect(outcome).toBe("reset");
    expect(deactivated).toBe(true);

    // Documented final state: password reset applied, token consumed (then
    // burned), account INACTIVE, epoch advanced twice (reset + deactivation)
    // so every pre-reset session is dead.
    const user = (
      await db.select().from(schema.users).where(eq(schema.users.id, userId))
    )[0]!;
    expect(user.passwordHash).toBe("reset-hash");
    expect(user.isActive).toBe(false);
    expect(user.authEpoch).toBe(before.authEpoch + 2);
    expect(
      await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, userId)),
    ).toHaveLength(0);
  });

  it("schedule C2 — deactivation wins before the consuming tx acquires the user lock: reset fails closed", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "sched-c2");
    const tokenHash = hashToken("sched-c2");
    await createPasswordResetTokenRepo(db).issueWithinTransaction(ctx, {
      userId,
      tokenHash,
      expiresAt: new Date(NOW.getTime() + HOUR),
      now: NOW,
    });
    const before = (
      await db.select().from(schema.users).where(eq(schema.users.id, userId))
    )[0]!;

    const aux = await auxDb();
    const identifiedGate = deferred();
    const release = deferred();
    // Parked consume runs on the AUX connection (see schedule B).
    const consume = inTx(aux, async (tx) => {
      const tokenRepo = createPasswordResetTokenRepo(tx);
      // Step 1: identify (read-only, no locks, mutates nothing).
      const identified = await tokenRepo.findOpenUserIdByTokenHash(
        ctx,
        tokenHash,
        NOW,
      );
      identifiedGate.resolve();
      await release.promise;
      if (!identified) return "fail" as const;
      // Step 2 (runs AFTER deactivation committed): lock + revalidate.
      const lockedUser = await createUserRepo(tx).lockByIdWithinTransaction(
        ctx,
        identified.userId,
      );
      if (!lockedUser || !lockedUser.isActive) return "fail_closed" as const;
      const consumed =
        await tokenRepo.consumeByTokenHashForUserWithinTransaction(
          ctx,
          { tokenHash, userId: identified.userId },
          NOW,
        );
      if (!consumed) return "fail" as const;
      await createUserRepo(tx).updatePasswordAndAdvanceAuthEpoch(
        ctx,
        identified.userId,
        "reset-hash",
      );
      return "reset" as const;
    });

    // The consume has identified the token (pre-lock) but holds nothing.
    await identifiedGate.promise;
    // Deactivation acquires the user lock, burns the token, and commits
    // BEFORE the consumer gets the lock.
    expect(await deactivateFlow(db, ctx, userId)).toBe(true);
    release.resolve();
    expect(await consume).toBe("fail_closed");

    // Documented final state: no deadlock (both completed), password and
    // epoch untouched by the reset, account inactive, tokens gone.
    const user = (
      await db.select().from(schema.users).where(eq(schema.users.id, userId))
    )[0]!;
    expect(user.passwordHash).toBe(before.passwordHash);
    expect(user.authEpoch).toBe(before.authEpoch + 1);
    expect(user.isActive).toBe(false);
    expect(
      await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, userId)),
    ).toHaveLength(0);
  });
});
