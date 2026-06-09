import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createSqliteDatabase, migrateSqlite } from "../sqlite.js";
import { createPostgresDatabase } from "../postgres.js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { sqliteSchema } from "../schema/sqlite.js";
import { pgSchema } from "../schema/pg.js";
import type {
  AnyDatabase,
  SqliteDatabase,
  PostgresDatabase,
} from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

function isSqlite(db: AnyDatabase): db is SqliteDatabase {
  return "all" in db;
}

const PG_URL =
  process.env.PG_TEST_URL ?? "postgresql://exam:exam@localhost:15432/exam";

const ctx: RequestContext = {
  actorId: "actor-1",
  organizationId: "org-1",
  role: "Admin",
  permissions: [],
  sessionId: "session-1",
};

function resolveOrganizationId(c: RequestContext): string {
  return c.organizationId;
}

interface CourseRow {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description: string;
  createdAt: Date;
}

function createSpikeCourseRepo(db: AnyDatabase) {
  return {
    async create(
      c: RequestContext,
      input: { name: string; code: string; description: string },
    ): Promise<CourseRow> {
      const id = randomUUID();
      const orgId = resolveOrganizationId(c);
      const createdAt = new Date();
      const updatedAt = createdAt;
      const row = { id, organizationId: orgId, createdAt, updatedAt, ...input };

      if (isSqlite(db)) {
        db.insert(sqliteSchema.courses).values(row).run();
      } else {
        await db.insert(pgSchema.courses).values(row);
      }

      return row;
    },

    async findById(
      c: RequestContext,
      entityId: string,
    ): Promise<CourseRow | null> {
      const orgId = resolveOrganizationId(c);

      if (isSqlite(db)) {
        return (
          (db
            .select()
            .from(sqliteSchema.courses)
            .where(
              and(
                eq(sqliteSchema.courses.organizationId, orgId),
                eq(sqliteSchema.courses.id, entityId),
              ),
            )
            .get() as CourseRow | undefined) ?? null
        );
      }

      const rows = await db
        .select()
        .from(pgSchema.courses)
        .where(
          and(
            eq(pgSchema.courses.organizationId, orgId),
            eq(pgSchema.courses.id, entityId),
          ),
        );
      return (rows[0] as CourseRow | undefined) ?? null;
    },

    async list(c: RequestContext): Promise<CourseRow[]> {
      const orgId = resolveOrganizationId(c);

      if (isSqlite(db)) {
        return db
          .select()
          .from(sqliteSchema.courses)
          .where(eq(sqliteSchema.courses.organizationId, orgId))
          .all() as CourseRow[];
      }

      return (await db
        .select()
        .from(pgSchema.courses)
        .where(eq(pgSchema.courses.organizationId, orgId))) as CourseRow[];
    },

    async update(
      c: RequestContext,
      entityId: string,
      input: Partial<{ name: string; code: string; description: string }>,
    ): Promise<CourseRow | null> {
      const orgId = resolveOrganizationId(c);

      if (isSqlite(db)) {
        db.update(sqliteSchema.courses)
          .set(input)
          .where(
            and(
              eq(sqliteSchema.courses.organizationId, orgId),
              eq(sqliteSchema.courses.id, entityId),
            ),
          )
          .run();
      } else {
        await db
          .update(pgSchema.courses)
          .set(input)
          .where(
            and(
              eq(pgSchema.courses.organizationId, orgId),
              eq(pgSchema.courses.id, entityId),
            ),
          );
      }

      return createSpikeCourseRepo(db).findById(c, entityId);
    },

    async delete(c: RequestContext, entityId: string): Promise<boolean> {
      const orgId = resolveOrganizationId(c);

      if (isSqlite(db)) {
        const result = db
          .delete(sqliteSchema.courses)
          .where(
            and(
              eq(sqliteSchema.courses.organizationId, orgId),
              eq(sqliteSchema.courses.id, entityId),
            ),
          )
          .run();
        return result.changes > 0;
      }

      await db
        .delete(pgSchema.courses)
        .where(
          and(
            eq(pgSchema.courses.organizationId, orgId),
            eq(pgSchema.courses.id, entityId),
          ),
        );
      return true;
    },
  };
}

function testSuite(
  label: string,
  setupDb: () => Promise<AnyDatabase> | AnyDatabase,
  teardownDb?: (db: AnyDatabase) => Promise<void> | void,
) {
  describe(label, () => {
    let db: AnyDatabase;
    let repo: ReturnType<typeof createSpikeCourseRepo>;

    beforeAll(async () => {
      db = await setupDb();

      const nowTs = new Date();
      const orgRow = {
        id: "org-1",
        name: "Test Org",
        displayName: "Test",
        slug: "test",
        createdAt: nowTs,
        updatedAt: nowTs,
      };

      if (isSqlite(db)) {
        db.insert(sqliteSchema.organizations).values(orgRow).run();
      } else {
        await db
          .insert(pgSchema.organizations)
          .values(orgRow)
          .onConflictDoNothing({ target: pgSchema.organizations.id });
      }

      repo = createSpikeCourseRepo(db);
    });

    afterAll(async () => {
      if (teardownDb) await teardownDb(db);
    });

    it("creates a course", async () => {
      const course = await repo.create(ctx, {
        name: "Math 101",
        code: "MATH101",
        description: "Intro to Math",
      });
      expect(course.id).toBeDefined();
      expect(course.organizationId).toBe("org-1");
      expect(course.name).toBe("Math 101");
      expect(course.code).toBe("MATH101");
    });

    it("finds course by id", async () => {
      const created = await repo.create(ctx, {
        name: "Physics 201",
        code: "PHYS201",
        description: "Mechanics",
      });
      const found = await repo.findById(ctx, created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Physics 201");
    });

    it("returns null for non-existent id", async () => {
      const found = await repo.findById(ctx, "nonexistent");
      expect(found).toBeNull();
    });

    it("lists courses for tenant", async () => {
      await repo.create(ctx, {
        name: "Chem 101",
        code: "CHEM101",
        description: "Intro Chem",
      });
      const courses = await repo.list(ctx);
      expect(courses.length).toBeGreaterThanOrEqual(1);
      expect(courses.every((c) => c.organizationId === "org-1")).toBe(true);
    });

    it("updates a course", async () => {
      const created = await repo.create(ctx, {
        name: "Bio 101",
        code: "BIO101",
        description: "Intro Bio",
      });
      const updated = await repo.update(ctx, created.id, {
        name: "Biology 101 Updated",
      });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("Biology 101 Updated");
      expect(updated!.code).toBe("BIO101");
    });

    it("deletes a course", async () => {
      const created = await repo.create(ctx, {
        name: "Delete Me",
        code: "DEL001",
        description: "To be deleted",
      });
      const deleted = await repo.delete(ctx, created.id);
      expect(deleted).toBe(true);
      const found = await repo.findById(ctx, created.id);
      expect(found).toBeNull();
    });
  });
}

async function isPgAvailable(): Promise<boolean> {
  try {
    const conn = createPostgresDatabase(PG_URL);
    await conn.sql`SELECT 1`;
    await conn.sql.end();
    return true;
  } catch {
    return false;
  }
}

describe("A00 Spike: dual-dialect courseRepo", () => {
  testSuite("SQLite (in-memory)", () => {
    const conn = createSqliteDatabase(":memory:");
    migrateSqlite(conn.db);
    return conn.db;
  });
});

describe.skipIf(!(await isPgAvailable()))(
  "A00 Spike: dual-dialect courseRepo > PostgreSQL",
  () => {
    let db: AnyDatabase;
    let repo: ReturnType<typeof createSpikeCourseRepo>;

    beforeAll(async () => {
      const conn = createPostgresDatabase(PG_URL);
      await migratePg(conn.db, {
        migrationsFolder: fileURLToPath(
          new URL("../../migrations/postgres", import.meta.url),
        ),
      });
      db = conn.db;

      const nowTs = new Date();
      const orgRow = {
        id: "org-1",
        name: "Test Org",
        displayName: "Test",
        slug: "test",
        createdAt: nowTs,
        updatedAt: nowTs,
      };
      await db
        .insert(pgSchema.organizations)
        .values(orgRow)
        .onConflictDoNothing({ target: pgSchema.organizations.id });
      repo = createSpikeCourseRepo(db);
    });

    afterAll(async () => {
      const pg = db as PostgresDatabase;
      await pg.delete(pgSchema.courses);
      await pg.delete(pgSchema.organizations);
    });

    it("creates a course", async () => {
      const course = await repo.create(ctx, {
        name: "Math 101",
        code: "MATH101",
        description: "Intro to Math",
      });
      expect(course.id).toBeDefined();
      expect(course.organizationId).toBe("org-1");
      expect(course.name).toBe("Math 101");
      expect(course.code).toBe("MATH101");
    });

    it("finds course by id", async () => {
      const created = await repo.create(ctx, {
        name: "Physics 201",
        code: "PHYS201",
        description: "Mechanics",
      });
      const found = await repo.findById(ctx, created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Physics 201");
    });

    it("returns null for non-existent id", async () => {
      const found = await repo.findById(ctx, "nonexistent");
      expect(found).toBeNull();
    });

    it("lists courses for tenant", async () => {
      await repo.create(ctx, {
        name: "Chem 101",
        code: "CHEM101",
        description: "Intro Chem",
      });
      const courses = await repo.list(ctx);
      expect(courses.length).toBeGreaterThanOrEqual(1);
      expect(courses.every((c) => c.organizationId === "org-1")).toBe(true);
    });

    it("updates a course", async () => {
      const created = await repo.create(ctx, {
        name: "Bio 101",
        code: "BIO101",
        description: "Intro Bio",
      });
      const updated = await repo.update(ctx, created.id, {
        name: "Biology 101 Updated",
      });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("Biology 101 Updated");
      expect(updated!.code).toBe("BIO101");
    });

    it("deletes a course", async () => {
      const created = await repo.create(ctx, {
        name: "Delete Me",
        code: "DEL001",
        description: "To be deleted",
      });
      const deleted = await repo.delete(ctx, created.id);
      expect(deleted).toBe(true);
      const found = await repo.findById(ctx, created.id);
      expect(found).toBeNull();
    });
  },
);
