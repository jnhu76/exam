import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import authPlugin from "../plugins/auth.js";
import tenantPlugin from "../plugins/tenant.js";
import rateLimitPlugin from "../plugins/rateLimit.js";
import nowPlugin from "../plugins/now.js";
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

let _counter = 0;
export function uniquePrefix(): string {
  _counter++;
  return `${Date.now().toString(36)}-${_counter}`;
}

function createDbPlugin(db: Database) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

export interface TestContext {
  app: ReturnType<typeof Fastify>;
  db: Database;
  cleanup: () => Promise<void>;
  org: {
    id: string;
    name: string;
    displayName: string;
    slug: string;
    createdAt: Date;
    updatedAt: Date;
  };
  admin: {
    id: string;
    organizationId: string;
    username: string;
    passwordHash: string;
    name: string;
    role: Role;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  teacher: {
    id: string;
    organizationId: string;
    username: string;
    passwordHash: string;
    name: string;
    role: Role;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  candidate: {
    id: string;
    organizationId: string;
    username: string;
    passwordHash: string;
    name: string;
    role: Role;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  superAdmin: {
    id: string;
    organizationId: string;
    username: string;
    passwordHash: string;
    name: string;
    role: Role;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  adminToken: string;
  teacherToken: string;
  candidateToken: string;
  superAdminToken: string;
  setNow: (now: Date | null) => void;
}

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://exam:exam@localhost:5432/exam_test";

export async function buildTestApp(
  routePlugin: FastifyPluginAsync,
  opts?: { prefix?: string },
): Promise<TestContext> {
  const conn = await createDatabase(TEST_DB_URL);
  await migratePostgres(conn.db);
  const db = conn.db;

  const seedResult = await seed(db, hashPassword);

  const app = Fastify();
  setupSecurity(app);
  setupErrorHandler(app);
  await app.register(fastifyCookie);
  await app.register(createDbPlugin(db));
  await app.register(nowPlugin);
  await app.register(authPlugin);
  await app.register(tenantPlugin);
  await app.register(rateLimitPlugin);
  await app.register(routePlugin, { prefix: opts?.prefix ?? "/api" });
  await app.ready();

  const orgRows = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, seedResult.orgId));
  const org = orgRows[0]!;

  const superAdminRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, seedResult.users.superAdminId));
  const superAdmin = superAdminRows[0]!;

  const adminRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, seedResult.users.adminId));
  const admin = adminRows[0]!;

  const teacherRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, seedResult.users.teacherId));
  const teacher = teacherRows[0]!;

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
  const teacherToken = signJWT(
    {
      actorId: teacher.id,
      role: teacher.role as Role,
      organizationId: teacher.organizationId,
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

  const superAdminToken = signJWT(
    {
      actorId: superAdmin.id,
      role: superAdmin.role as Role,
      organizationId: superAdmin.organizationId,
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
    admin: admin as TestContext["admin"],
    teacher: teacher as TestContext["teacher"],
    candidate: candidate as TestContext["candidate"],
    superAdmin: superAdmin as TestContext["superAdmin"],
    adminToken,
    teacherToken,
    candidateToken,
    superAdminToken,
    setNow: (now: Date | null) => {
      app.setNowOverride(now ? () => now : null);
    },
  };
}

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
