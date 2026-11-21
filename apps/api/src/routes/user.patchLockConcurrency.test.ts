import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import { createPostgresDatabase, migratePostgres } from "@exam/db/postgres";
import { setupIsolatedTestDb } from "@exam/db/testIsolation";
import { schema, type AssignableRole } from "@exam/db/schema/pg";
import type { Database, TenantContext } from "@exam/db/types";
import { executeInTransaction } from "@exam/db/types";
import { createUserRepo } from "@exam/db/repository/userRepo";
import { createUserRoleAssignmentRepo } from "@exam/db/repository/userRoleAssignmentRepo";
import { createPasswordResetTokenRepo } from "@exam/db/repository/passwordResetTokenRepo";
import { hashPassword } from "@exam/auth/password";
import { signJWT } from "@exam/auth/session";
import { eq } from "drizzle-orm";
import {
  getRuntimeConfig,
  resetRuntimeConfigForTest,
} from "../config/runtimeConfig.js";
import setupSecurity from "../plugins/security.js";
import { setupErrorHandler } from "../plugins/errors.js";
import zodProviderPlugin from "../plugins/zodProvider.js";
import auditLifecyclePlugin from "../plugins/auditLifecycle.js";
import nowPlugin from "../plugins/now.js";
import authPlugin from "../plugins/auth.js";
import authzScopedPlugin from "../plugins/authz.js";
import emailPlugin from "../plugins/email.js";
import userRoutes from "./user.js";

/**
 * R-RT2-1 (#1042): PATCH /users/:id 决定性并发见证 — 变更事实必须在
 * organization advisory lock 内基于权威状态计算。
 *
 * 三个真实重叠的调度（两个独立 Fastify app、各自 max:1 的独立物理连
 * 接、共享同一测试 schema 与组织行，外加一条观察者连接持有目标
 * `users` 行锁做确定性停车）。重叠证据来自 pg_locks：
 *
 *   观察者 — BEGIN; SELECT ... FOR UPDATE 目标 users 行（停车闸）。
 *   T1 — PATCH（appA）：pre-read → 进事务 → 拿 org advisory lock →
 *        第一条 users 行写（UPDATE）阻塞在观察者行锁上。真实重叠：
 *        T1 持 advisory 锁停在事务中。
 *   T2 — PATCH（appB）：pre-read 看到的是 T1 提交前的旧状态 →
 *        进事务 → 阻塞在 advisory lock（pg_locks: ungranted advisory）。
 *   观察者 ROLLBACK — T1 完成、提交、释放 advisory；T2 在锁内继续。
 *
 * 调度是确定性的：T2 只有在验证 T1 已停车（blocked-on-row-lock）后才
 * 发出，因此 T2 的 pre-read 必然读到 T1 提交前的快照；T2 只有在验证
 * 自己阻塞在 advisory lock 上后观察者才放行，因此 T1 必然先于 T2 的
 * 锁内决策提交。
 *
 *   Case A（角色显式写丢失 + 审计 oldRole 失真）：初始 Candidate，
 *   T1 提交 Teacher，T2 请求改回 Candidate。锁外 stale flag
 *   （roleChanged=false）会丢掉 T2 的显式角色写并缺失第二条
 *   role_changed 审计；锁内计算则按提交时事实 Teacher→Candidate 落盘。
 *
 *   Case B（停用撤销协议丢失）：先顺序停用一次，再让 T1 并发重新启
 *   用、T2 在 stale 快照（isActive=false）上请求再次停用。stale
 *   activeChanged=false 会跳过真实 true→false 停用应有的 authEpoch
 *   推进、未消费 password-reset token 原子销毁与 user.disabled 审计。
 *
 *   Case C（LAST_ACTIVE_ADMIN 并发不绕过，保护性断言）：T1 自降级为
 *   Teacher（self-guard 只拦 isActive=false，不拦角色自改），T2 并发
 *   停用仅剩的另一位 Admin — 必须整体回滚并 400，无部分状态。
 *
 * 与 authorityInvariants.concurrency.test.ts 的分工：那里在 seam 层证
 * 明 advisory lock + READ COMMITTED 防 write-skew；这里证明路由把变
 * 更事实计算放进同一锁内（本测试的 Case A/B 在锁外计算的 master 实现
 * 上失败），且锁内 postcondition 拒绝路径（Case C）不被破坏。
 */

type PostgresConnection = Awaited<ReturnType<typeof createPostgresDatabase>>;
type TestApp = ReturnType<typeof Fastify>;

interface OrgFixture {
  orgId: string;
  ctx: TenantContext;
  actorId: string;
  targetId: string;
  token: string;
}

describe("PATCH /users/:id — change facts computed inside the authority advisory lock", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let dbMain: Database;
  let connMain: PostgresConnection;
  let connA: PostgresConnection;
  let connB: PostgresConnection;
  let observer: postgres.Sql;
  let observerPid: number;
  let appA: TestApp;
  let appB: TestApp;
  let cleanupAll: () => Promise<void>;
  let fixtures: { caseA: OrgFixture; caseB: OrgFixture; caseC: OrgFixture };

  /**
   * Waits until SOME backend blocks on the observer's open transaction
   * (the row-lock parking gate) and returns that backend's pid — proof T1
   * is mid-transaction holding the advisory lock.
   */
  async function waitForRowLockWaiter(timeoutMs = 8_000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = (await observer.unsafe(
        `SELECT l.pid FROM pg_locks l
         WHERE l.granted = false
           AND $1 = ANY(pg_blocking_pids(l.pid))
         LIMIT 1`,
        [observerPid],
      )) as Array<{ pid: number }>;
      if (rows.length > 0) return rows[0]!.pid;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `No backend blocked on the observer row lock within ${timeoutMs}ms — the parking schedule did not engage`,
    );
  }

  /** Waits until a backend OTHER THAN `excludePid` waits on an advisory lock. */
  async function waitForAdvisoryLockWaiter(
    excludePid: number,
    timeoutMs = 8_000,
  ): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = (await observer.unsafe(
        `SELECT pid FROM pg_locks
         WHERE locktype = 'advisory' AND granted = false AND pid <> $1
         LIMIT 1`,
        [excludePid],
      )) as Array<{ pid: number }>;
      if (rows.length > 0) return rows[0]!.pid;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `No other backend waiting on the advisory lock within ${timeoutMs}ms — T2 never overlapped`,
    );
  }

  async function lockUserRow(userId: string): Promise<void> {
    await observer.unsafe("BEGIN");
    await observer.unsafe(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [
      userId,
    ]);
  }

  async function unlockUserRow(): Promise<void> {
    await observer.unsafe("ROLLBACK");
  }

  function patchUser(
    app: TestApp,
    token: string,
    id: string,
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: "PATCH",
      url: `/api/users/${id}`,
      payload,
      cookies: { "auth-token": token },
    });
  }

  async function readUser(userId: string) {
    const rows = await dbMain
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return rows[0]!;
  }

  async function auditEvents(targetId: string) {
    return dbMain
      .select({
        action: schema.auditLogs.action,
        metadata: schema.auditLogs.metadata,
      })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, targetId))
      .orderBy(schema.auditLogs.createdAt, schema.auditLogs.id);
  }

  async function openResetTokenCount(userId: string): Promise<number> {
    const rows = await dbMain
      .select({ consumedAt: schema.passwordResetTokens.consumedAt })
      .from(schema.passwordResetTokens)
      .where(eq(schema.passwordResetTokens.userId, userId));
    return rows.filter((r) => r.consumedAt === null).length;
  }

  async function buildAppOnDb(db: Database): Promise<TestApp> {
    const app = Fastify();
    setupSecurity(app);
    setupErrorHandler(app);
    await app.register(zodProviderPlugin);
    await app.register(fastifyCookie);
    await app.register(
      fp(async (fastify) => {
        fastify.decorate("db", db);
      }),
    );
    await app.register(auditLifecyclePlugin);
    await app.register(nowPlugin);
    await app.register(authPlugin);
    await app.register(authzScopedPlugin);
    await app.register(emailPlugin);
    await app.register(userRoutes, { prefix: "/api" });
    await app.ready();
    return app;
  }

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({ namespace: "user_patch_lock" });
    // OWNERSHIP: the schema must be dropped even if a later setup step
    // throws — register the floor cleanup immediately.
    cleanupAll = async () => {
      await iso.cleanup();
    };
    const mk = async () =>
      await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    connMain = await mk();
    connA = await mk();
    connB = await mk();
    dbMain = connMain.db;
    observer = postgres(iso.databaseUrl, { max: 1 });
    await observer.unsafe(`SET search_path TO "${iso.schemaName}"`);
    const pidRows = (await observer.unsafe(
      `SELECT pg_backend_pid() AS pid`,
    )) as Array<{ pid: number }>;
    observerPid = pidRows[0]!.pid;

    // Only the FIRST connection migrates; the others share the schema.
    await migratePostgres(dbMain, { migrationsSchema: iso.schemaName });

    process.env.RATE_LIMIT_DISABLED = "true";
    resetRuntimeConfigForTest();

    const mkFixture = async (
      label: string,
      targetRole: AssignableRole,
    ): Promise<OrgFixture> => {
      const orgId = randomUUID();
      const now = new Date();
      await dbMain.insert(schema.organizations).values({
        id: orgId,
        name: label,
        displayName: label,
        slug: `${label}-${orgId.slice(0, 8)}-${Date.now()}`,
        createdAt: now,
        updatedAt: now,
      });
      const ctx: TenantContext = {
        organizationId: orgId,
        actorId: "setup",
        role: "Admin",
        permissions: [],
      };
      const mkUser = async (role: AssignableRole, name: string) => {
        const user = await createUserRepo(dbMain).create(ctx, {
          username: `${label}-${name}-${randomUUID().slice(0, 8)}`,
          passwordHash: await hashPassword("password123"),
          name: `${label} ${name}`,
          role,
          isActive: true,
        });
        await createUserRoleAssignmentRepo(dbMain).assign(ctx, {
          userId: user.id,
          role,
          isPrimary: true,
          isActive: true,
        });
        return user;
      };
      const actor = await mkUser("Admin", "actor");
      const target = await mkUser(targetRole, "target");
      const token = signJWT(
        {
          actorId: actor.id,
          role: actor.role as "Admin",
          organizationId: orgId,
          authEpoch: actor.authEpoch,
        },
        getRuntimeConfig().authSecret.jwtSecret,
      );
      return { orgId, ctx, actorId: actor.id, targetId: target.id, token };
    };

    fixtures = {
      caseA: await mkFixture("patch-lock-a", "Candidate"),
      caseB: await mkFixture("patch-lock-b", "Teacher"),
      caseC: await mkFixture("patch-lock-c", "Admin"),
    };

    appA = await buildAppOnDb(connA.db);
    appB = await buildAppOnDb(connB.db);

    const floorCleanup = cleanupAll;
    cleanupAll = async () => {
      await Promise.allSettled([
        appA.close(),
        appB.close(),
        connMain.sql.end(),
        connA.sql.end(),
        connB.sql.end(),
        observer.end(),
      ]);
      await floorCleanup();
    };
  }, 60_000);

  afterAll(async () => {
    if (cleanupAll) await cleanupAll();
  }, 30_000);

  it("Case A — a concurrent explicit role write is not lost by the stale pre-read; role_changed audits describe the real transitions", async () => {
    const fx = fixtures.caseA;
    // Initial committed state: primary Candidate. T1 promotes to Teacher
    // and commits while T2's decision snapshot is still Candidate.
    await lockUserRow(fx.targetId);
    try {
      const t1 = patchUser(appA, fx.token, fx.targetId, { role: "Teacher" });
      const pidT1 = await waitForRowLockWaiter();
      const t2 = patchUser(appB, fx.token, fx.targetId, {
        role: "Candidate",
      });
      const pidT2 = await waitForAdvisoryLockWaiter(pidT1);
      expect(pidT2).not.toBe(pidT1);
      await unlockUserRow();
      const [resT1, resT2] = await Promise.all([t1, t2]);
      expect(resT1.statusCode).toBe(200);
      expect(resT2.statusCode).toBe(200);
      expect(resT2.json().role).toBe("Candidate");
    } finally {
      await unlockUserRow().catch(() => undefined);
    }

    // Accepted write semantics: T2's explicit role write is the later
    // decision under the lock — the final role must be Candidate, not the
    // stale-flag-skipped Teacher.
    const userRow = await readUser(fx.targetId);
    expect(userRow.role).toBe("Candidate");

    // Mirror invariant: primary active assignment matches users.role.
    const assignments = await createUserRoleAssignmentRepo(dbMain).listForUser(
      fx.ctx,
      fx.targetId,
    );
    const activePrimary = assignments.filter((a) => a.isActive && a.isPrimary);
    expect(activePrimary.map((a) => a.role)).toEqual(["Candidate"]);

    // Audit truth: exactly two role transitions really happened
    // (Candidate→Teacher, then Teacher→Candidate under the lock).
    const events = (await auditEvents(fx.targetId)).filter(
      (e) => e.action === "user.role_changed",
    );
    expect(
      events
        .map(
          (e) => `${String(e.metadata.oldRole)}->${String(e.metadata.newRole)}`,
        )
        .sort(),
    ).toEqual(["Candidate->Teacher", "Teacher->Candidate"]);
  }, 30_000);

  it("Case B — deactivation decided on a stale snapshot still advances authEpoch, burns open reset tokens and audits atomically", async () => {
    const fx = fixtures.caseB;
    // Sequential disable #1 (real transition, epoch 0→1, no tokens yet).
    const disableRes = await patchUser(appA, fx.token, fx.targetId, {
      isActive: false,
    });
    expect(disableRes.statusCode).toBe(200);
    const afterDisable = await readUser(fx.targetId);
    expect(afterDisable.isActive).toBe(false);
    const epochAfterDisable = afterDisable.authEpoch;

    // Seed an OPEN password-reset token while the account is disabled: the
    // deactivation contract burns whatever is outstanding at decision time,
    // regardless of when it was issued.
    await executeInTransaction(dbMain, async (tx) => {
      const locked = await createUserRepo(tx).lockByIdWithinTransaction(
        fx.ctx,
        fx.targetId,
      );
      if (!locked) throw new Error("caseB target vanished during setup");
      await createPasswordResetTokenRepo(tx).issueWithinTransaction(fx.ctx, {
        userId: fx.targetId,
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        expiresAt: new Date(Date.now() + 3_600_000),
        now: new Date(),
      });
    });
    expect(await openResetTokenCount(fx.targetId)).toBe(1);

    // T1 reactivates (false→true, commits first); T2's pre-read still sees
    // isActive=false, so at T2's locked decision the REAL transition is
    // true→false — a full credential-revocation-grade deactivation.
    await lockUserRow(fx.targetId);
    try {
      const t1 = patchUser(appA, fx.token, fx.targetId, { isActive: true });
      const pidT1 = await waitForRowLockWaiter();
      const t2 = patchUser(appB, fx.token, fx.targetId, { isActive: false });
      const pidT2 = await waitForAdvisoryLockWaiter(pidT1);
      expect(pidT2).not.toBe(pidT1);
      await unlockUserRow();
      const [resT1, resT2] = await Promise.all([t1, t2]);
      expect(resT1.statusCode).toBe(200);
      expect(resT2.statusCode).toBe(200);
    } finally {
      await unlockUserRow().catch(() => undefined);
    }

    const userRow = await readUser(fx.targetId);
    expect(userRow.isActive).toBe(false);
    // The real deactivation must advance the epoch exactly once more.
    expect(userRow.authEpoch).toBe(epochAfterDisable + 1);
    // ...and atomically burn the outstanding open token.
    expect(await openResetTokenCount(fx.targetId)).toBe(0);
    // Audit truth: two real false-transitions were persisted (setup #1 +
    // T2's locked decision). T1's reactivation is logged separately.
    const events = await auditEvents(fx.targetId);
    expect(events.filter((e) => e.action === "user.disabled")).toHaveLength(2);
    expect(events.filter((e) => e.action === "user.reactivated")).toHaveLength(
      1,
    );
  }, 30_000);

  it("Case C — concurrent self-downgrade plus disable of the last other Admin is rejected whole (LAST_ACTIVE_ADMIN, no partial state)", async () => {
    const fx = fixtures.caseC;
    const targetBefore = await readUser(fx.targetId);
    // T1: the actor self-downgrades Admin→Teacher (the self-guard only
    // rejects self-deactivation, not a role self-change) and parks on its
    // own row lock while holding the org advisory lock.
    await lockUserRow(fx.actorId);
    try {
      const t1 = patchUser(appA, fx.token, fx.actorId, { role: "Teacher" });
      const pidT1 = await waitForRowLockWaiter();
      const t2 = patchUser(appB, fx.token, fx.targetId, { isActive: false });
      const pidT2 = await waitForAdvisoryLockWaiter(pidT1);
      expect(pidT2).not.toBe(pidT1);
      await unlockUserRow();
      const [resT1, resT2] = await Promise.all([t1, t2]);
      expect(resT1.statusCode).toBe(200);
      expect(resT2.statusCode).toBe(400);
      expect(resT2.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: { reason: "LAST_ACTIVE_ADMIN" },
        },
      });
    } finally {
      await unlockUserRow().catch(() => undefined);
    }

    // T1 committed: the actor really is Teacher now.
    expect((await readUser(fx.actorId)).role).toBe("Teacher");
    // T2 rolled back WHOLE: still active, epoch untouched, no disable audit.
    const targetAfter = await readUser(fx.targetId);
    expect(targetAfter.isActive).toBe(true);
    expect(targetAfter.authEpoch).toBe(targetBefore.authEpoch);
    const events = await auditEvents(fx.targetId);
    expect(events.filter((e) => e.action === "user.disabled")).toHaveLength(0);
  }, 30_000);
});
