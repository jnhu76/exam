import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { createNotificationRepo } from "./notificationRepo.js";
import { createOrganizationRepo } from "./organizationRepo.js";
import { createUserRepo } from "./userRepo.js";
import { notifications } from "../schema/pg.js";
import type { Database } from "../types.js";
import { eq } from "drizzle-orm";

const AT = new Date("2026-07-25T12:00:00.000Z");

function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

/**
 * Inserts a notification row directly (bypassing the repo) so tests can seed
 * exact `createdAt` / `readAt` scenarios for ordering and dedupe assertions.
 */
async function seedRow(
  db: Database,
  args: {
    organizationId: string;
    recipientUserId: string;
    type?: string;
    title?: string;
    body?: string;
    actionPath?: string;
    createdAt?: Date;
    readAt?: Date | null;
    dedupeKey?: string | null;
  },
) {
  const ts = args.createdAt ?? new Date();
  const [row] = await db
    .insert(notifications)
    .values({
      id: randomUUID(),
      organizationId: args.organizationId,
      recipientUserId: args.recipientUserId,
      type: (args.type ?? "result_published") as never,
      title: args.title ?? "t",
      body: args.body ?? "b",
      actionPath:
        args.actionPath ?? "/exam/00000000-0000-4000-8000-00000000000a/result",
      createdAt: ts,
      readAt: args.readAt ?? null,
      dedupeKey: args.dedupeKey ?? null,
    })
    .returning();
  if (!row) throw new Error("seedRow: insert returned no row");
  return row;
}

describe("notificationRepo", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let orgId: string;
  let recipientA: string;
  let recipientB: string;
  let userCounter: number;

  async function createTestUser(organizationId: string): Promise<string> {
    const userRepo = createUserRepo(db);
    const ctx: RequestContext = {
      actorId: "system",
      organizationId,
      role: "Admin",
      permissions: [],
      sessionId: "s",
    };
    const user = await userRepo.create(ctx, {
      username: `notif-user-${userCounter++}-${randomUUID().slice(0, 6)}`,
      passwordHash: "x",
      name: `User ${userCounter}`,
      role: "Candidate",
      isActive: true,
    });
    return user.id;
  }

  beforeAll(async () => {
    const env = await getIsolatedTestDb("db-notificationRepo");
    db = env.db;
    cleanup = env.cleanup;
    userCounter = 0;
    const org = await createOrganizationRepo(db).create(
      {
        actorId: "system",
        organizationId: "system",
        role: "Admin",
        permissions: [],
        sessionId: "s",
      },
      {
        name: "Test Org",
        displayName: "Test Org",
        slug: `notif-${randomUUID().slice(0, 8)}`,
      },
    );
    orgId = org.id;
    recipientA = await createTestUser(orgId);
    recipientB = await createTestUser(orgId);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  });

  describe("insert / dedupe", () => {
    it("creates a new notification and returns it with created=true", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const { row, created } = await repo.insert(
        ctx,
        {
          recipientUserId: recipientA,
          type: "result_published",
          title: "考试结果已发布",
          body: "您的考试结果已发布。",
          actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
          dedupeKey: "result_published:exam-A",
        },
        AT,
      );
      expect(created).toBe(true);
      expect(row.organizationId).toBe(orgId);
      expect(row.recipientUserId).toBe(recipientA);
      expect(row.type).toBe("result_published");
      expect(row.title).toBe("考试结果已发布");
      expect(row.readAt).toBeNull();
      expect(row.dedupeKey).toBe("result_published:exam-A");
    });

    it("is idempotent on a duplicate dedupe key (returns existing, created=false)", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const first = await repo.insert(
        ctx,
        {
          recipientUserId: recipientB,
          type: "result_published",
          title: "first",
          body: "b",
          actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
          dedupeKey: "result_published:exam-dedupe",
        },
        AT,
      );
      expect(first.created).toBe(true);
      const second = await repo.insert(
        ctx,
        {
          recipientUserId: recipientB,
          type: "result_published",
          title: "second-should-be-ignored",
          body: "b",
          actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
          dedupeKey: "result_published:exam-dedupe",
        },
        AT,
      );
      expect(second.created).toBe(false);
      // Same row, NOT the second input.
      expect(second.row.id).toBe(first.row.id);
      expect(second.row.title).toBe("first");
    });

    it("allows the same dedupe key for DIFFERENT recipients (no conflict)", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const a = await repo.insert(
        ctx,
        {
          recipientUserId: recipientA,
          type: "result_published",
          title: "to A",
          body: "b",
          actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
          dedupeKey: "result_published:exam-shared",
        },
        AT,
      );
      const b = await repo.insert(
        ctx,
        {
          recipientUserId: recipientB,
          type: "result_published",
          title: "to B",
          body: "b",
          actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
          dedupeKey: "result_published:exam-shared",
        },
        AT,
      );
      expect(a.created).toBe(true);
      expect(b.created).toBe(true);
      expect(a.row.id).not.toBe(b.row.id);
    });

    it("creates multiple rows when dedupeKey is null (no dedupe applied)", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const a = await repo.insert(
        ctx,
        {
          recipientUserId: recipientA,
          type: "result_published",
          title: "no-key-1",
          body: "b",
          actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
        },
        AT,
      );
      const b = await repo.insert(
        ctx,
        {
          recipientUserId: recipientA,
          type: "result_published",
          title: "no-key-2",
          body: "b",
          actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
        },
        AT,
      );
      expect(a.created).toBe(true);
      expect(b.created).toBe(true);
      expect(a.row.id).not.toBe(b.row.id);
    });
  });

  describe("insertMany", () => {
    it("inserts multiple rows in one statement and reports the count", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const r1 = await createTestUser(orgId);
      const r2 = await createTestUser(orgId);
      const result = await repo.insertMany(
        ctx,
        [
          {
            recipientUserId: r1,
            type: "result_published",
            title: "batch-1",
            body: "b",
            actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
            dedupeKey: "result_published:batch-r1",
          },
          {
            recipientUserId: r2,
            type: "result_published",
            title: "batch-2",
            body: "b",
            actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
            dedupeKey: "result_published:batch-r2",
          },
        ],
        AT,
      );
      expect(result.insertedCount).toBe(2);
    });

    it("is idempotent on duplicate dedupe keys within a batch", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const r = await createTestUser(orgId);
      // First batch creates 1 row.
      await repo.insertMany(
        ctx,
        [
          {
            recipientUserId: r,
            type: "result_published",
            title: "first",
            body: "b",
            actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
            dedupeKey: "result_published:batch-dedupe",
          },
        ],
        AT,
      );
      // Second batch with the same key inserts nothing.
      const result = await repo.insertMany(
        ctx,
        [
          {
            recipientUserId: r,
            type: "result_published",
            title: "second",
            body: "b",
            actionPath: "/exam/00000000-0000-4000-8000-00000000000a/result",
            dedupeKey: "result_published:batch-dedupe",
          },
        ],
        AT,
      );
      expect(result.insertedCount).toBe(0);
    });

    it("returns insertedCount=0 for an empty input", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const result = await repo.insertMany(ctx, [], AT);
      expect(result.insertedCount).toBe(0);
    });
  });

  describe("list", () => {
    it("returns rows in stable created_at DESC, id DESC order", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const r = await createTestUser(orgId);
      const t0 = new Date("2026-07-25T00:00:00.000Z");
      const t1 = new Date("2026-07-25T01:00:00.000Z");
      const t2 = new Date("2026-07-25T02:00:00.000Z");
      await seedRow(db, {
        organizationId: orgId,
        recipientUserId: r,
        title: "oldest",
        createdAt: t0,
      });
      await seedRow(db, {
        organizationId: orgId,
        recipientUserId: r,
        title: "newest",
        createdAt: t2,
      });
      await seedRow(db, {
        organizationId: orgId,
        recipientUserId: r,
        title: "middle",
        createdAt: t1,
      });
      const { items } = await repo.list(ctx, r, { page: 1, pageSize: 10 });
      expect(items.map((i) => i.title)).toEqual(["newest", "middle", "oldest"]);
    });

    it("paginates by page/pageSize and reports total", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const r = await createTestUser(orgId);
      for (let i = 0; i < 5; i++) {
        await seedRow(db, {
          organizationId: orgId,
          recipientUserId: r,
          title: `n${i}`,
        });
      }
      const page1 = await repo.list(ctx, r, { page: 1, pageSize: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);
      const page2 = await repo.list(ctx, r, { page: 2, pageSize: 2 });
      expect(page2.items).toHaveLength(2);
      // No overlap between pages.
      const ids1 = new Set(page1.items.map((i) => i.id));
      for (const i of page2.items) expect(ids1.has(i.id)).toBe(false);
    });

    it("filters to unread only when unreadOnly=true", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const r = await createTestUser(orgId);
      await seedRow(db, {
        organizationId: orgId,
        recipientUserId: r,
        title: "read",
        readAt: new Date(),
      });
      await seedRow(db, {
        organizationId: orgId,
        recipientUserId: r,
        title: "unread",
      });
      const { items, total } = await repo.list(ctx, r, {
        page: 1,
        pageSize: 10,
        unreadOnly: true,
      });
      expect(total).toBe(1);
      expect(items[0]!.title).toBe("unread");
    });

    it("isolates by recipient within the same organization", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const r1 = await createTestUser(orgId);
      const r2 = await createTestUser(orgId);
      await seedRow(db, {
        organizationId: orgId,
        recipientUserId: r1,
        title: "for r1",
      });
      await seedRow(db, {
        organizationId: orgId,
        recipientUserId: r2,
        title: "for r2",
      });
      const r1List = await repo.list(ctx, r1, { page: 1, pageSize: 10 });
      expect(r1List.total).toBe(1);
      expect(r1List.items[0]!.title).toBe("for r1");
    });

    it("isolates by organization (cross-org returns empty)", async () => {
      const repo = createNotificationRepo(db);
      const otherOrg = await createOrganizationRepo(db).create(
        {
          actorId: "system",
          organizationId: "system",
          role: "Admin",
          permissions: [],
          sessionId: "s",
        },
        {
          name: "Other Org",
          displayName: "Other Org",
          slug: `other-${randomUUID().slice(0, 8)}`,
        },
      );
      await seedRow(db, {
        organizationId: orgId,
        recipientUserId: recipientA,
        title: "in orgId",
      });
      const otherCtx = createContext(otherOrg.id);
      const result = await repo.list(otherCtx, recipientA, {
        page: 1,
        pageSize: 10,
      });
      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });
  });

  describe("countUnread", () => {
    it("counts only unread rows for the recipient", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const r = await createTestUser(orgId);
      await seedRow(db, {
        organizationId: orgId,
        recipientUserId: r,
        readAt: null,
      });
      await seedRow(db, {
        organizationId: orgId,
        recipientUserId: r,
        readAt: null,
      });
      await seedRow(db, {
        organizationId: orgId,
        recipientUserId: r,
        readAt: new Date(),
      });
      const count = await repo.countUnread(ctx, r);
      expect(count).toBe(2);
    });
  });

  describe("markRead", () => {
    it("sets read_at on an unread row and returns it", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const r = await createTestUser(orgId);
      const seeded = await seedRow(db, {
        organizationId: orgId,
        recipientUserId: r,
      });
      expect(seeded.readAt).toBeNull();
      const updated = await repo.markRead(ctx, r, seeded.id, AT);
      expect(updated).not.toBeNull();
      expect(updated!.readAt).not.toBeNull();
    });

    it("is idempotent (repeat mark-read returns the row, no error)", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const r = await createTestUser(orgId);
      const seeded = await seedRow(db, {
        organizationId: orgId,
        recipientUserId: r,
      });
      await repo.markRead(ctx, r, seeded.id, AT);
      const second = await repo.markRead(ctx, r, seeded.id, AT);
      expect(second).not.toBeNull();
      expect(second!.id).toBe(seeded.id);
    });

    it("returns null for another recipient's notification (anti-enumeration)", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const owner = await createTestUser(orgId);
      const attacker = await createTestUser(orgId);
      const seeded = await seedRow(db, {
        organizationId: orgId,
        recipientUserId: owner,
      });
      const result = await repo.markRead(ctx, attacker, seeded.id, AT);
      expect(result).toBeNull();
      // Owner's row is still unread (the mark did not touch it).
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, seeded.id));
      expect(rows[0]!.readAt).toBeNull();
    });

    it("returns null for a missing notification id", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const result = await repo.markRead(ctx, recipientA, randomUUID(), AT);
      expect(result).toBeNull();
    });
  });

  describe("markAllRead", () => {
    it("marks all unread rows for the recipient and returns the count", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const r = await createTestUser(orgId);
      await seedRow(db, { organizationId: orgId, recipientUserId: r });
      await seedRow(db, { organizationId: orgId, recipientUserId: r });
      await seedRow(db, {
        organizationId: orgId,
        recipientUserId: r,
        readAt: new Date(),
      });
      const updated = await repo.markAllRead(ctx, r, AT);
      expect(updated).toBe(2);
      const unread = await repo.countUnread(ctx, r);
      expect(unread).toBe(0);
    });

    it("does not touch another recipient's rows", async () => {
      const repo = createNotificationRepo(db);
      const ctx = createContext(orgId);
      const r1 = await createTestUser(orgId);
      const r2 = await createTestUser(orgId);
      await seedRow(db, { organizationId: orgId, recipientUserId: r1 });
      await seedRow(db, { organizationId: orgId, recipientUserId: r2 });
      await repo.markAllRead(ctx, r1, AT);
      expect(await repo.countUnread(ctx, r1)).toBe(0);
      expect(await repo.countUnread(ctx, r2)).toBe(1);
    });
  });
});
