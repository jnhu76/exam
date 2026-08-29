import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { and, desc, eq, isNull } from "drizzle-orm";
import { hashToken } from "@exam/auth/src/tokens.js";
import authRoutes from "./auth.js";
import userRoutes from "./user.js";
import invitationRoutes from "./invitation.js";
import { buildTestApp, createAssignedUserForTest } from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";

/**
 * The full identity-lifecycle route composition (#297): auth (public accept
 * + reset endpoints), users (admin deactivation), invitations (admin).
 */
const identityRoutes: FastifyPluginAsync = async (app) => {
  // buildTestApp already applies the outer "/api" prefix — inner prefixes are
  // relative to it (auth mounts at /api/auth, the rest at /api/...).
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(userRoutes);
  await app.register(invitationRoutes);
};

function adminAuth(ctx: { adminToken: string }) {
  return { "auth-token": ctx.adminToken };
}

/** Extracts the raw token from a reset/invite link embedded in an email body. */
function extractTokenFromLink(linkOrBody: string): string {
  const match = linkOrBody.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`no token link in: ${linkOrBody.slice(0, 120)}`);
  return match[1]!;
}

describe("staff invitation flow (#297)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(identityRoutes);
  });

  afterAll(async () => {
    await ctx.drainAuditWrites();
    await ctx.cleanup();
  });

  it("invite → accept end to end: one-time URL, outbox row, audit, working account", async () => {
    const inviteRes = await ctx.app.inject({
      method: "POST",
      url: "/api/invitations",
      cookies: adminAuth(ctx),
      payload: { email: "new-teacher@example.com", role: "Teacher" },
    });
    expect(inviteRes.statusCode).toBe(201);
    const { invitation, acceptUrl } = inviteRes.json();
    expect(invitation.status).toBe("pending");
    expect(acceptUrl).toContain("/invite/accept?token=");

    // Invitation + outbox row + audit committed atomically.
    const outboxRows = await ctx.db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.type, "staff_invitation"));
    expect(outboxRows.at(-1)?.recipientEmail).toBe("new-teacher@example.com");
    // The raw token lives in the email body (the delivery carrier) — and
    // nowhere else server-side.
    const token = extractTokenFromLink(acceptUrl);
    expect(outboxRows.at(-1)?.bodyText).toContain(token);
    await ctx.drainAuditWrites();
    const audits = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "user.invited"));
    const invitedAudit = audits.at(-1);
    expect(invitedAudit).toBeDefined();
    expect(JSON.stringify(invitedAudit?.metadata)).not.toContain(token);
    expect(JSON.stringify(invitedAudit?.metadata)).toContain(
      "new-teacher@example.com",
    );

    // Acceptance: public, activates the account with the invited role.
    const acceptRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/invitations/accept",
      payload: {
        token,
        username: "invited-teacher",
        name: "受邀教师",
        password: "Sup3rSecret!",
      },
    });
    expect(acceptRes.statusCode).toBe(201);
    expect(acceptRes.json().user.username).toBe("invited-teacher");

    // The new account can log in and holds the invited role.
    const loginRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "invited-teacher", password: "Sup3rSecret!" },
    });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json().role).toBe("Teacher");

    await ctx.drainAuditWrites();
    const acceptAudits = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "user.invitation_accepted"));
    expect(acceptAudits.at(-1)?.targetId).toBe(acceptRes.json().user.id);
  });

  it("acceptance is single-use: duplicate submit fails closed", async () => {
    const inviteRes = await ctx.app.inject({
      method: "POST",
      url: "/api/invitations",
      cookies: adminAuth(ctx),
      payload: { email: "single-use@example.com", role: "Grader" },
    });
    const token = extractTokenFromLink(inviteRes.json().acceptUrl);
    const payload = {
      token,
      username: "single-use-grader",
      name: "一次性",
      password: "Sup3rSecret!",
    };
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/auth/invitations/accept",
          payload,
        })
      ).statusCode,
    ).toBe(201);

    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/invitations/accept",
      payload: { ...payload, username: "single-use-grader-2" },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().error.code).toBe("INVITATION_INVALID");
    const users = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, "single-use-grader-2"));
    expect(users).toHaveLength(0);
  });

  it("concurrent duplicate acceptance yields exactly one account", async () => {
    const inviteRes = await ctx.app.inject({
      method: "POST",
      url: "/api/invitations",
      cookies: adminAuth(ctx),
      payload: { email: "race@example.com", role: "Proctor" },
    });
    const token = extractTokenFromLink(inviteRes.json().acceptUrl);
    const attempts = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        ctx.app.inject({
          method: "POST",
          url: "/api/auth/invitations/accept",
          payload: {
            token,
            username: `race-proctor-${i}`,
            name: "并发",
            password: "Sup3rSecret!",
          },
        }),
      ),
    );
    expect(attempts.filter((r) => r.statusCode === 201)).toHaveLength(1);
    const users = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "race@example.com"));
    expect(users).toHaveLength(1);
  });

  it("expired invitation fails closed", async () => {
    const rawToken = "expired-token-expired-token-1234";
    const now = new Date();
    await ctx.db.insert(schema.staffInvitations).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      email: "expired@example.com",
      role: "Teacher",
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(now.getTime() - 1000),
      createdBy: ctx.admin.id,
      createdAt: now,
      updatedAt: now,
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/invitations/accept",
      payload: {
        token: rawToken,
        username: "expired-invitee",
        name: "过期",
        password: "Sup3rSecret!",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVITATION_INVALID");
  });

  it("revocation: revoked token cannot accept; double revoke folds into 404", async () => {
    const inviteRes = await ctx.app.inject({
      method: "POST",
      url: "/api/invitations",
      cookies: adminAuth(ctx),
      payload: { email: "revoked@example.com", role: "Maintainer" },
    });
    const { invitation, acceptUrl } = inviteRes.json();
    const token = extractTokenFromLink(acceptUrl);

    const revokeRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/invitations/${invitation.id}`,
      cookies: adminAuth(ctx),
    });
    expect(revokeRes.statusCode).toBe(200);

    const acceptRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/invitations/accept",
      payload: {
        token,
        username: "revoked-invitee",
        name: "已撤销",
        password: "Sup3rSecret!",
      },
    });
    expect(acceptRes.statusCode).toBe(400);

    const secondRevoke = await ctx.app.inject({
      method: "DELETE",
      url: `/api/invitations/${invitation.id}`,
      cookies: adminAuth(ctx),
    });
    expect(secondRevoke.statusCode).toBe(404);
  });

  it("username conflict at acceptance rolls back and keeps the invitation open", async () => {
    const inviteRes = await ctx.app.inject({
      method: "POST",
      url: "/api/invitations",
      cookies: adminAuth(ctx),
      payload: { email: "conflict@example.com", role: "Teacher" },
    });
    const token = extractTokenFromLink(inviteRes.json().acceptUrl);
    const conflict = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/invitations/accept",
      payload: {
        token,
        username: ctx.admin.username,
        name: "冲突",
        password: "Sup3rSecret!",
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("USER_ALREADY_EXISTS");

    const retry = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/invitations/accept",
      payload: {
        token,
        username: "conflict-resolved",
        name: "冲突已解决",
        password: "Sup3rSecret!",
      },
    });
    expect(retry.statusCode).toBe(201);
  });

  it("invitation management is capability-gated (candidate cannot invite)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/invitations",
      cookies: { "auth-token": ctx.candidateToken },
      payload: { email: "sneaky@example.com", role: "Admin" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("list derives computed status (pending → accepted)", async () => {
    const inviteRes = await ctx.app.inject({
      method: "POST",
      url: "/api/invitations",
      cookies: adminAuth(ctx),
      payload: { email: "listed@example.com", role: "Teacher" },
    });
    const { invitation } = inviteRes.json();
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/invitations/accept",
      payload: {
        token: extractTokenFromLink(inviteRes.json().acceptUrl),
        username: "listed-invitee",
        name: "列表",
        password: "Sup3rSecret!",
      },
    });
    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/invitations",
      cookies: adminAuth(ctx),
    });
    expect(listRes.statusCode).toBe(200);
    const listed = listRes
      .json()
      .items.find((i: { id: string }) => i.id === invitation.id);
    expect(listed.status).toBe("accepted");
    expect(listed.consumedAt).not.toBeNull();
  });
});

describe("email password reset flow (#297)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let staff: Awaited<ReturnType<typeof createAssignedUserForTest>>;

  beforeAll(async () => {
    ctx = await buildTestApp(identityRoutes);
  });

  afterAll(async () => {
    await ctx.drainAuditWrites();
    await ctx.cleanup();
  });

  /** Creates a staff user with an email and returns (user, password). */
  async function createStaffWithEmail(username: string) {
    const password = "OldPassword1!";
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      cookies: adminAuth(ctx),
      payload: {
        username,
        password,
        name: username,
        role: "Teacher",
        email: `${username}@example.com`,
      },
    });
    expect(res.statusCode).toBe(201);
    return { userId: res.json().id as string, username, password };
  }

  async function latestResetOutboxRow() {
    const rows = await ctx.db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.type, "password_reset"))
      .orderBy(desc(schema.emailOutbox.createdAt));
    return rows[0];
  }

  it("request is uniform across unknown / no-email / disabled accounts", async () => {
    const staffUser = await createStaffWithEmail("reset-uniform");

    const unknown = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { username: "no-such-user-xyz" },
    });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toEqual({ ok: true });

    // Staff user WITHOUT email.
    await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      cookies: adminAuth(ctx),
      payload: {
        username: "reset-noemail",
        password: "OldPassword1!",
        name: "no-email",
        role: "Teacher",
      },
    });
    const noEmail = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { username: "reset-noemail" },
    });
    expect(noEmail.json()).toEqual({ ok: true });

    // Disabled account.
    await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${staffUser.userId}`,
      cookies: adminAuth(ctx),
      payload: { isActive: false },
    });
    const disabled = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { username: staffUser.username },
    });
    expect(disabled.json()).toEqual({ ok: true });

    // None of the above produced an outbox row.
    const rows = await ctx.db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.type, "password_reset"));
    expect(rows).toHaveLength(0);

    await ctx.drainAuditWrites();
    const audits = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "auth.password_reset_requested"));
    const outcomes = audits
      .map((a) => a.metadata)
      .map((m) => (m as { outcome: string }).outcome);
    expect(outcomes).toContain("unknown_user");
    expect(outcomes).toContain("no_email");
    expect(outcomes).toContain("disabled_user");
    void staffUser;
  });

  it("full reset: request → email link → consume; old password dies, epoch revokes", async () => {
    const staffUser = await createStaffWithEmail("reset-full");
    // A live JWT from before the reset must die with the epoch advance.
    const preLogin = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: staffUser.username, password: staffUser.password },
    });
    expect(preLogin.statusCode).toBe(200);
    const preCookie = preLogin.cookies.find(
      (c: { name: string; value: string }) => c.name === "auth-token",
    );
    expect(preCookie).toBeDefined();

    const requestRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { username: staffUser.username },
    });
    expect(requestRes.statusCode).toBe(200);

    const outboxRow = await latestResetOutboxRow();
    expect(outboxRow).toBeDefined();
    expect(outboxRow?.recipientEmail).toBe(`${staffUser.username}@example.com`);
    expect(outboxRow?.status).toBe("pending");
    const token = extractTokenFromLink(outboxRow!.bodyText);

    const consumeRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/consume",
      payload: { token, password: "NewPassword1!" },
    });
    expect(consumeRes.statusCode).toBe(200);

    // Old password rejected; new password works.
    const oldLogin = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: staffUser.username, password: staffUser.password },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: staffUser.username, password: "NewPassword1!" },
    });
    expect(newLogin.statusCode).toBe(200);

    // Pre-reset JWT is revoked (password reset advances the auth epoch).
    const staleMe = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { "auth-token": preCookie!.value },
    });
    expect(staleMe.statusCode).toBe(401);
  });

  it("consume is single-use and concurrent-safe", async () => {
    const staffUser = await createStaffWithEmail("reset-single");
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { username: staffUser.username },
    });
    const token = extractTokenFromLink(
      (await latestResetOutboxRow())!.bodyText,
    );

    const attempts = await Promise.all(
      [0, 1, 2].map((i) =>
        ctx.app.inject({
          method: "POST",
          url: "/api/auth/password-reset/consume",
          payload: { token, password: `NewPassword${i}x!` },
        }),
      ),
    );
    expect(attempts.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(attempts.filter((r) => r.statusCode === 400)).toHaveLength(2);
  });

  it("expired reset token fails closed; only newest token is valid", async () => {
    const staffUser = await createStaffWithEmail("reset-expire");
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { username: staffUser.username },
    });
    const firstToken = extractTokenFromLink(
      (await latestResetOutboxRow())!.bodyText,
    );

    // Expire the open token directly, then request a fresh one via the
    // cooldown-bypassing clock override.
    const openRows = await ctx.db
      .select()
      .from(schema.passwordResetTokens)
      .where(isNull(schema.passwordResetTokens.consumedAt));
    expect(openRows.length).toBeGreaterThan(0);
    await ctx.db
      .update(schema.passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(isNull(schema.passwordResetTokens.consumedAt));

    const expired = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/consume",
      payload: { token: firstToken, password: "NewPassword1!" },
    });
    expect(expired.statusCode).toBe(400);

    ctx.setNow(new Date(Date.now() + 2 * 60 * 1000));
    try {
      await ctx.app.inject({
        method: "POST",
        url: "/api/auth/password-reset/request",
        payload: { username: staffUser.username },
      });
      const secondToken = extractTokenFromLink(
        (await latestResetOutboxRow())!.bodyText,
      );
      // Newest token wins: the first (expired) token must never resurrect,
      // the second works.
      expect(secondToken).not.toBe(firstToken);
      const consume = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/password-reset/consume",
        payload: { token: secondToken, password: "NewPassword2!" },
      });
      expect(consume.statusCode).toBe(200);
    } finally {
      ctx.setNow(null);
    }
  });

  it("cooldown: repeated requests do not send a second email", async () => {
    const staffUser = await createStaffWithEmail("reset-cooldown");
    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { username: staffUser.username },
    });
    expect(first.statusCode).toBe(200);
    const rowsAfterFirst = await ctx.db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.type, "password_reset"));
    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { username: staffUser.username },
    });
    expect(second.json()).toEqual({ ok: true });
    const rowsAfterSecond = await ctx.db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.type, "password_reset"));
    expect(rowsAfterSecond.length).toBe(rowsAfterFirst.length);
  });

  it("deactivation burns outstanding reset tokens and live JWTs survive no reactivation", async () => {
    const staffUser = await createStaffWithEmail("reset-deactivate");
    const preLogin = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: staffUser.username, password: staffUser.password },
    });
    const preCookie = preLogin.cookies.find(
      (c: { name: string; value: string }) => c.name === "auth-token",
    )!;

    // Outstanding reset token.
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { username: staffUser.username },
    });
    const token = extractTokenFromLink(
      (await latestResetOutboxRow())!.bodyText,
    );

    // Live session loses authority the moment the account is disabled.
    const disableRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${staffUser.userId}`,
      cookies: adminAuth(ctx),
      payload: { isActive: false },
    });
    expect(disableRes.statusCode).toBe(200);
    const meWhileDisabled = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { "auth-token": preCookie.value },
    });
    expect(meWhileDisabled.statusCode).toBe(401);

    // The outstanding token is burned and stays dead across reactivation.
    await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${staffUser.userId}`,
      cookies: adminAuth(ctx),
      payload: { isActive: true },
    });
    const consume = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/consume",
      payload: { token, password: "NewPassword1!" },
    });
    expect(consume.statusCode).toBe(400);

    // The pre-deactivation JWT is dead even after reactivation (epoch bump).
    const meAfterReactivation = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { "auth-token": preCookie.value },
    });
    expect(meAfterReactivation.statusCode).toBe(401);
  });

  it("cross-user misuse: a reset token is bound to its account, garbage fails closed", async () => {
    await createStaffWithEmail("reset-cross-a");
    const staffB = await createStaffWithEmail("reset-cross-b");
    // Unknown/garbage tokens get the generic error.
    const garbage = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/consume",
      payload: { token: "not-a-real-token-at-all-xyz", password: "Whatever1!" },
    });
    expect(garbage.statusCode).toBe(400);
    expect(garbage.json().error.code).toBe("PASSWORD_RESET_INVALID");
    // Account B's credentials are untouched by any of the above.
    const loginB = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: staffB.username, password: staffB.password },
    });
    expect(loginB.statusCode).toBe(200);
  });

  it("non-e2e mode enforces the reset-request limiter", async () => {
    const vi = await import("vitest");
    vi.vi.stubEnv("APP_MODE", "test");
    vi.vi.stubEnv("RATE_LIMIT_MAX", "1000");
    vi.vi.stubEnv("RATE_LIMIT_WINDOW_MS", "60000");
    const { resetRuntimeConfigForTest } =
      await import("../config/runtimeConfig.js");
    resetRuntimeConfigForTest();

    const limitedCtx = await buildTestApp(identityRoutes, {
      rateLimit: true,
    });
    try {
      for (let i = 0; i < 5; i++) {
        const res = await limitedCtx.app.inject({
          method: "POST",
          url: "/api/auth/password-reset/request",
          payload: { username: `limiter-probe-${i}` },
        });
        expect(res.statusCode).toBe(200);
      }
      const limited = await limitedCtx.app.inject({
        method: "POST",
        url: "/api/auth/password-reset/request",
        payload: { username: "limiter-probe-final" },
      });
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.code).toBe("RATE_LIMITED");
    } finally {
      await limitedCtx.cleanup();
    }
  });

  it("audit rows never contain the raw reset token", async () => {
    const staffUser = await createStaffWithEmail("reset-audit");
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { username: staffUser.username },
    });
    const token = extractTokenFromLink(
      (await latestResetOutboxRow())!.bodyText,
    );
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/consume",
      payload: { token, password: "NewPassword1!" },
    });
    await ctx.drainAuditWrites();
    const audits = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.targetId, staffUser.userId),
          eq(schema.auditLogs.targetType, "user"),
        ),
      );
    for (const row of audits) {
      expect(JSON.stringify(row.metadata)).not.toContain(token);
    }
  });
});
