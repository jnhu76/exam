import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import examRoutes from "./exam.js";
import candidateRoutes from "./candidate.js";
import courseRoutes from "./course.js";
import scoreRoutes from "./scores.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  uniquePrefix,
  type TestContext,
} from "./testHelpers.js";
import { schema } from "@exam/db/schema/pg";
import { and, eq, inArray, notInArray } from "drizzle-orm";

/**
 * #785 BDD acceptance — L1 (real API + real PostgreSQL).
 *
 * Scenario source: docs/design/admin-list-pagination-bdd.md (B01–B10).
 * Each scenario seeds its own data and clears org business rows first, so
 * totals are exact and scenarios stay order-independent. The four pages'
 * server-side contracts live here; the UI consumption is proven at L2/L3.
 */

type ExamRow = {
  id: string;
  title: string;
  status: string;
  canViewScores: boolean;
  scoreViewDisabledReasonCode: string | null;
};

const BASE_TIME = new Date("2026-01-01T00:00:00Z");

describe("#785 admin list pagination / search / status contracts (B01–B10)", () => {
  let ctx: TestContext;
  /** Extra tenant orgs created by scope scenarios; wiped by clearOrgData. */
  let extraOrgIds: string[] = [];

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(courseRoutes);
      await fastify.register(scoreRoutes);
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /** FK-safe wipe of all list-domain business rows (main org + extra orgs). */
  async function clearOrgData() {
    const orgIds = [ctx.org.id, ...extraOrgIds];
    for (const orgId of orgIds) {
      // FK-safe order: attempts → enrollments → assignments → exams →
      // profiles → role assignments → users → courses.
      await ctx.db
        .delete(schema.examAttempts)
        .where(eq(schema.examAttempts.organizationId, orgId));
      await ctx.db
        .delete(schema.examEnrollments)
        .where(eq(schema.examEnrollments.organizationId, orgId));
      await ctx.db
        .delete(schema.teacherCourseAssignments)
        .where(eq(schema.teacherCourseAssignments.organizationId, orgId));
      await ctx.db
        .delete(schema.exams)
        .where(eq(schema.exams.organizationId, orgId));
      await ctx.db
        .delete(schema.candidateProfiles)
        .where(eq(schema.candidateProfiles.organizationId, orgId));
      const seedUserIds = [ctx.admin.id, ctx.candidate.id];
      await ctx.db
        .delete(schema.userRoleAssignments)
        .where(
          and(
            eq(schema.userRoleAssignments.organizationId, orgId),
            notInArray(schema.userRoleAssignments.userId, seedUserIds),
          ),
        );
      await ctx.db
        .delete(schema.users)
        .where(
          and(
            eq(schema.users.organizationId, orgId),
            notInArray(schema.users.id, seedUserIds),
          ),
        );
      await ctx.db
        .delete(schema.courses)
        .where(eq(schema.courses.organizationId, orgId));
    }
    if (extraOrgIds.length > 0) {
      await ctx.db
        .delete(schema.organizations)
        .where(inArray(schema.organizations.id, extraOrgIds));
      extraOrgIds = [];
    }
  }

  async function insertCourse(opts: {
    name: string;
    code: string;
    description?: string;
    createdAt?: Date;
    organizationId?: string;
  }): Promise<string> {
    const courseId = randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: opts.organizationId ?? ctx.org.id,
      name: opts.name,
      code: opts.code,
      description: opts.description ?? "",
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    });
    return courseId;
  }

  async function insertExam(opts: {
    title: string;
    status: "draft" | "published" | "open" | "closed" | "canceled" | "archived";
    createdAt?: Date;
    courseId: string;
    organizationId?: string;
    openAt?: Date;
    closeAt?: Date | null;
  }): Promise<string> {
    const examId = randomUUID();
    await ctx.db.insert(schema.exams).values({
      id: examId,
      organizationId: opts.organizationId ?? ctx.org.id,
      title: opts.title,
      description: "",
      courseId: opts.courseId,
      status: opts.status,
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: opts.openAt ?? BASE_TIME,
      closeAt:
        opts.closeAt === undefined
          ? new Date(BASE_TIME.getTime() + 86_400_000)
          : opts.closeAt,
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [],
      questionSnapshot: [],
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    });
    return examId;
  }

  async function insertCandidate(opts: {
    name: string;
    username: string;
    createdAt?: Date;
    organizationId?: string;
  }): Promise<{ profileId: string; userId: string }> {
    const orgId = opts.organizationId ?? ctx.org.id;
    const userId = randomUUID();
    await ctx.db.insert(schema.users).values({
      id: userId,
      organizationId: orgId,
      username: opts.username,
      passwordHash: "test-hash",
      name: opts.name,
      role: "Candidate",
      isActive: true,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    });
    const profileId = randomUUID();
    await ctx.db.insert(schema.candidateProfiles).values({
      id: profileId,
      organizationId: orgId,
      userId,
      fields: {},
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    });
    return { profileId, userId };
  }

  async function insertEnrollment(
    examId: string,
    candidateId: string,
    organizationId = ctx.org.id,
  ): Promise<string> {
    const enrollmentId = randomUUID();
    await ctx.db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId,
      examId,
      candidateId,
      status: "assigned",
      attemptCount: 0,
    });
    return enrollmentId;
  }

  async function insertGradedAttempt(opts: {
    examId: string;
    enrollmentId: string;
    candidateId: string;
  }): Promise<void> {
    await ctx.db.insert(schema.examAttempts).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      examId: opts.examId,
      enrollmentId: opts.enrollmentId,
      candidateId: opts.candidateId,
      attemptNo: 1,
      status: "graded",
      questionSnapshot: [],
      answers: [],
      score: 88,
      passed: true,
    });
  }

  async function createTeacherWithScope(
    courseIds: string[],
  ): Promise<{ token: string; userId: string }> {
    const { user, token } = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      `t785-${uniquePrefix()}`,
    );
    for (const courseId of courseIds) {
      await ctx.db.insert(schema.teacherCourseAssignments).values({
        id: randomUUID(),
        organizationId: ctx.org.id,
        teacherUserId: user.id,
        courseId,
        status: "active",
        assignedBy: ctx.admin.id,
        assignedAt: BASE_TIME,
      });
    }
    return { token, userId: user.id };
  }

  function getAdmin(url: string) {
    return ctx.app.inject({
      method: "GET",
      url,
      cookies: { "auth-token": ctx.adminToken },
    });
  }

  function getAs(url: string, token: string) {
    return ctx.app.inject({
      method: "GET",
      url,
      cookies: { "auth-token": token },
    });
  }

  /**
   * Walks a default-parameter list URL page by page (pageSize stays the
   * server default) until `size` records are collected, then proves the
   * collected set is exactly the created set — no duplicates, no gaps.
   */
  async function expectFullWalk(
    baseUrl: string,
    size: number,
    createdIds: string[],
  ) {
    const collectedIds: string[] = [];
    for (
      let pageNum = 1;
      collectedIds.length < size && pageNum <= 10;
      pageNum++
    ) {
      const res = await getAdmin(
        pageNum === 1 ? baseUrl : `${baseUrl}?page=${pageNum}`,
      );
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(size);
      collectedIds.push(...body.items.map((r: { id: string }) => r.id));
    }
    expect(collectedIds).toHaveLength(size);
    expect(new Set(collectedIds).size).toBe(size);
    expect([...collectedIds].sort()).toEqual([...createdIds].sort());
    if (size > 20) {
      const page2 = await getAdmin(`${baseUrl}?page=2`);
      expect(page2.json().items[0].id).toBe(createdIds[20]);
    }
  }

  // ── B01 — 超过第一页容量后仍可访问所有记录 ────────────────────────────

  for (const size of [0, 1, 19, 20, 21, 40, 41]) {
    it(`B01 exams: ${size} exams — every record reachable via paging (params: 0/1/19/20/21/40/41)`, async () => {
      await clearOrgData();
      const courseId = await insertCourse({
        name: "B01 course",
        code: `B01-${uniquePrefix()}`,
      });
      // Interleave all six statuses: the default list must not implicitly
      // filter any status away (B10).
      const statuses = [
        "draft",
        "published",
        "open",
        "closed",
        "canceled",
        "archived",
      ] as const;
      const createdIds: string[] = [];
      for (let i = 0; i < size; i++) {
        createdIds.push(
          await insertExam({
            title: `B01 exam ${String(i).padStart(2, "0")}`,
            status: statuses[i % statuses.length]!,
            courseId,
            createdAt: new Date(BASE_TIME.getTime() + i * 60_000),
          }),
        );
      }

      const page1 = await getAdmin("/api/exams");
      expect(page1.statusCode).toBe(200);
      const p1 = page1.json();
      expect(p1.page).toBe(1);
      expect(p1.pageSize).toBe(20);
      expect(p1.total).toBe(size);
      expect(p1.totalPages).toBe(Math.ceil(size / 20));
      expect(p1.items).toHaveLength(Math.min(size, 20));
      // Deterministic ordering: createdAt ASC — page 1 preserves creation order.
      expect(p1.items.map((e: ExamRow) => e.id)).toEqual(
        createdIds.slice(0, Math.min(size, 20)),
      );

      // Walk every page and prove the union covers the full set exactly once.
      await expectFullWalk("/api/exams", size, createdIds);
    });

    it(`B01 candidates: ${size} candidates — every record reachable via paging`, async () => {
      await clearOrgData();
      const createdIds: string[] = [];
      for (let i = 0; i < size; i++) {
        const { profileId } = await insertCandidate({
          name: `B01 考生 ${String(i).padStart(2, "0")}`,
          username: `b01-c-${uniquePrefix()}-${i}`,
          createdAt: new Date(BASE_TIME.getTime() + i * 60_000),
        });
        createdIds.push(profileId);
      }

      const page1 = await getAdmin("/api/candidates");
      expect(page1.statusCode).toBe(200);
      const p1 = page1.json();
      expect(p1.total).toBe(size);
      expect(p1.items).toHaveLength(Math.min(size, 20));
      expect(p1.items.map((c: { id: string }) => c.id)).toEqual(
        createdIds.slice(0, Math.min(size, 20)),
      );

      if (size > 20) {
        const page2 = await getAdmin("/api/candidates?page=2");
        expect(page2.statusCode).toBe(200);
        const p2 = page2.json();
        expect(p2.total).toBe(size);
        expect(p2.items[0].id).toBe(createdIds[20]);
        await expectFullWalk("/api/candidates", size, createdIds);
      }
    });

    it(`B01 courses: ${size} courses — every record reachable via paging`, async () => {
      await clearOrgData();
      const createdIds: string[] = [];
      for (let i = 0; i < size; i++) {
        createdIds.push(
          await insertCourse({
            name: `B01 course ${String(i).padStart(2, "0")}`,
            code: `B01C-${uniquePrefix()}-${i}`,
            createdAt: new Date(BASE_TIME.getTime() + i * 60_000),
          }),
        );
      }

      const page1 = await getAdmin("/api/courses");
      expect(page1.statusCode).toBe(200);
      const p1 = page1.json();
      expect(p1.total).toBe(size);
      expect(p1.items).toHaveLength(Math.min(size, 20));
      expect(p1.items.map((c: { id: string }) => c.id)).toEqual(
        createdIds.slice(0, Math.min(size, 20)),
      );

      if (size > 20) {
        const page2 = await getAdmin("/api/courses?page=2");
        expect(page2.statusCode).toBe(200);
        const p2 = page2.json();
        expect(p2.total).toBe(size);
        expect(p2.items[0].id).toBe(createdIds[20]);
        await expectFullWalk("/api/courses", size, createdIds);
      }
    });
  }

  it("B01 exams: stable ordering tiebreaks on id when createdAt is identical", async () => {
    await clearOrgData();
    const courseId = await insertCourse({
      name: "B01 tie course",
      code: `B01T-${uniquePrefix()}`,
    });
    const sameTs = new Date(BASE_TIME.getTime() + 1_000);
    await insertExam({
      title: "B01 tie A",
      status: "draft",
      courseId,
      createdAt: sameTs,
    });
    await insertExam({
      title: "B01 tie B",
      status: "draft",
      courseId,
      createdAt: sameTs,
    });
    const res = await getAdmin("/api/exams");
    const body = res.json();
    expect(body.total).toBe(2);
    const ids: string[] = body.items.map((e: ExamRow) => e.id);
    expect(ids).toEqual([...ids].sort());
  });

  // ── B02 — 考生搜索必须在数据库全集中执行 ──────────────────────────────

  async function seedB02Candidates() {
    await clearOrgData();
    // 41 candidates; #41 carries the only name keyword, #40 the only
    // username keyword. Both sit beyond the default first page.
    for (let i = 0; i < 39; i++) {
      await insertCandidate({
        name: `普通考生${i}`,
        username: `b02-plain-${uniquePrefix()}-${i}`,
        createdAt: new Date(BASE_TIME.getTime() + i * 60_000),
      });
    }
    await insertCandidate({
      name: "王考生",
      username: `u.qaz785.${uniquePrefix()}`,
      createdAt: new Date(BASE_TIME.getTime() + 39 * 60_000),
    });
    await insertCandidate({
      name: "Zoe zebra785",
      username: `u41.${uniquePrefix()}`,
      createdAt: new Date(BASE_TIME.getTime() + 40 * 60_000),
    });
  }

  it("B02 candidates: search reaches record #41 by name from page 1 (case-insensitive)", async () => {
    await seedB02Candidates();
    const res = await getAdmin("/api/candidates?search=ZEBRA785");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Zoe zebra785");
  });

  it("B02 candidates: search reaches a page-2 record by username (case-insensitive)", async () => {
    await seedB02Candidates();
    const res = await getAdmin("/api/candidates?search=qaz785");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].username).toContain("qaz785");
  });

  it("B02 candidates: no-match search returns a true empty result", async () => {
    await seedB02Candidates();
    const res = await getAdmin("/api/candidates?search=nomatch785xyz");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });

  it("B02 candidates: search applies before pagination (25 matches span two pages)", async () => {
    await clearOrgData();
    for (let i = 0; i < 25; i++) {
      await insertCandidate({
        name: `bulk785 批次${i}`,
        username: `b02-bulk-${uniquePrefix()}-${i}`,
        createdAt: new Date(BASE_TIME.getTime() + i * 60_000),
      });
    }
    for (let i = 0; i < 16; i++) {
      await insertCandidate({
        name: `无关考生${i}`,
        username: `b02-other-${uniquePrefix()}-${i}`,
        createdAt: new Date(BASE_TIME.getTime() + 100 * 60_000),
      });
    }
    const page1 = await getAdmin("/api/candidates?search=bulk785");
    expect(page1.statusCode).toBe(200);
    const p1 = page1.json();
    expect(p1.total).toBe(25);
    expect(p1.items).toHaveLength(20);
    for (const item of p1.items) {
      expect(item.name).toContain("bulk785");
    }

    const page2 = await getAdmin("/api/candidates?search=bulk785&page=2");
    expect(page2.statusCode).toBe(200);
    const p2 = page2.json();
    expect(p2.total).toBe(25);
    expect(p2.items).toHaveLength(5);
    for (const item of p2.items) {
      expect(item.name).toContain("bulk785");
    }

    // Clearing the search restores the full-set pagination.
    const cleared = await getAdmin("/api/candidates");
    expect(cleared.json().total).toBe(41);
  });

  it("B02 candidates: whitespace-only search means no filter; over-long term is rejected", async () => {
    await seedB02Candidates();
    const blank = await getAdmin(
      `/api/candidates?search=${encodeURIComponent("   ")}`,
    );
    expect(blank.statusCode).toBe(200);
    expect(blank.json().total).toBe(41);

    const tooLong = await getAdmin(`/api/candidates?search=${"x".repeat(201)}`);
    expect(tooLong.statusCode).toBe(400);
  });

  // ── B03 — 课程搜索与分页组合 ──────────────────────────────────────────

  it("B03 courses: server-side search covers the full set and combines with paging", async () => {
    await clearOrgData();
    for (let i = 0; i < 25; i++) {
      await insertCourse({
        name: `bulk785 课程${i}`,
        code: `B785-${String(i).padStart(3, "0")}`,
        createdAt: new Date(BASE_TIME.getTime() + i * 60_000),
      });
    }
    for (let i = 0; i < 15; i++) {
      await insertCourse({
        name: `其他课程${i}`,
        code: `OTH-${uniquePrefix()}-${i}`,
        createdAt: new Date(BASE_TIME.getTime() + 100 * 60_000),
      });
    }

    const page1 = await getAdmin("/api/courses?search=bulk785");
    expect(page1.statusCode).toBe(200);
    const p1 = page1.json();
    expect(p1.total).toBe(25);
    expect(p1.items).toHaveLength(20);

    const page2 = await getAdmin("/api/courses?search=bulk785&page=2");
    expect(page2.statusCode).toBe(200);
    const p2 = page2.json();
    expect(p2.total).toBe(25);
    expect(p2.items).toHaveLength(5);
    for (const item of [...p1.items, ...p2.items]) {
      expect(item.name).toContain("bulk785");
    }

    // Search by code is case-insensitive too.
    const byCode = await getAdmin("/api/courses?search=b785-007");
    expect(byCode.json().total).toBe(1);

    // Clearing restores the full set.
    const cleared = await getAdmin("/api/courses");
    expect(cleared.json().total).toBe(40);
  });

  // ── B13 — 描述搜索覆盖服务端全集（保持 #785 前客户端搜索语义） ─────────

  it("B13 courses: search matches description and spans pages across the full set", async () => {
    await clearOrgData();
    // 25 courses whose description — and only their description — carries
    // the keyword. name/code intentionally never contain it, so a name/code
    // predicate alone would return zero matches (the pre-fix regression).
    for (let i = 0; i < 25; i++) {
      await insertCourse({
        name: `普通课程${String(i).padStart(2, "0")}`,
        code: `ORD-${uniquePrefix()}-${String(i).padStart(3, "0")}`,
        description: `课程简介 descword785 第${i}条`,
        createdAt: new Date(BASE_TIME.getTime() + i * 60_000),
      });
    }
    // Non-matching control: same shape, description without the keyword.
    for (let i = 0; i < 10; i++) {
      await insertCourse({
        name: `对照课程${i}`,
        code: `CTL-${uniquePrefix()}-${i}`,
        description: "无关描述",
        createdAt: new Date(BASE_TIME.getTime() + 100 * 60_000),
      });
    }

    // The description-only matches span a page boundary: total=25, page 1
    // carries 20 rows, page 2 the remaining 5, union = the full matched set.
    const page1 = await getAdmin("/api/courses?search=descword785");
    expect(page1.statusCode).toBe(200);
    const p1 = page1.json();
    expect(p1.total).toBe(25);
    expect(p1.items).toHaveLength(20);

    const page2 = await getAdmin("/api/courses?search=descword785&page=2");
    expect(page2.statusCode).toBe(200);
    const p2 = page2.json();
    expect(p2.total).toBe(25);
    expect(p2.items).toHaveLength(5);

    const names = new Set<string>(
      [...p1.items, ...p2.items].map((c: { name: string }) => c.name),
    );
    expect(names.size).toBe(25);
    for (const item of [...p1.items, ...p2.items]) {
      expect(item.description).toContain("descword785");
    }

    // Case-insensitive on the description predicate too.
    const byUpper = await getAdmin("/api/courses?search=DESCWORD785");
    expect(byUpper.json().total).toBe(25);

    // A term that exists only in some descriptions counts exactly those.
    const narrow = await getAdmin(
      `/api/courses?search=${encodeURIComponent("第7条")}`,
    );
    expect(narrow.json().total).toBe(1);
  });

  // ── B04 — 状态筛选必须先于分页 ────────────────────────────────────────

  it("B04 results overview status set is filtered server-side before pagination", async () => {
    await clearOrgData();
    const courseId = await insertCourse({
      name: "B04 course",
      code: `B04-${uniquePrefix()}`,
    });
    // 20 drafts are the OLDEST records: without a server-side status filter
    // they would occupy the entire first page.
    for (let i = 0; i < 20; i++) {
      await insertExam({
        title: `B04 draft ${String(i).padStart(2, "0")}`,
        status: "draft",
        courseId,
        createdAt: new Date(BASE_TIME.getTime() + i * 60_000),
      });
    }
    const overviewStatuses = [
      "published",
      "open",
      "closed",
      "archived",
    ] as const;
    for (let i = 0; i < 20; i++) {
      await insertExam({
        title: `B04 overview ${String(i).padStart(2, "0")}`,
        status: overviewStatuses[i % overviewStatuses.length]!,
        courseId,
        createdAt: new Date(BASE_TIME.getTime() + 1_000 * 60_000 + i * 60_000),
      });
    }

    // Default (no statuses): no implicit filtering — all 40 visible.
    const unfiltered = await getAdmin("/api/exams");
    expect(unfiltered.json().total).toBe(40);

    // Results-overview status set: drafts never crowd the page.
    const filtered = await getAdmin(
      "/api/exams?statuses=published,open,closed,archived",
    );
    expect(filtered.statusCode).toBe(200);
    const body = filtered.json();
    expect(body.total).toBe(20);
    expect(body.items).toHaveLength(20);
    for (const exam of body.items) {
      expect(["published", "open", "closed", "archived"]).toContain(
        exam.status,
      );
    }
    // Page-1 membership is the filtered set's own head, not the drafts.
    expect(body.items[0].title).toContain("B04 overview");

    // Draft-only filter.
    const drafts = await getAdmin("/api/exams?statuses=draft");
    expect(drafts.json().total).toBe(20);
    for (const exam of drafts.json().items) {
      expect(exam.status).toBe("draft");
    }
  });

  // ── B05 — 考试状态与成绩查看权限相互独立 ──────────────────────────────

  it("B05 score-view permission is server-computed per exam, independent of status", async () => {
    await clearOrgData();
    const courseId = await insertCourse({
      name: "B05 course",
      code: `B05-${uniquePrefix()}`,
    });
    // Published, not ended → EXAM_NOT_FINISHED.
    const publishedId = await insertExam({
      title: "B05 published",
      status: "published",
      courseId,
      openAt: new Date(BASE_TIME.getTime() + 86_400_000),
      closeAt: null,
    });
    // Closed but no graded attempts → NO_GRADED_ATTEMPTS.
    await insertExam({ title: "B05 closed", status: "closed", courseId });
    // Canceled → EXAM_CANCELED (excluded from the overview set).
    await insertExam({ title: "B05 canceled", status: "canceled", courseId });
    // Archived WITH a graded attempt → viewable.
    const archivedId = await insertExam({
      title: "B05 archived graded",
      status: "archived",
      courseId,
    });
    const candidate = await insertCandidate({
      name: "B05 考生",
      username: `b05-${uniquePrefix()}`,
    });
    const enrollmentId = await insertEnrollment(
      archivedId,
      candidate.profileId,
    );
    await insertGradedAttempt({
      examId: archivedId,
      enrollmentId,
      candidateId: candidate.profileId,
    });

    const overview = await getAdmin(
      "/api/exams?statuses=published,open,closed,archived",
    );
    expect(overview.statusCode).toBe(200);
    const overviewItems: ExamRow[] = overview.json().items;
    // Canceled is NOT part of the overview set.
    expect(overviewItems.map((e) => e.status)).not.toContain("canceled");

    const byTitle = new Map(overviewItems.map((e) => [e.title, e]));
    const published = byTitle.get("B05 published")!;
    expect(published.canViewScores).toBe(false);
    expect(published.scoreViewDisabledReasonCode).toBe("EXAM_NOT_FINISHED");

    const closed = byTitle.get("B05 closed")!;
    expect(closed.canViewScores).toBe(false);
    expect(closed.scoreViewDisabledReasonCode).toBe("NO_GRADED_ATTEMPTS");

    const archived = byTitle.get("B05 archived graded")!;
    expect(archived.canViewScores).toBe(true);
    expect(archived.scoreViewDisabledReasonCode).toBeNull();

    // The unfiltered list still carries the canceled exam's own reason.
    const unfiltered = await getAdmin("/api/exams?pageSize=100");
    const canceled = unfiltered
      .json()
      .items.find((e: ExamRow) => e.title === "B05 canceled");
    expect(canceled.scoreViewDisabledReasonCode).toBe("EXAM_CANCELED");
    expect(canceled.canViewScores).toBe(false);
  });

  it("B05b ended exam with an unresolved attempt: list metadata matches the scores gate (F01)", async () => {
    await clearOrgData();
    const courseId = await insertCourse({
      name: "B05b course",
      code: `B05b-${uniquePrefix()}`,
    });
    // The clock has passed closeAt (examEnded = true) while one attempt is
    // still unresolved — the exact state where the list projection used to
    // advertise canViewScores=true and GET /scores answered 409.
    const examId = await insertExam({
      title: "B05b ended with unresolved",
      status: "open",
      courseId,
      closeAt: new Date(BASE_TIME.getTime() - 60_000),
    });
    const gradedCandidate = await insertCandidate({
      name: "B05b graded",
      username: `b05b-g-${uniquePrefix()}`,
    });
    const gradedEnrollment = await insertEnrollment(
      examId,
      gradedCandidate.profileId,
    );
    await insertGradedAttempt({
      examId,
      enrollmentId: gradedEnrollment,
      candidateId: gradedCandidate.profileId,
    });
    const pendingCandidate = await insertCandidate({
      name: "B05b pending",
      username: `b05b-p-${uniquePrefix()}`,
    });
    const pendingEnrollment = await insertEnrollment(
      examId,
      pendingCandidate.profileId,
    );
    await ctx.db.insert(schema.examAttempts).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      examId,
      enrollmentId: pendingEnrollment,
      candidateId: pendingCandidate.profileId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
    });

    const list = await getAdmin("/api/exams?statuses=open&pageSize=100");
    expect(list.statusCode).toBe(200);
    const row = list
      .json()
      .items.find((e: ExamRow) => e.id === examId) as ExamRow;
    expect(row).toBeDefined();
    expect(row.canViewScores).toBe(false);
    expect(row.scoreViewDisabledReasonCode).toBe("UNRESOLVED_ATTEMPTS_EXIST");

    const scores = await getAdmin(`/api/exams/${examId}/scores`);
    expect(scores.statusCode).toBe(409);
    expect(scores.json().error.details?.reason).toBe(
      "UNRESOLVED_ATTEMPTS_EXIST",
    );

    // Finalizing the trailing attempt settles the exam's results: both
    // surfaces must agree again, and the graded row remains viewable.
    await ctx.db
      .update(schema.examAttempts)
      .set({ status: "voided" })
      .where(
        and(
          eq(schema.examAttempts.examId, examId),
          eq(schema.examAttempts.status, "in_progress"),
        ),
      );

    const settledList = await getAdmin("/api/exams?statuses=open&pageSize=100");
    const settledRow = settledList
      .json()
      .items.find((e: ExamRow) => e.id === examId) as ExamRow;
    expect(settledRow.canViewScores).toBe(true);
    expect(settledRow.scoreViewDisabledReasonCode).toBeNull();

    const settledScores = await getAdmin(`/api/exams/${examId}/scores`);
    expect(settledScores.statusCode).toBe(200);
  });

  // ── B06 — 状态过滤与分页组合 ──────────────────────────────────────────

  it("B06 status filter combines with paging; duplicates/empty/invalid have explicit contracts", async () => {
    await clearOrgData();
    const courseId = await insertCourse({
      name: "B06 course",
      code: `B06-${uniquePrefix()}`,
    });
    // 25 published (NEWEST — they span the page boundary) + 17 drafts.
    for (let i = 0; i < 17; i++) {
      await insertExam({
        title: `B06 draft ${i}`,
        status: "draft",
        courseId,
        createdAt: new Date(BASE_TIME.getTime() + i * 60_000),
      });
    }
    for (let i = 0; i < 25; i++) {
      await insertExam({
        title: `B06 published ${i}`,
        status: "published",
        courseId,
        createdAt: new Date(BASE_TIME.getTime() + 100 * 60_000 + i * 60_000),
      });
    }

    // Filter + page 2: the filtered set itself spans the boundary.
    const page2 = await getAdmin("/api/exams?statuses=published&page=2");
    expect(page2.statusCode).toBe(200);
    const p2 = page2.json();
    expect(p2.total).toBe(25);
    expect(p2.items).toHaveLength(5);
    for (const exam of p2.items) {
      expect(exam.status).toBe("published");
    }

    // Duplicate tokens collapse under OR semantics.
    const dup = await getAdmin("/api/exams?statuses=published,published");
    expect(dup.statusCode).toBe(200);
    expect(dup.json().total).toBe(25);

    // Empty value = no filter (compatibility with a cleared client filter).
    const empty = await getAdmin("/api/exams?statuses=");
    expect(empty.statusCode).toBe(200);
    expect(empty.json().total).toBe(42);

    // "All states" on the ExamPage is the parameter-less default.
    const all = await getAdmin("/api/exams");
    expect(all.json().total).toBe(42);

    // Invalid token is a validation error, never a silent full scan.
    const invalid = await getAdmin("/api/exams?statuses=published,bogus");
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");
  });

  // ── B09 — 授权范围与筛选组合 ──────────────────────────────────────────

  it("B09 teacher scope, tenant isolation, search and status compose without leakage or duplication", async () => {
    await clearOrgData();
    // Main org: two courses; teacher sees only C1.
    const c1 = await insertCourse({
      name: "B09 C1",
      code: `B09C1-${uniquePrefix()}`,
    });
    const c2 = await insertCourse({
      name: "B09 C2",
      code: `B09C2-${uniquePrefix()}`,
    });
    const e1 = await insertExam({
      title: "B09 E1 (C1, published)",
      status: "published",
      courseId: c1,
    });
    const e2 = await insertExam({
      title: "B09 E2 (C2, published)",
      status: "published",
      courseId: c2,
    });
    const e3 = await insertExam({
      title: "B09 E3 (C1, draft)",
      status: "draft",
      courseId: c1,
    });
    // K1 has TWO enrollments (E1 + E3) — both resolve through course C1.
    const k1 = await insertCandidate({
      name: "alice785 多报名",
      username: `b09-k1-${uniquePrefix()}`,
    });
    const k2 = await insertCandidate({
      name: "bob785 非授权课程",
      username: `b09-k2-${uniquePrefix()}`,
    });
    await insertEnrollment(e1, k1.profileId);
    await insertEnrollment(e3, k1.profileId);
    // K2 is enrolled ONLY in C2's exam — outside the teacher's scope.
    await insertEnrollment(e2, k2.profileId);

    const teacher = await createTeacherWithScope([c1]);

    // Exams: scope first, then status — same filter semantics as Admin.
    const teacherExams = await getAs("/api/exams", teacher.token);
    expect(teacherExams.json().total).toBe(2);
    const teacherPublished = await getAs(
      "/api/exams?statuses=published",
      teacher.token,
    );
    expect(teacherPublished.json().total).toBe(1);
    expect(teacherPublished.json().items[0].title).toContain("E1");

    // Candidates: multiple enrollments must not duplicate rows or counts.
    const teacherCandidates = await getAs("/api/candidates", teacher.token);
    expect(teacherCandidates.json().total).toBe(1);
    expect(teacherCandidates.json().items[0].name).toContain("alice785");

    // Search within teacher scope.
    const teacherSearchHit = await getAs(
      "/api/candidates?search=alice785",
      teacher.token,
    );
    expect(teacherSearchHit.json().total).toBe(1);
    const teacherSearchMiss = await getAs(
      "/api/candidates?search=bob785",
      teacher.token,
    );
    // bob785 is enrolled only in C2's exam — out of the teacher's scope.
    expect(teacherSearchMiss.json().total).toBe(0);

    // Courses: scope applies with search.
    const teacherCourses = await getAs("/api/courses", teacher.token);
    expect(teacherCourses.json().total).toBe(1);
    expect(teacherCourses.json().items[0].code).toContain("B09C1");

    // Empty teacher scope → empty sets with total 0 (never unfiltered).
    const emptyTeacher = await createTeacherWithScope([]);
    const emptyExams = await getAs("/api/exams", emptyTeacher.token);
    expect(emptyExams.json()).toMatchObject({ items: [], total: 0 });
    const emptyCandidates = await getAs("/api/candidates", emptyTeacher.token);
    expect(emptyCandidates.json()).toMatchObject({ items: [], total: 0 });
    const emptyCourses = await getAs("/api/courses", emptyTeacher.token);
    expect(emptyCourses.json()).toMatchObject({ items: [], total: 0 });

    // Another tenant: identical keyword exists THERE.
    const otherOrgId = randomUUID();
    extraOrgIds.push(otherOrgId);
    await ctx.db.insert(schema.organizations).values({
      id: otherOrgId,
      name: "B09 other org",
      displayName: "B09 other org",
      slug: `b09-other-${uniquePrefix()}`,
    });
    const otherCourseId = await insertCourse({
      name: "B09 other course",
      code: `B09O-${uniquePrefix()}`,
      organizationId: otherOrgId,
    });
    await insertExam({
      title: "carol785 other-org exam",
      status: "published",
      courseId: otherCourseId,
      organizationId: otherOrgId,
    });
    const otherCandidate = await insertCandidate({
      name: "carol785",
      username: `b09-other-${uniquePrefix()}`,
      organizationId: otherOrgId,
    });

    // Admin of org1 cannot reach org2 records via search or status filters.
    const adminCrossSearch = await getAdmin("/api/candidates?search=carol785");
    expect(adminCrossSearch.statusCode).toBe(200);
    expect(adminCrossSearch.json()).toMatchObject({ items: [], total: 0 });

    const adminCrossStatus = await getAdmin("/api/exams?statuses=published");
    expect(adminCrossStatus.json().total).toBe(
      adminCrossStatus
        .json()
        .items.filter((e: ExamRow) => e.status === "published").length,
    );
    for (const exam of adminCrossStatus.json().items) {
      expect(exam.title).not.toContain("other-org");
    }

    // Teacher cannot reach org2 records either.
    const teacherCrossSearch = await getAs(
      "/api/candidates?search=carol785",
      teacher.token,
    );
    expect(teacherCrossSearch.json()).toMatchObject({ items: [], total: 0 });
    expect(otherCandidate.profileId).toBeTruthy();
  });

  // ── B10 — 旧客户端向后兼容 ────────────────────────────────────────────

  it("B10 legacy clients: no params → default page/pageSize, original order, no implicit status filter", async () => {
    await clearOrgData();
    const courseId = await insertCourse({
      name: "B10 course",
      code: `B10-${uniquePrefix()}`,
    });
    const statuses = [
      "draft",
      "published",
      "open",
      "closed",
      "canceled",
      "archived",
    ] as const;
    const createdIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      createdIds.push(
        await insertExam({
          title: `B10 exam ${i} (${statuses[i]})`,
          status: statuses[i]!,
          courseId,
          createdAt: new Date(BASE_TIME.getTime() + i * 60_000),
        }),
      );
    }

    const res = await getAdmin("/api/exams");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Pagination contract shape and defaults are unchanged.
    expect(Object.keys(body).sort()).toEqual([
      "items",
      "page",
      "pageSize",
      "total",
      "totalPages",
    ]);
    expect(body).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 3,
      totalPages: 1,
    });
    // No implicit status filtering; ordering is createdAt ASC.
    expect(body.items.map((e: ExamRow) => e.id)).toEqual(createdIds);

    for (const url of ["/api/exams", "/api/candidates", "/api/courses"]) {
      const shape = await getAdmin(url);
      expect(Object.keys(shape.json()).sort()).toEqual([
        "items",
        "page",
        "pageSize",
        "total",
        "totalPages",
      ]);
    }
  });

  it("B10 invalid pagination input keeps the explicit 400 contract", async () => {
    await clearOrgData();
    for (const url of ["/api/exams", "/api/candidates", "/api/courses"]) {
      expect((await getAdmin(`${url}?pageSize=101`)).statusCode).toBe(400);
      expect((await getAdmin(`${url}?pageSize=0`)).statusCode).toBe(400);
      expect((await getAdmin(`${url}?page=0`)).statusCode).toBe(400);
      expect((await getAdmin(`${url}?page=abc`)).statusCode).toBe(400);
    }
  });
});
