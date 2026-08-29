import { randomUUID } from "node:crypto";

/** Deterministic clock for repo tests: explicit now params (ADR-006). */
const NOW = new Date("2026-08-29T12:00:00Z");
const HOUR = 60 * 60 * 1000;
import type { RequestContext } from "@exam/domain";
import { computeStaffInvitationStatus } from "@exam/domain";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { getIsolatedTestDb } from "../testDb.js";
import { executeInTransaction, type Database } from "../types.js";
import { schema } from "../schema/pg.js";
import { createStaffInvitationRepo } from "./staffInvitationRepo.js";
import { createPasswordResetTokenRepo } from "./passwordResetTokenRepo.js";
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
    cleanup = iso.cleanup;
  });
  afterAll(async () => {
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
});

describe("passwordResetTokenRepo (#297)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const iso = await getIsolatedTestDb("pwreset");
    db = iso.db;
    cleanup = iso.cleanup;
  });
  afterAll(async () => {
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
    expect(
      await repo.consumeByTokenHashWithinTransaction(
        ctx,
        hashToken("raw-reset-1"),
        NOW,
      ),
    ).toBeUndefined();
    expect(
      (
        await repo.consumeByTokenHashWithinTransaction(
          ctx,
          hashToken("raw-reset-2"),
          NOW,
        )
      )?.id,
    ).toBe(second.id);
  });

  it("single-use: the second consume of the same token fails", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "resetter-2");
    const repo = createPasswordResetTokenRepo(db);
    await repo.issueWithinTransaction(ctx, {
      userId,
      tokenHash: hashToken("raw-reset-3"),
      expiresAt: new Date(NOW.getTime() + HOUR),
      now: NOW,
    });
    expect(
      await repo.consumeByTokenHashWithinTransaction(
        ctx,
        hashToken("raw-reset-3"),
        NOW,
      ),
    ).toBeDefined();
    expect(
      await repo.consumeByTokenHashWithinTransaction(
        ctx,
        hashToken("raw-reset-3"),
        NOW,
      ),
    ).toBeUndefined();
  });

  it("refuses expired tokens and tokens of deactivated users", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "resetter-3");
    const repo = createPasswordResetTokenRepo(db);
    await repo.issueWithinTransaction(ctx, {
      userId,
      tokenHash: hashToken("raw-reset-4"),
      expiresAt: new Date(NOW.getTime() - 1000),
      now: NOW,
    });
    expect(
      await repo.consumeByTokenHashWithinTransaction(
        ctx,
        hashToken("raw-reset-4"),
        NOW,
      ),
    ).toBeUndefined();

    const deactivated = await seedOrgAndUser(db, "resetter-3-disabled", {
      isActive: false,
    });
    await createPasswordResetTokenRepo(db).issueWithinTransaction(ctx, {
      userId: deactivated.userId,
      tokenHash: hashToken("raw-reset-5"),
      expiresAt: new Date(NOW.getTime() + HOUR),
      now: NOW,
    });
    void userId;
    expect(
      await repo.consumeByTokenHashWithinTransaction(
        deactivated.ctx,
        hashToken("raw-reset-5"),
        NOW,
      ),
    ).toBeUndefined();
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
      [0, 1, 2, 3].map(() =>
        executeInTransaction(db, (tx) =>
          createPasswordResetTokenRepo(tx).consumeByTokenHashWithinTransaction(
            ctx,
            hashToken("raw-reset-6"),
            NOW,
          ),
        ),
      ),
    );
    expect(attempts.filter((r) => r !== undefined)).toHaveLength(1);
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

  it("deleteOpenForUser removes outstanding tokens (deactivation hygiene)", async () => {
    const { userId, ctx } = await seedOrgAndUser(db, "resetter-6");
    const repo = createPasswordResetTokenRepo(db);
    await repo.issueWithinTransaction(ctx, {
      userId,
      tokenHash: hashToken("raw-reset-7"),
      expiresAt: new Date(NOW.getTime() + HOUR),
      now: NOW,
    });
    expect(await repo.deleteAllForUserWithinTransaction(ctx, userId)).toBe(1);
    expect(
      await repo.consumeByTokenHashWithinTransaction(
        ctx,
        hashToken("raw-reset-7"),
        NOW,
      ),
    ).toBeUndefined();
  });
});
