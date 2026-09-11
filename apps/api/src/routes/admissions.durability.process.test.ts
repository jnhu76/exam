/**
 * #292 — durability evidence at REAL process boundaries (#326 harness).
 *
 * These scenarios are the post-fix inversion of the pre-implementation
 * defect proof (legacy `examQueues` Map): the same experiments that
 * demonstrated membership loss, admission-truth flipping, and multi-process
 * over-admission on the legacy gate now demonstrate DURABLE convergence.
 *
 * Evidence contract: every server here is the REAL API entry
 * (`node --import tsx src/server.ts`) as an OS child process; divergence is
 * impossible through shared JS state because the processes share nothing but
 * PostgreSQL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { createDatabase } from "@exam/db/src/database.js";
import { seed } from "@exam/db/src/seed.js";
import type { Database } from "@exam/db/src/types.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { setupApiTestDatabaseFromEnv } from "./testDatabase.js";
import {
  grabFreePort,
  killHard,
  spawnApiServer,
  isProcessAlive,
  type SpawnedApiServer,
} from "../runtime/restartProcessHarness.js";

const QUEUE_FLAGS = { requireQueue: true, batchSize: 1, batchInterval: 3600 };

type Json = Record<string, unknown>;

async function call(
  baseUrl: string,
  method: "GET" | "POST",
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Cookie = `auth-token=${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(15_000),
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(`${baseUrl}${path}`, init);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function asRecord(json: unknown): Json {
  if (json !== null && typeof json === "object") return json as Json;
  throw new Error(`expected JSON object: ${JSON.stringify(json)}`);
}

interface CandidateFixture {
  userId: string;
  profileId: string;
  token: string;
}

async function createCandidateFixture(
  db: Database,
  orgId: string,
  username: string,
): Promise<CandidateFixture> {
  const now = new Date();
  const userId = crypto.randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    organizationId: orgId,
    username,
    passwordHash: await hashPassword("password123"),
    name: `Admission Durability ${username}`,
    role: "Candidate",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.userRoleAssignments).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    userId,
    role: "Candidate",
    isPrimary: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const profileId = crypto.randomUUID();
  await db.insert(schema.candidateProfiles).values({
    id: profileId,
    organizationId: orgId,
    userId,
    fields: {},
    createdAt: now,
    updatedAt: now,
  });
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return {
    userId,
    profileId,
    token: signJWT(
      {
        actorId: userId,
        role: rows[0]!.role as never,
        organizationId: orgId,
        authEpoch: rows[0]!.authEpoch,
      },
      getRuntimeConfig().authSecret.jwtSecret,
    ),
  };
}

type Caller = (
  method: "GET" | "POST",
  path: string,
  opts?: { token?: string; body?: unknown },
) => Promise<{ status: number; json: unknown }>;

/** Creates course + question + requireQueue exam (published) + enrollments via API. */
async function createQueueExam(
  request: Caller,
  adminToken: string,
  title: string,
  profileIds: string[],
): Promise<string> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const course = await request("POST", "/api/courses", {
    token: adminToken,
    body: {
      name: `Dur course ${suffix}`,
      code: `DC-${suffix}`,
      description: "",
    },
  });
  if (course.status !== 201)
    throw new Error(`course: ${JSON.stringify(course.json)}`);
  const courseId = asRecord(course.json).id as string;

  const question = await request("POST", "/api/questions", {
    token: adminToken,
    body: {
      courseId,
      type: "true_false",
      content: `Dur question ${suffix}: 2+2=4`,
      standardAnswer: true,
      score: 100,
    },
  });
  if (question.status !== 201)
    throw new Error(`question: ${JSON.stringify(question.json)}`);

  const nowMs = Date.now();
  const exam = await request("POST", "/api/exams", {
    token: adminToken,
    body: {
      title,
      courseId,
      durationMinutes: 60,
      openAt: new Date(nowMs - 5_000).toISOString(),
      closeAt: new Date(nowMs + 3_600_000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionIds: [asRecord(question.json).id as string],
      controlFlags: { ...QUEUE_FLAGS },
    },
  });
  if (exam.status !== 201)
    throw new Error(`exam: ${JSON.stringify(exam.json)}`);
  const examId = asRecord(exam.json).id as string;

  const published = await request("POST", `/api/exams/${examId}/publish`, {
    token: adminToken,
  });
  if (published.status !== 200)
    throw new Error(`publish: ${JSON.stringify(published.json)}`);

  const enrolled = await request("POST", `/api/exams/${examId}/enrollments`, {
    token: adminToken,
    body: { candidateIds: profileIds },
  });
  if (enrolled.status !== 200)
    throw new Error(`enroll: ${JSON.stringify(enrolled.json)}`);
  return examId;
}

describe("durable admission across real process boundaries (#292 Q7/Q8)", () => {
  let cleanup: Awaited<ReturnType<typeof setupApiTestDatabaseFromEnv>> | null =
    null;
  let db: Database;
  let connInfo: Awaited<ReturnType<typeof createDatabase>>;
  let workerUrl = "";
  let adminToken = "";
  let examId = "";
  let c1: CandidateFixture;
  let c2: CandidateFixture;
  const live: SpawnedApiServer[] = [];

  beforeAll(async () => {
    cleanup = await setupApiTestDatabaseFromEnv({ namespace: "admission-dur" });
    workerUrl = cleanup.databaseUrl;
    connInfo = await createDatabase(workerUrl);
    db = connInfo.db;
    const seedResult = await seed(db, hashPassword);
    const orgId = seedResult.orgId;
    const admins = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, seedResult.users.adminId));
    adminToken = signJWT(
      {
        actorId: admins[0]!.id,
        role: admins[0]!.role as never,
        organizationId: orgId,
        authEpoch: admins[0]!.authEpoch,
      },
      getRuntimeConfig().authSecret.jwtSecret,
    );
    c1 = await createCandidateFixture(db, orgId, `adp1-${Date.now()}`);
    c2 = await createCandidateFixture(db, orgId, `adp2-${Date.now()}`);

    const bootstrap = await spawnApiServer({
      port: await grabFreePort(),
      databaseUrl: workerUrl,
    });
    try {
      const bootstrapCaller: Caller = (method, path, opts = {}) =>
        call(bootstrap.baseUrl, method, path, opts);
      examId = await createQueueExam(
        bootstrapCaller,
        adminToken,
        "Durability Exam",
        [c1.profileId, c2.profileId],
      );
    } finally {
      await killHard(bootstrap);
    }
  }, 120_000);

  afterAll(async () => {
    for (const server of live) {
      try {
        if (isProcessAlive(server.pid)) await killHard(server);
      } catch {
        /* gone */
      }
    }
    try {
      await connInfo?.sql.end();
    } catch {
      /* closed */
    }
    await cleanup?.close();
  }, 30_000);

  async function boot(): Promise<SpawnedApiServer> {
    const server = await spawnApiServer({
      port: await grabFreePort(),
      databaseUrl: workerUrl,
    });
    live.push(server);
    return server;
  }

  const queueAt = (base: string, token: string) =>
    call(base, "POST", `/api/attempts/${examId}/queue`, { token });
  const startAt = (base: string, token: string) =>
    call(base, "POST", `/api/attempts/${examId}/start`, { token });

  it(
    "D1/Q7: SIGKILL restart preserves membership and admission truth (legacy defect inverted)",
    { timeout: 240_000 },
    async () => {
      const s1 = await boot();
      const q1 = await queueAt(s1.baseUrl, c1.token);
      const q2 = await queueAt(s1.baseUrl, c2.token);
      expect(asRecord(q1.json)).toMatchObject({ status: "ready", position: 1 });
      expect(asRecord(q2.json)).toMatchObject({
        status: "waiting",
        position: 2,
      });

      await killHard(s1);

      const s2 = await boot();
      // c2 polls first — the durable truth must NOT reorder around it.
      const q2b = await queueAt(s2.baseUrl, c2.token);
      const q1b = await queueAt(s2.baseUrl, c1.token);
      expect(asRecord(q2b.json)).toMatchObject({
        status: "waiting",
        position: 2,
      });
      expect(asRecord(q1b.json)).toMatchObject({
        status: "ready",
        position: 1,
      });

      // And the refusal still binds after restart (Q2 across process death).
      const denied = await startAt(s2.baseUrl, c2.token);
      expect(denied.status).toBe(409);
    },
  );

  it(
    "D2/Q8: two processes observe the same truth and the batch cap holds globally",
    { timeout: 240_000 },
    async () => {
      const sa = await boot();
      const sb = await boot();

      const qa1 = await queueAt(sa.baseUrl, c1.token);
      const qb2 = await queueAt(sb.baseUrl, c2.token);
      expect(asRecord(qa1.json)).toMatchObject({
        status: "ready",
        position: 1,
      });
      // LEGACY DEFECT was here: process B reported its own candidate ready.
      expect(asRecord(qb2.json)).toMatchObject({
        status: "waiting",
        position: 2,
      });

      // The cap binds through either process.
      const denied = await startAt(sb.baseUrl, c2.token);
      expect(denied.status).toBe(409);

      // Head consumes; the NEXT batch slot becomes eligible through the
      // OTHER process — progression without over-admission.
      const admitted = await startAt(sa.baseUrl, c1.token);
      expect(admitted.status).toBe(201);
      const progressed = await queueAt(sb.baseUrl, c2.token);
      expect(asRecord(progressed.json)).toMatchObject({
        status: "ready",
        position: 1,
      });
      const started = await startAt(sb.baseUrl, c2.token);
      expect(started.status).toBe(201);

      const rows = await db
        .select()
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.examId, examId));
      expect(rows).toHaveLength(2);
    },
  );

  it(
    "D3: in-progress attempt survives restart and resumes WITHOUT admission",
    { timeout: 240_000 },
    async () => {
      const s1 = await boot();
      // c1 may already hold an in-progress attempt from an earlier scenario —
      // the invariant under test is the RESUME id, not the first-start code.
      const started = await startAt(s1.baseUrl, c1.token);
      expect([200, 201]).toContain(started.status);
      const attemptId = asRecord(started.json).id as string;

      await killHard(s1);
      const s2 = await boot();

      const resumed = await startAt(s2.baseUrl, c1.token);
      expect(resumed.status).toBe(200);
      expect(asRecord(resumed.json).id).toBe(attemptId);
    },
  );
});
