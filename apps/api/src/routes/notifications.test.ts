import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import notificationRoutes from "./notifications.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  type TestContext,
} from "./testHelpers.js";
import { createNotificationRepo } from "@exam/db/src/repository/notificationRepo.js";

// P5-N1-I3 — Notification Inbox API integration tests (P5-N1-R0 §25.6).
//
// All four endpoints are authenticate-only, scoped to the actor's own
// notifications. Cross-user access returns a non-leaking 404
// (anti-enumeration). Mark-read is idempotent. Pagination is bounded.

describe("notification routes", () => {
  let ctx: TestContext;
  let otherUserId: string;
  let otherToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(notificationRoutes);
    // Create a second user in the same org to prove cross-user isolation.
    const other = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Candidate",
      "other-cand",
    );
    otherUserId = other.user.id;
    otherToken = other.token;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /** Seeds a notification for a recipient directly via the repo. */
  async function seedNotification(
    recipientUserId: string,
    overrides: Partial<{
      title: string;
      body: string;
      actionPath: string | null;
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
      // Seed one for the candidate and one for the other user.
      await seedNotification(ctx.candidate.id);
      await seedNotification(otherUserId);

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications",
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].recipientUserId).toBe(ctx.candidate.id);
      expect(body.total).toBe(1);
    });

    it("does not leak another user's notifications (cross-user isolation)", async () => {
      await seedNotification(otherUserId, { title: "secret-for-other" });
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications",
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      for (const item of body.items) {
        expect(item.title).not.toBe("secret-for-other");
        expect(item.recipientUserId).toBe(ctx.candidate.id);
      }
    });

    it("filters to unread when ?unread=true", async () => {
      const unread = await seedNotification(ctx.candidate.id, {
        title: "unread-only",
        dedupeKey: `result_published:unread-${randomUUID()}`,
      });
      const read = await seedNotification(ctx.candidate.id, {
        title: "already-read",
        dedupeKey: `result_published:read-${randomUUID()}`,
      });
      // Mark the second one read via the repo.
      const repo = createNotificationRepo(ctx.db);
      const candCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [],
        sessionId: "s",
      };
      await repo.markRead(candCtx, ctx.candidate.id, read.id);
      void unread;

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications?unread=true",
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      for (const item of body.items) {
        expect(item.readAt).toBeNull();
      }
    });

    it("rejects pageSize > 100 (bounded pagination)", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications?pageSize=101",
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/notifications/unread-count", () => {
    it("returns the count of unread notifications for the actor", async () => {
      await seedNotification(ctx.candidate.id, {
        dedupeKey: `result_published:count-1-${randomUUID()}`,
      });
      await seedNotification(ctx.candidate.id, {
        dedupeKey: `result_published:count-2-${randomUUID()}`,
      });
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications/unread-count",
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBeGreaterThanOrEqual(2);
    });

    it("returns 0 for a user with no unread notifications", async () => {
      const repo = createNotificationRepo(ctx.db);
      const otherCtx = {
        actorId: otherUserId,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [],
        sessionId: "s",
      };
      await repo.markAllRead(otherCtx, otherUserId);
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications/unread-count",
        cookies: { "auth-token": otherToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(0);
    });
  });

  describe("POST /api/notifications/:id/read", () => {
    it("marks one notification read and returns it", async () => {
      const seeded = await seedNotification(ctx.candidate.id, {
        dedupeKey: `result_published:markread-${randomUUID()}`,
      });
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/notifications/${seeded.id}/read`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(seeded.id);
      expect(body.readAt).not.toBeNull();
    });

    it("is idempotent (repeat read returns 200 with the row)", async () => {
      const seeded = await seedNotification(ctx.candidate.id, {
        dedupeKey: `result_published:idem-${randomUUID()}`,
      });
      await ctx.app.inject({
        method: "POST",
        url: `/api/notifications/${seeded.id}/read`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const second = await ctx.app.inject({
        method: "POST",
        url: `/api/notifications/${seeded.id}/read`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(seeded.id);
    });

    it("returns 404 for another user's notification (anti-enumeration)", async () => {
      const foreign = await seedNotification(otherUserId, {
        dedupeKey: `result_published:foreign-${randomUUID()}`,
      });
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/notifications/${foreign.id}/read`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for a missing notification id", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/notifications/${randomUUID()}/read`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/notifications/read-all", () => {
    it("marks all unread read for the actor and returns the count", async () => {
      await seedNotification(ctx.candidate.id, {
        dedupeKey: `result_published:ra-1-${randomUUID()}`,
      });
      await seedNotification(ctx.candidate.id, {
        dedupeKey: `result_published:ra-2-${randomUUID()}`,
      });
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/notifications/read-all",
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().updated).toBeGreaterThanOrEqual(2);
      const countRes = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications/unread-count",
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(countRes.json().count).toBe(0);
    });

    it("does not touch another user's notifications", async () => {
      await seedNotification(otherUserId, {
        dedupeKey: `result_published:other-ra-${randomUUID()}`,
      });
      await ctx.app.inject({
        method: "POST",
        url: "/api/notifications/read-all",
        cookies: { "auth-token": ctx.candidateToken },
      });
      const countRes = await ctx.app.inject({
        method: "GET",
        url: "/api/notifications/unread-count",
        cookies: { "auth-token": otherToken },
      });
      // The other user still has their unread row (read-all was scoped to the
      // candidate actor). They may have >= 1 unread from this seed.
      expect(countRes.json().count).toBeGreaterThanOrEqual(1);
    });
  });
});
