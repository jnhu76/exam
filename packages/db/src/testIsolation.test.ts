import { describe, expect, it, afterAll, beforeAll } from "vitest";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import {
  sanitizeSchemaName,
  quoteIdent,
  buildSchemaName,
  addSearchPathToUrl,
  stripOptionsFromUrl,
  createTestSchema,
  dropTestSchema,
  setupIsolatedTestDb,
  generateUniqueSchemaName,
  isTestDbIsolationEnabled,
} from "./testIsolation.js";
import { createDatabase } from "./database.js";
import { migratePostgres } from "./postgres.js";
import { schema } from "./schema/pg.js";
import { seed } from "./seed.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { resolveTestDbUrl } from "./testDb.js";

const TEST_DB_URL = resolveTestDbUrl();

describe("sanitizeSchemaName", () => {
  it("lowercases input", () => {
    expect(sanitizeSchemaName("FOO_BAR")).toBe("foo_bar");
  });

  it("replaces illegal characters with underscore", () => {
    expect(sanitizeSchemaName("hello world!@#$%^")).toBe("hello_world_");
  });

  it("collapses consecutive underscores", () => {
    expect(sanitizeSchemaName("a___b")).toBe("a_b");
  });

  it("removes leading underscores", () => {
    expect(sanitizeSchemaName("___foo")).toBe("foo");
  });

  it("prefixes with s_ when starts with digit", () => {
    expect(sanitizeSchemaName("123foo")).toMatch(/^s_/);
  });

  it("truncates to 63 characters", () => {
    const long = "a".repeat(100);
    const result = sanitizeSchemaName(long);
    expect(result.length).toBeLessThanOrEqual(63);
  });

  it("handles empty input gracefully", () => {
    const result = sanitizeSchemaName("");
    expect(result).toMatch(/^s_/);
  });
});

describe("quoteIdent", () => {
  it("wraps in double quotes", () => {
    expect(quoteIdent("foo")).toBe('"foo"');
  });

  it("escapes embedded double quotes", () => {
    expect(quoteIdent('foo"bar')).toBe('"foo""bar"');
  });
});

describe("buildSchemaName", () => {
  it("builds name from parts", () => {
    const name = buildSchemaName("api", "w1", 12345, "abc123");
    expect(name).toBe("test_api_w1_12345_abc123");
  });

  it("sanitizes all parts", () => {
    const name = buildSchemaName("API-TEST!", "W#1", -1, "");
    expect(name).toMatch(/^test_/);
    expect(name).not.toContain("!");
    expect(name).not.toContain("#");
  });
});

describe("addSearchPathToUrl", () => {
  it("appends options parameter to URL without existing params", () => {
    const result = addSearchPathToUrl(TEST_DB_URL, "test_foo");
    expect(result).toContain("?options=");
    expect(result).toContain("search_path");
    expect(result).toContain("test_foo");
  });

  it("appends to URL with existing params", () => {
    const url = `${TEST_DB_URL}?sslmode=require`;
    const result = addSearchPathToUrl(url, "test_bar");
    expect(result).toContain("&options=");
    expect(result).toContain("sslmode=require");
  });
});

describe("stripOptionsFromUrl", () => {
  it("removes options parameter", () => {
    const withOpts = addSearchPathToUrl(TEST_DB_URL, "test_foo");
    const cleaned = stripOptionsFromUrl(withOpts);
    expect(cleaned).not.toContain("options=");
    expect(cleaned).toBe(TEST_DB_URL);
  });

  it("removes options and preserves other params", () => {
    const url = `${TEST_DB_URL}?sslmode=require`;
    const withOpts = addSearchPathToUrl(url, "test_foo");
    const cleaned = stripOptionsFromUrl(withOpts);
    expect(cleaned).toContain("sslmode=require");
    expect(cleaned).not.toContain("options=");
  });
});

describe(
  "create and drop schema",
  // Hang-protection budget: every `it` here acquires the test-infra lifecycle
  // lock, which now serializes ALL heavy catalog DDL (schema + database +
  // migration) on ONE coordination database. Under parallel `@exam/db` runs a
  // quick CREATE SCHEMA can wait behind sibling CREATE/DROP DATABASE sections
  // (seconds each), so the default 5s test timeout is not a sufficient budget.
  // The ordering itself is deterministic; this is pure hang protection.
  { timeout: 30_000 },
  () => {
    // NOTE: each `it` owns its own unique schema. Earlier this describe shared a
    // single `testSchema` across `it` blocks in a strict create→idempotent→
    // drop→idempotent-drop sequence. That is an order dependency that breaks
    // under `sequence.concurrent: true` / `it.concurrent` (later `it` would
    // drop/observe a schema the earlier `it` had not yet created). Giving each
    // test its own schema makes the suite order-independent and safe under any
    // execution mode.

    it("creates a schema", async () => {
      const name = generateUniqueSchemaName("isolation_create");
      try {
        await expect(
          createTestSchema(TEST_DB_URL, name),
        ).resolves.toBeUndefined();

        const sql = postgres(TEST_DB_URL);
        try {
          const rows =
            await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${name}`;
          expect(rows.length).toBe(1);
        } finally {
          await sql.end();
        }
      } finally {
        await dropTestSchema(TEST_DB_URL, name).catch(() => {});
      }
    });

    it("create is idempotent (second create does not error)", async () => {
      const name = generateUniqueSchemaName("isolation_idem");
      try {
        await createTestSchema(TEST_DB_URL, name);
        await expect(
          createTestSchema(TEST_DB_URL, name),
        ).resolves.toBeUndefined();
      } finally {
        await dropTestSchema(TEST_DB_URL, name).catch(() => {});
      }
    });

    it("drops a schema", async () => {
      const name = generateUniqueSchemaName("isolation_drop");
      await createTestSchema(TEST_DB_URL, name);
      await dropTestSchema(TEST_DB_URL, name);

      const sql = postgres(TEST_DB_URL);
      try {
        const rows =
          await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${name}`;
        expect(rows.length).toBe(0);
      } finally {
        await sql.end();
      }
    });

    it("drop is idempotent (IF EXISTS)", async () => {
      // Dropping a (likely) non-existent test_ schema must not throw thanks to
      // IF EXISTS. Fully self-contained; does not depend on any prior `it`.
      const name = generateUniqueSchemaName("isolation_dropidem");
      await expect(dropTestSchema(TEST_DB_URL, name)).resolves.toBeUndefined();
    });

    it("refuses to drop non-test_ schema", async () => {
      await expect(dropTestSchema(TEST_DB_URL, "public")).rejects.toThrow(
        /does not start with "test_"/,
      );
    });
  },
);

describe(
  "migration creates tables in isolated schema",
  // See "create and drop schema" — beforeAll acquires the lifecycle lock
  // (createTestSchema) and runs a full migrate that can queue behind sibling
  // heavy sections under parallel load.
  { timeout: 60_000 },
  () => {
    const testSchema = `test_isolation_migrate_${Date.now()}`;

    beforeAll(async () => {
      await createTestSchema(TEST_DB_URL, testSchema);
      const conn = await createDatabase(TEST_DB_URL, testSchema);
      await migratePostgres(conn.db, { migrationsSchema: testSchema });
      await conn.sql.end();
    });

    afterAll(async () => {
      await dropTestSchema(TEST_DB_URL, testSchema).catch(() => {});
    });

    it("creates core business tables in the isolated schema", async () => {
      const sql = postgres(TEST_DB_URL);
      try {
        const tables = await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${testSchema}
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;
        const tableNames = tables.map((r: any) => r.table_name);

        expect(tableNames).toContain("organizations");
        expect(tableNames).toContain("users");
        expect(tableNames).toContain("courses");
        expect(tableNames).toContain("questions");
        expect(tableNames).toContain("exams");
        expect(tableNames).toContain("exam_enrollments");
        expect(tableNames).toContain("exam_attempts");
        expect(tableNames).toContain("audit_logs");
        expect(tableNames).toContain("candidate_fields");
        expect(tableNames).toContain("candidate_profiles");
        expect(tableNames).toContain("organization_settings");
      } finally {
        await sql.end();
      }
    });

    it("does not duplicate drizzle migration tracking across schemas", async () => {
      // The isolated schema should have its own __drizzle_migrations table
      // but public should not have been modified by this migration run
      const sql = postgres(TEST_DB_URL);
      try {
        const rows = await sql`
        SELECT table_schema FROM information_schema.tables
        WHERE table_name = '__drizzle_migrations'
          AND table_schema = ${testSchema}
      `;
        expect(rows.length).toBe(1);
      } finally {
        await sql.end();
      }
    });
  },
);

describe(
  "seed works in isolated schema",
  // Same lifecycle-queue budget as the describes above: beforeAll runs
  // createTestSchema (locked) + a full migrate + seed.
  { timeout: 60_000 },
  () => {
    const testSchema = `test_isolation_seed_${Date.now()}`;

    beforeAll(async () => {
      await createTestSchema(TEST_DB_URL, testSchema);
      const conn = await createDatabase(TEST_DB_URL, testSchema);
      await migratePostgres(conn.db, { migrationsSchema: testSchema });
      await seed(conn.db, hashPassword);
      await conn.sql.end();
    });

    afterAll(async () => {
      await dropTestSchema(TEST_DB_URL, testSchema).catch(() => {});
    });

    it("creates default org in isolated schema", async () => {
      const { db } = await createDatabase(TEST_DB_URL, testSchema);
      const orgs = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.slug, "default"));
      expect(orgs.length).toBe(1);
      expect(orgs[0]!.name).toBeDefined();
    });

    it("creates admin user in isolated schema", async () => {
      const { db } = await createDatabase(TEST_DB_URL, testSchema);
      const users = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, "admin"));
      expect(users.length).toBe(1);
      expect(users[0]!.role).toBe("Admin");
    });

    it("creates org in isolated schema", async () => {
      const sql = postgres(TEST_DB_URL);
      try {
        const rows = await sql`
        SELECT id FROM ${sql(testSchema)}.organizations
        WHERE slug = 'default'
      `;
        expect(rows.length).toBe(1);
      } finally {
        await sql.end();
      }
    });
  },
);

describe(
  "setupIsolatedTestDb",
  // beforeAll/afterAll + the cleanup test acquire the lifecycle lock; same
  // queue budget rationale as "create and drop schema".
  { timeout: 60_000 },
  () => {
    // NOTE: setup MUST live in `beforeAll`, not in the first `it`. Earlier this
    // suite assigned `testDb` inside the first `it` and let later `it` blocks
    // read it. That is an order dependency: it only works because Vitest runs
    // `it` blocks sequentially by default (sequence.concurrent defaults to
    // false). Under `sequence.concurrent: true` (or `it.concurrent`), the later
    // `it` blocks read `testDb` before the first one assigned it and crashed
    // with `Cannot read properties of undefined`. Moving setup to `beforeAll`
    // removes the order dependency entirely so the suite is safe under any
    // execution mode.
    let testDb: Awaited<ReturnType<typeof setupIsolatedTestDb>>;

    beforeAll(async () => {
      testDb = await setupIsolatedTestDb({
        namespace: "test-helper",
      });
    });

    afterAll(async () => {
      await testDb?.cleanup().catch(() => {});
    });

    it("returns workable info (schemaName, databaseUrl, cleanup)", async () => {
      expect(testDb.schemaName).toMatch(/^test_/);
      expect(testDb.databaseUrl).toBe(TEST_DB_URL);
      expect(typeof testDb.cleanup).toBe("function");
    });

    it("created schema exists in the database", async () => {
      const sql = postgres(TEST_DB_URL);
      try {
        const rows =
          await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${testDb.schemaName}`;
        expect(rows.length).toBe(1);
      } finally {
        await sql.end();
      }
    });

    it("can run migration and seed in the created schema", async () => {
      const { db } = await createDatabase(
        testDb.databaseUrl,
        testDb.schemaName,
      );
      await migratePostgres(db, { migrationsSchema: testDb.schemaName });
      await seed(db, hashPassword);

      const orgs = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.slug, "default"));
      expect(orgs.length).toBe(1);
    });

    it("cleanup drops the schema (self-contained: own isolated DB)", async () => {
      // Use a SEPARATE isolated DB so this test does not destroy the shared
      // `testDb` that the other `it` blocks read. Order-independent under any
      // execution mode.
      const victim = await setupIsolatedTestDb({
        namespace: "test-helper-cleanup",
      });
      await victim.cleanup();

      const sql = postgres(TEST_DB_URL);
      try {
        const rows =
          await sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${victim.schemaName}`;
        expect(rows.length).toBe(0);
      } finally {
        await sql.end();
      }
    });
  },
);

describe("isTestDbIsolationEnabled", () => {
  const orig = process.env.TEST_DB_ISOLATION;

  afterAll(() => {
    if (orig === undefined) {
      delete process.env.TEST_DB_ISOLATION;
    } else {
      process.env.TEST_DB_ISOLATION = orig;
    }
  });

  it("returns true when env is unset", () => {
    delete process.env.TEST_DB_ISOLATION;
    expect(isTestDbIsolationEnabled()).toBe(true);
  });

  it("returns true when env is 1", () => {
    process.env.TEST_DB_ISOLATION = "1";
    expect(isTestDbIsolationEnabled()).toBe(true);
  });

  it("returns true for named isolation strategies", () => {
    process.env.TEST_DB_ISOLATION = "worker-database";
    expect(isTestDbIsolationEnabled()).toBe(true);
  });

  it("returns false when env is 0", () => {
    process.env.TEST_DB_ISOLATION = "0";
    expect(isTestDbIsolationEnabled()).toBe(false);
  });
});
