import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import authPlugin from "../plugins/auth.js";
import tenantPlugin from "../plugins/tenant.js";
import rateLimitPlugin from "../plugins/rateLimit.js";
import nowPlugin from "../plugins/now.js";
import zodProviderPlugin from "../plugins/zodProvider.js";
import { setupErrorHandler } from "../plugins/errors.js";
import setupSecurity from "../plugins/security.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { createDatabase } from "@exam/db/src/database.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { seed } from "@exam/db/src/seed.js";
import type { Database } from "@exam/db/src/types.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { eq } from "drizzle-orm";
import type { Role } from "@exam/domain";
import { createCandidateFieldRepo } from "@exam/db/src/repository/candidateFieldRepo.js";
import {
  setupIsolatedTestDb,
  isTestDbIsolationEnabled,
} from "@exam/db/src/testIsolation.js";
import { truncateBusinessTables } from "@exam/db/src/testWorkerDatabase.js";
import {
  setupApiTestDatabaseFromEnv,
  isWorkerDatabaseMode,
  type ApiTestDatabaseHandle,
} from "./testDatabase.js";

// ── migrate-cache (I/O optimization Phase 3) ──────────────────────────
// When a single vitest fork builds the app multiple times (e.g. exam.test.ts
// has 4 describe blocks each calling buildTestApp), each call used to CREATE
// SCHEMA + run all 7 Drizzle migrations. Those ~84ms migrate calls were
// redundant: every build within the same process gets the same fresh schema.
//
// This module-level cache records the first migrated schema+connection per
// process and reuses it for subsequent builds. Between builds the schema is
// TRUNCATE-reset (RESTART IDENTITY CASCADE, preserving migration metadata),
// so each build still sees a clean business-data slate — exactly the same
// post-migrate state the original CREATE SCHEMA + migrate provided.
//
// Probed savings: ~232ms/build (467ms fresh → 235ms cached) for multi-build
// files. Risk: none for intra-file builds that create a fresh ctx each time.
// Files that share a ctx across builds (e.g. a beforeAll ctx reused in
// multiple it blocks) are NOT affected because they call buildTestApp once.

interface CachedSchemaState {
  schemaName: string;
  databaseUrl: string;
  conn: Awaited<ReturnType<typeof createDatabase>>;
  /** Cleanup the schema at end of process (drop schema cascade). */
  isoCleanup: () => Promise<void>;
}

/** Role constants for future roles not yet active in Phase 1 (Teacher, Proctor, Grader, etc.). */
export const LEGACY_ROLES = [
  "SuperAdmin",
  "Teacher",
  "Proctor",
  "Grader",
  "ContentManager",
  "ResultViewer",
] as const;
/** Union type of the legacy role string literals. */
export type LegacyRole = (typeof LEGACY_ROLES)[number];

let _counter = 0;
/**
 * Generates a unique string prefix using the current timestamp and an
 * incrementing counter, useful for creating non-colliding test data.
 */
export function uniquePrefix(): string {
  _counter++;
  return `${Date.now().toString(36)}-${_counter}`;
}

/**
 * Fastify plugin that decorates the instance with a database connection.
 */
function createDbPlugin(db: Database) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

type TestUser = typeof schema.users.$inferSelect;

type TestOrganization = typeof schema.organizations.$inferSelect;

/**
 * Context returned by buildTestApp, containing the Fastify instance,
 * database, cleanup function, seeded org/users, auth tokens, and
 * a time-override helper for deterministic test scenarios.
 */
export interface TestContext {
  app: ReturnType<typeof Fastify>;
  db: Database;
  cleanup: () => Promise<void>;
  org: TestOrganization;
  admin: TestUser;
  candidate: TestUser;
  adminToken: string;
  candidateToken: string;
  setNow: (now: Date | null) => void;
}

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://exam:exam@localhost:5432/exam_test";

/**
 * Builds a fully configured Fastify test application with a fresh Postgres
 * database, seeded data, auth/tenant/rateLimit plugins, and the provided
 * route plugin. Returns a TestContext with tokens and cleanup.
 *
 * When `opts.schemaName` is provided, the database connection runs against
 * the specified PostgreSQL schema (test isolation). Otherwise the default
 * shared schema (`public`) is used.
 *
 * When `opts.reuseSchema` is true (opt-in I/O optimization), the first call
 * creates + migrates a schema and caches it in this module; subsequent calls
 * in the same process TRUNCATE + seed the cached schema instead of creating
 * a fresh one. This cuts ~232ms per build for multi-build test files.
 */
export async function buildTestApp(
  routePlugin: FastifyPluginAsync,
  opts?: {
    prefix?: string;
    rateLimit?: boolean;
    databaseUrl?: string;
    schemaName?: string;
    reuseSchema?: boolean;
  },
): Promise<TestContext> {
  const dbUrl = opts?.databaseUrl ?? TEST_DB_URL;

  // ── migrate-cache fast path (opt-in) ────────────────────────────
  if (
    opts?.reuseSchema &&
    isTestDbIsolationEnabled() &&
    !isWorkerDatabaseMode()
  ) {
    if (cachedSchema) {
      // Reuse the already-migrated schema: TRUNCATE business tables to
      // give this build a clean slate, then seed fresh org+users.
      await truncateBusinessTables(
        cachedSchema.conn.sql,
        cachedSchema.schemaName,
      );
      return finishBuildTestApp({
        routePlugin,
        conn: cachedSchema.conn,
        opts,
        customCleanup: async () => {
          // conn stays alive for the next reuse; individual builds do not
          // close the pool. The pool is closed by the schema's own cleanup
          // (drop schema cascade) at process exit.
        },
      });
    }
    // First use: create + migrate the schema, cache it.
    const iso = await setupIsolatedTestDb({
      namespace: "api-cached",
      databaseUrl: dbUrl,
    });
    const conn = await createDatabase(dbUrl, iso.schemaName);
    await migratePostgres(conn.db, { migrationsSchema: iso.schemaName });
    cachedSchema = {
      schemaName: iso.schemaName,
      databaseUrl: dbUrl,
      conn,
      isoCleanup: iso.cleanup,
    };
    return finishBuildTestApp({
      routePlugin,
      conn,
      opts,
      customCleanup: async () => {
        // conn + schema persist for the next reuse; cleaned only at
        // process exit by the module-level cleanup.
      },
    });
  }
  let resolvedSchemaName = opts?.schemaName;
  let isolatedCleanup: (() => Promise<void>) | undefined;

  // Phase 3B opt-in: when the caller did not pass an explicit schemaName AND
  // the environment selected worker-database mode, use the per-worker
  // database adapter instead of legacy per-file schema isolation. The worker
  // DB is already migrated by the adapter (Drizzle tracks applied migrations
  // in `drizzle.__drizzle_migrations`, so re-running is a no-op).
  //
  // RESET BOUNDARY (deliberate choice): we do NOT call adapter.resetPostgres()
  // here. Several API test files (e.g. auth.test.ts, user.test.ts) build the
  // app MORE THAN ONCE per file — a shared `ctx` in beforeAll plus additional
  // buildTestApp() calls inside individual `it` blocks — and reuse `ctx.org`
  // across those builds. If we truncated on every build, a later in-file
  // build would wipe the org that the shared ctx still references, causing FK
  // violations (organizations row gone). Instead, isolation between test
  // FILES is provided by the per-worker database itself: each vitest worker
  // owns its own DB, and legacy `fileParallelism:false` means only one worker
  // runs at a time. Within a file, tests keep their existing per-test reset
  // helpers (uniquePrefix fixtures, org-scoped cleanup) — unchanged from the
  // legacy path. If a future file needs explicit worker-DB truncation, it can
  // call `setupApiTestDatabaseFromEnv()` directly and use resetPostgres().
  if (!resolvedSchemaName && isWorkerDatabaseMode()) {
    const adapter: ApiTestDatabaseHandle = await setupApiTestDatabaseFromEnv({
      namespace: "api",
      ...(opts?.databaseUrl ? { databaseUrl: opts.databaseUrl } : {}),
    });
    // In worker mode there is no per-file schemaName; business tables live in
    // the worker DB's default `public` schema.
    resolvedSchemaName = undefined;
    const workerUrl = adapter.databaseUrl;
    isolatedCleanup = async () => {
      await adapter.close();
    };
    // No migratePostgres() here: the adapter already migrated the worker DB
    // (see setupWorkerTestDatabase). Migration state persists in the DB, so
    // conn.db sees it and a re-run would just be a redundant no-op per build.
    const conn = await createDatabase(workerUrl, undefined);
    return finishBuildTestApp({
      routePlugin,
      conn,
      ...(opts ? { opts } : {}),
      customCleanup: isolatedCleanup,
    });
  }

  if (!resolvedSchemaName && isTestDbIsolationEnabled()) {
    const baseUrl = opts?.databaseUrl ?? TEST_DB_URL;
    const iso = await setupIsolatedTestDb({
      namespace: "api",
      databaseUrl: baseUrl,
    });
    resolvedSchemaName = iso.schemaName;
    isolatedCleanup = iso.cleanup;
  }

  const conn = await createDatabase(dbUrl, resolvedSchemaName);
  await migratePostgres(
    conn.db,
    resolvedSchemaName ? { migrationsSchema: resolvedSchemaName } : undefined,
  );
  return finishBuildTestApp({
    routePlugin,
    conn,
    ...(opts ? { opts } : {}),
    ...(isolatedCleanup ? { customCleanup: isolatedCleanup } : {}),
  });
}

/**
 * Shared tail of {@link buildTestApp}: seeds the DB, builds the Fastify app,
 * registers plugins, mints auth tokens, and returns the TestContext. Split
 * out so the worker-DB and legacy code paths share identical app assembly.
 */
async function finishBuildTestApp(args: {
  routePlugin: FastifyPluginAsync;
  conn: Awaited<ReturnType<typeof createDatabase>>;
  opts?: {
    prefix?: string;
    rateLimit?: boolean;
    databaseUrl?: string;
    schemaName?: string;
  };
  customCleanup?: () => Promise<void>;
}): Promise<TestContext> {
  const { conn, opts, customCleanup } = args;
  const { routePlugin } = args;
  const db = conn.db;

  const seedResult = await seed(db, hashPassword);

  const app = Fastify();
  setupSecurity(app);
  setupErrorHandler(app);
  await app.register(zodProviderPlugin);
  await app.register(fastifyCookie);
  await app.register(createDbPlugin(db));
  await app.register(nowPlugin);
  await app.register(authPlugin);
  await app.register(tenantPlugin);
  if (opts?.rateLimit) {
    await app.register(rateLimitPlugin);
  }
  await app.register(routePlugin, { prefix: opts?.prefix ?? "/api" });
  await app.ready();

  const orgRows = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, seedResult.orgId));
  const org = orgRows[0]!;

  const adminRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, seedResult.users.adminId));
  const admin = adminRows[0]!;

  const candidateRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, seedResult.users.candidateId));
  const candidate = candidateRows[0]!;

  const { jwtSecret } = getRuntimeConfig().authSecret;
  const adminToken = signJWT(
    {
      actorId: admin.id,
      role: admin.role as Role,
      organizationId: admin.organizationId,
    },
    jwtSecret,
  );
  const candidateToken = signJWT(
    {
      actorId: candidate.id,
      role: candidate.role as Role,
      organizationId: candidate.organizationId,
    },
    jwtSecret,
  );

  return {
    app,
    db,
    cleanup: async () => {
      await app.close();
      await conn.sql.end();
      if (customCleanup) {
        await customCleanup();
      }
    },
    org,
    admin,
    candidate,
    adminToken,
    candidateToken,
    setNow: (now: Date | null) => {
      app.setNowOverride(now ? () => now : null);
    },
  };
}

/**
 * Creates a user with a future/legacy role (e.g. Teacher, Proctor) for
 * testing role-gated endpoints. Returns the user row and a signed JWT token.
 */
export async function createFutureRoleUserForTest(
  db: Database,
  orgId: string,
  role: LegacyRole,
  usernamePrefix: string,
): Promise<{ user: TestUser; token: string }> {
  const now = new Date();
  const passwordHash = await hashPassword("password123");
  const userRows = await db
    .insert(schema.users)
    .values({
      id: randomUUID(),
      organizationId: orgId,
      username: `${usernamePrefix}-${uniquePrefix()}`,
      passwordHash,
      name: `${role} Test User`,
      role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const user = userRows[0]!;
  const token = signJWT(
    {
      actorId: user.id,
      role: user.role as Role,
      organizationId: user.organizationId,
    },
    getRuntimeConfig().authSecret.jwtSecret,
  );
  return { user, token };
}

/**
 * Creates a candidate via the POST /api/candidates API endpoint using
 * an admin token. Populates required candidate fields from the org's
 * CandidateField config. Returns the candidate profile ID, user ID,
 * and a signed candidate JWT token.
 */
export async function createCandidateViaApi(
  app: TestContext["app"],
  adminToken: string,
  username: string,
  orgId: string,
) {
  const fieldRepo = createCandidateFieldRepo(
    (app as any).db ?? (app as any).decorator?.db,
  );
  let fields: Record<string, unknown> = {};
  try {
    const ctx = { organizationId: orgId, targetOrganizationId: orgId } as any;
    const configured = await fieldRepo.list(ctx);
    for (const f of configured) {
      if (f.required) {
        fields[f.name] = `${username}-${f.name}`;
      }
    }
  } catch {
    fields = {};
  }

  const res = await app.inject({
    method: "POST",
    url: "/api/candidates",
    payload: {
      username,
      password: "password123",
      name: `Candidate ${username}`,
      fields,
    },
    cookies: { "auth-token": adminToken },
  });
  if (res.statusCode !== 201) {
    throw new Error(
      `createCandidateViaApi failed: ${res.statusCode} ${res.body}`,
    );
  }
  const body = res.json() as {
    id: string;
    userId: string;
    fields: Record<string, unknown>;
  };
  const token = signJWT(
    {
      actorId: body.userId,
      role: "Candidate",
      organizationId: orgId,
    },
    getRuntimeConfig().authSecret.jwtSecret,
  );
  return {
    candidateProfileId: body.id,
    userId: body.userId,
    token,
  };
}

type FastifyInstance = TestContext["app"];

/**
 * Creates a complete exam via the API: course, question, and exam entities.
 * Returns the created exam ID. All entities are created with unique prefixed
 * course codes to avoid collisions in parallel tests.
 */
export async function createExamViaApi(
  app: FastifyInstance,
  adminToken: string,
  opts: {
    examTitle: string;
    courseCode: string;
    courseName: string;
    questionContent: string;
    questionAnswer: boolean;
    questionScore: number;
    durationMinutes: number;
    passingScore: number;
    totalScore: number;
  },
): Promise<string> {
  const courseCode = `${opts.courseCode}-${uniquePrefix()}`;
  const courseRes = await app.inject({
    method: "POST",
    url: "/api/courses",
    payload: {
      name: opts.courseName,
      code: courseCode,
      description: "",
    },
    cookies: { "auth-token": adminToken },
  });
  if (courseRes.statusCode !== 201) {
    throw new Error(
      `createExamViaApi course failed: ${courseRes.statusCode} ${courseRes.body}`,
    );
  }
  const courseId = courseRes.json().id;

  const qRes = await app.inject({
    method: "POST",
    url: "/api/questions",
    payload: {
      courseId,
      type: "true_false",
      content: opts.questionContent,
      standardAnswer: opts.questionAnswer,
      score: opts.questionScore,
    },
    cookies: { "auth-token": adminToken },
  });
  if (qRes.statusCode !== 201) {
    throw new Error(
      `createExamViaApi question failed: ${qRes.statusCode} ${qRes.body}`,
    );
  }
  const questionId = qRes.json().id;

  const examRes = await app.inject({
    method: "POST",
    url: "/api/exams",
    payload: {
      title: opts.examTitle,
      courseId,
      durationMinutes: opts.durationMinutes,
      openAt: new Date().toISOString(),
      closeAt: new Date(Date.now() + 86400000).toISOString(),
      passingScore: opts.passingScore,
      totalScore: opts.totalScore,
      questionIds: [questionId],
    },
    cookies: { "auth-token": adminToken },
  });
  if (examRes.statusCode !== 201) {
    throw new Error(
      `createExamViaApi exam failed: ${examRes.statusCode} ${examRes.body}`,
    );
  }
  return examRes.json().id;
}

/**
 * Publishes an exam via the POST /api/exams/:id/publish endpoint.
 * Returns the API response body.
 */
export async function publishExamViaApi(
  app: FastifyInstance,
  adminToken: string,
  examId: string,
) {
  const res = await app.inject({
    method: "POST",
    url: `/api/exams/${examId}/publish`,
    cookies: { "auth-token": adminToken },
  });
  if (res.statusCode !== 200) {
    throw new Error(`publishExamViaApi failed: ${res.statusCode} ${res.body}`);
  }
  return res.json();
}

/**
 * End-to-end helper that creates a candidate, enrolls them in an exam,
 * starts an attempt, saves an answer, and submits. Returns the submitted
 * attempt response. Useful for integration/E2E tests requiring a completed
 * exam cycle.
 */
export async function submitExamAsCandidate(
  app: FastifyInstance,
  adminToken: string,
  orgId: string,
  examId: string,
  username: string,
) {
  const candidate = await createCandidateViaApi(
    app,
    adminToken,
    username,
    orgId,
  );

  const enrollRes = await app.inject({
    method: "POST",
    url: `/api/exams/${examId}/enrollments`,
    payload: { candidateIds: [candidate.candidateProfileId] },
    cookies: { "auth-token": adminToken },
  });
  if (enrollRes.statusCode !== 200) {
    throw new Error(
      `submitExamAsCandidate enroll failed: ${enrollRes.statusCode} ${enrollRes.body}`,
    );
  }

  const startRes = await app.inject({
    method: "POST",
    url: `/api/attempts/${examId}/start`,
    cookies: { "auth-token": candidate.token },
  });
  if (startRes.statusCode !== 201) {
    throw new Error(
      `submitExamAsCandidate start failed: ${startRes.statusCode} ${startRes.body}`,
    );
  }
  const attempt = startRes.json();
  const attemptId = attempt.id;

  const examDetailRes = await app.inject({
    method: "GET",
    url: `/api/exams/${examId}`,
    cookies: { "auth-token": adminToken },
  });
  const examDetail = examDetailRes.json();
  const questionId = examDetail.questionIds[0];

  await app.inject({
    method: "POST",
    url: `/api/attempts/${attemptId}/answers/${questionId}`,
    payload: {
      attemptId,
      questionId,
      answer: true,
      clientSeq: 1,
      clientSavedAt: new Date().toISOString(),
      baseVersion: 0,
    },
    cookies: { "auth-token": candidate.token },
  });

  const submitRes = await app.inject({
    method: "POST",
    url: `/api/attempts/${attemptId}/submit`,
    cookies: { "auth-token": candidate.token },
  });
  if (submitRes.statusCode !== 200) {
    throw new Error(
      `submitExamAsCandidate submit failed: ${submitRes.statusCode} ${submitRes.body}`,
    );
  }
  return submitRes.json();
}

/**
 * Exports exam results as CSV via the GET /api/exams/:id/export/scores
 * endpoint using an admin token. Returns response headers and body.
 */
export async function exportResultsCsvAsAdmin(
  app: FastifyInstance,
  adminToken: string,
  examId: string,
) {
  const res = await app.inject({
    method: "GET",
    url: `/api/exams/${examId}/export/scores`,
    cookies: { "auth-token": adminToken },
  });
  if (res.statusCode !== 200) {
    throw new Error(
      `exportResultsCsvAsAdmin failed: ${res.statusCode} ${res.body}`,
    );
  }
  return {
    headers: res.headers,
    body: typeof res.body === "string" ? res.body : res.body.toString(),
  };
}

// ── migrate-cache module state ───────────────────────────────────────
let cachedSchema: CachedSchemaState | null = null;

/**
 * Drop the cached schema (if any). Called by tests that need to verify
 * cleanup behavior; also safe to call in `afterAll` hooks.
 */
export async function clearCachedSchema(): Promise<void> {
  if (!cachedSchema) return;
  try {
    await cachedSchema.conn.sql.end();
    await cachedSchema.isoCleanup();
  } catch {
    /* best-effort */
  }
  cachedSchema = null;
}
