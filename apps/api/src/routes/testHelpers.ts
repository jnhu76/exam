import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import authPlugin from "../plugins/auth.js";
import tenantPlugin from "../plugins/tenant.js";
import rateLimitPlugin from "../plugins/rateLimit.js";
import { setupErrorHandler } from "../plugins/errors.js";
import setupSecurity from "../plugins/security.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { createSqliteDatabase } from "@exam/db/src/sqlite.js";
import { migrateSqlite } from "@exam/db/src/sqlite.js";
import { sqliteSchema } from "@exam/db/src/schema/sqlite.js";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import type { SqliteDatabase } from "@exam/db/src/sqlite.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";

function createDbPlugin(db: SqliteDatabase) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

export interface TestContext {
  app: ReturnType<typeof Fastify>;
  db: SqliteDatabase;
  org: typeof sqliteSchema.organizations.$inferSelect;
  admin: typeof sqliteSchema.users.$inferSelect;
  teacher: typeof sqliteSchema.users.$inferSelect;
  candidate: typeof sqliteSchema.users.$inferSelect;
  adminToken: string;
  teacherToken: string;
  candidateToken: string;
}

export async function buildTestApp(
  routePlugin: FastifyPluginAsync,
  opts?: { prefix?: string },
): Promise<TestContext> {
  const { db } = createSqliteDatabase(":memory:");
  migrateSqlite(db);
  await seed(db, hashPassword);

  const app = Fastify();
  setupSecurity(app);
  setupErrorHandler(app);
  await app.register(fastifyCookie);
  await app.register(createDbPlugin(db));
  await app.register(authPlugin);
  await app.register(tenantPlugin);
  await app.register(rateLimitPlugin);
  await app.register(routePlugin, { prefix: opts?.prefix ?? "/api" });
  await app.ready();

  const org = db.select().from(sqliteSchema.organizations).get()!;
  const users = db.select().from(sqliteSchema.users).all();
  const admin = users.find((u) => u.role === "SuperAdmin")!;
  const teacher = users.find((u) => u.role === "Teacher")!;
  const candidate = users.find((u) => u.role === "Candidate")!;

  const adminToken = signJWT({
    actorId: admin.id,
    role: admin.role,
    organizationId: admin.organizationId,
  });
  const teacherToken = signJWT({
    actorId: teacher.id,
    role: teacher.role,
    organizationId: teacher.organizationId,
  });
  const candidateToken = signJWT({
    actorId: candidate.id,
    role: candidate.role,
    organizationId: candidate.organizationId,
  });

  return {
    app,
    db,
    org,
    admin,
    teacher,
    candidate,
    adminToken,
    teacherToken,
    candidateToken,
  };
}

export async function createCandidateViaApi(
  app: TestContext["app"],
  adminToken: string,
  username: string,
  orgId: string,
) {
  const res = await app.inject({
    method: "POST",
    url: "/api/candidates",
    payload: {
      username,
      password: "password123",
      name: `Candidate ${username}`,
      fields: {},
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
  const token = signJWT({
    actorId: body.userId,
    role: "Candidate",
    organizationId: orgId,
  });
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
  const courseRes = await app.inject({
    method: "POST",
    url: "/api/courses",
    payload: {
      name: opts.courseName,
      code: opts.courseCode,
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
