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
 */
export async function buildTestApp(
  routePlugin: FastifyPluginAsync,
  opts?: { prefix?: string; rateLimit?: boolean },
): Promise<TestContext> {
  const conn = await createDatabase(TEST_DB_URL);
  await migratePostgres(conn.db);
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
