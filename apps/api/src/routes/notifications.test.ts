import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import notificationRoutes from "./notifications.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  type TestContext,
} from "./testHelpers.js";
import { createNotificationRepo } from "@exam/db/src/repository/notificationRepo.js";

const AT = new Date("2026-07-25T12:00:00.000Z");

// P5-N1-I3 — Notification Inbox API integration tests (P5-N1-R0 §25.6).
//
// All four endpoints are authenticate-only, scoped to the actor's own
// notifications. Cross-user access returns a non-leaking 404
// (anti-enumeration). Mark-read is idempotent. Pagination is bounded.

describe("notification routes", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp(notificationRoutes);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function createIsolatedUser() {
    const u = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Candidate",
      `notif-${randomUUID().slice(0, 6)}`,
    );
    return { userId: u.user.id, token: u.token };
  }

  async function seedNotification(
    recipientUserId: string,
    overrides: Partial<{
      title: string;
      body: string;
      actionPath: string;
      dedupeKey: string | null;
    }> = {},
  ) {
    const repo = createNotificationRepo(ctx.db);
    const { row } = await repo.insert(
      {
        actorId: recipientUserId,
        organizationId: ctx.org.id,
        role: "Candidate",
        permissions: [],
        sessionId: "s",
      },
      {
        recipientUserId,
        type: "result_published",
        title: overrides.title ?? "考试结果已发布",
        body: overrides.body ?? "您的考试结果已发布。",
        actionPath:
          overrides.actionPath ??
          `/exam/00000000-0000-4000-8000-00000000000a/result`,
        dedupeKey: overrides.dedupeKey ?? `result_published:${randomUUID()}`,
      },
      AT,
    );
    return row;
  }

  describe("unauthenticated requests", () => {
    it("GET /api/notifications returns 401 without a cookie", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications",
      });
      expect(res.statusCode).toBe(401);
    });

    it("GET /api/notifications/unread-count returns 401 without a cookie", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications/unread-count",
      });
      expect(res.statusCode).toBe(401);
    });

    it("POST /api/notifications/:id/read returns 401 without a cookie", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/notifications/${randomUUID()}/read`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("POST /api/notifications/read-all returns 401 without a cookie", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/notifications/read-all",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /api/notifications (own list)", () => {
    it("returns the authenticated user's own notifications only", async () => {
      const user = await createIsolatedUser();
      const other = await createIsolatedUser();
      const seeded = await seedNotification(user.userId);
      await seedNotification(other.userId);

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications",
        cookies: { "auth-token": user.token },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(seeded.id);
      expect(body.items[0].recipientUserId).toBe(user.userId);
      expect(body.total).toBe(1);
    });

    it("does not leak another user's notifications (cross-user isolation)", async () => {
      const user = await createIsolatedUser();
      const other = await createIsolatedUser();
      await seedNotification(user.userId, { title: "mine" });
      await seedNotification(other.userId, { title: "secret-for-other" });

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications",
        cookies: { "auth-token": user.token },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].title).toBe("mine");
      expect(body.items[0].recipientUserId).toBe(user.userId);
    });

    it("filters to unread when ?unread=true", async () => {
      const user = await createIsolatedUser();
      const unread = await seedNotification(user.userId, {
        title: "unread-only",
      });
      const read = await seedNotification(user.userId, {
        title: "already-read",
      });
      const repo = createNotificationRepo(ctx.db);
      await repo.markRead(
        {
          actorId: user.userId,
          organizationId: ctx.org.id,
          role: "Candidate" as const,
          permissions: [],
          sessionId: "s",
        },
        user.userId,
        read.id,
        AT,
      );

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications?unread=true",
        cookies: { "auth-token": user.token },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const ids = body.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(unread.id);
      expect(ids).not.toContain(read.id);
      for (const item of body.items) {
        expect(item.readAt).toBeNull();
      }
    });

    it("rejects pageSize > 100 (bounded pagination)", async () => {
      const user = await createIsolatedUser();
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications?pageSize=101",
        cookies: { "auth-token": user.token },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/notifications/unread-count", () => {
    it("returns the exact count of unread notifications for the actor", async () => {
      const user = await createIsolatedUser();
      await seedNotification(user.userId);
      await seedNotification(user.userId);

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications/unread-count",
        cookies: { "auth-token": user.token },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(2);
    });

    it("returns 0 for a user with no unread notifications", async () => {
      const user = await createIsolatedUser();
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications/unread-count",
        cookies: { "auth-token": user.token },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(0);
    });
  });

  describe("POST /api/notifications/:id/read", () => {
    it("marks one notification read and returns it", async () => {
      const user = await createIsolatedUser();
      const seeded = await seedNotification(user.userId);
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/notifications/${seeded.id}/read`,
        cookies: { "auth-token": user.token },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(seeded.id);
      expect(body.readAt).not.toBeNull();
    });

    it("is idempotent (repeat read returns 200 with the row)", async () => {
      const user = await createIsolatedUser();
      const seeded = await seedNotification(user.userId);
      await ctx.app.inject({
        method: "POST",
        url: `/api/notifications/${seeded.id}/read`,
        cookies: { "auth-token": user.token },
      });
      const second = await ctx.app.inject({
        method: "POST",
        url: `/api/notifications/${seeded.id}/read`,
        cookies: { "auth-token": user.token },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(seeded.id);
    });

    it("returns 404 for another user's notification (anti-enumeration)", async () => {
      const owner = await createIsolatedUser();
      const attacker = await createIsolatedUser();
      const foreign = await seedNotification(owner.userId);
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/notifications/${foreign.id}/read`,
        cookies: { "auth-token": attacker.token },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for a missing notification id", async () => {
      const user = await createIsolatedUser();
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/notifications/${randomUUID()}/read`,
        cookies: { "auth-token": user.token },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/notifications/read-all", () => {
    it("marks all unread read for the actor and returns the exact count", async () => {
      const user = await createIsolatedUser();
      await seedNotification(user.userId);
      await seedNotification(user.userId);

      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/notifications/read-all",
        cookies: { "auth-token": user.token },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().updated).toBe(2);

      const countRes = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications/unread-count",
        cookies: { "auth-token": user.token },
      });
      expect(countRes.json().count).toBe(0);
    });

    it("does not touch another user's notifications", async () => {
      const userA = await createIsolatedUser();
      const userB = await createIsolatedUser();
      await seedNotification(userA.userId);
      await seedNotification(userB.userId);

      await ctx.app.inject({
        method: "POST",
        url: "/api/notifications/read-all",
        cookies: { "auth-token": userA.token },
      });

      const countB = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications/unread-count",
        cookies: { "auth-token": userB.token },
      });
      expect(countB.json().count).toBe(1);
    });
  });
});
