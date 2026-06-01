import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import authPlugin from "../plugins/auth.js";
import tenantPlugin from "../plugins/tenant.js";
import rateLimitPlugin from "../plugins/rateLimit.js";
import { setupErrorHandler } from "../plugins/errors.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { createSqliteDatabase } from "@exam/db/src/sqlite.js";
import { migrateSqlite } from "@exam/db/src/sqlite.js";
import { sqliteSchema } from "@exam/db/src/schema/sqlite.js";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import type { SqliteDatabase } from "@exam/db/src/sqlite.js";

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
