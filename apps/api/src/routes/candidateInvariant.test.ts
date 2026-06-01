import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./testHelpers.js";
import authRoutes from "./auth.js";
import candidateRoutes from "./candidate.js";
import attemptRoutes from "./attempts.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { signJWT } from "@exam/auth/src/session.js";

async function createCandidateViaApi(
  app: Awaited<ReturnType<typeof buildTestApp>>["app"],
  adminToken: string,
  username: string,
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
  expect(res.statusCode).toBe(201);
  return res.json() as {
    id: string;
    userId: string;
    fields: Record<string, unknown>;
  };
}

describe("candidate profile invariant", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(candidateRoutes);
      await fastify.register(attemptRoutes);
    });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("POST /api/candidates creates both user and candidateProfile", async () => {
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      "invariant-test-1",
    );

    expect(candidate.id).toBeDefined();
    expect(candidate.userId).toBeDefined();

    const userRepo = createUserRepo(ctx.db);
    const user = userRepo.findById(
      {
        actorId: ctx.admin.id,
        organizationId: ctx.org.id,
        targetOrganizationId: ctx.org.id,
        role: "SuperAdmin",
        permissions: [],
        sessionId: "test",
      },
      candidate.userId,
    );
    expect(user).toBeDefined();
    expect(user!.role).toBe("Candidate");

    const candidateRepo = createCandidateRepo(ctx.db);
    const profile = candidateRepo.findById(
      {
        actorId: ctx.admin.id,
        organizationId: ctx.org.id,
        targetOrganizationId: ctx.org.id,
        role: "SuperAdmin",
        permissions: [],
        sessionId: "test",
      },
      candidate.id,
    );
    expect(profile).toBeDefined();
    expect(profile!.userId).toBe(candidate.userId);
  });

  it("Candidate with profile can get candidate exams", async () => {
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      "invariant-test-2",
    );
    const token = signJWT({
      actorId: candidate.userId,
      role: "Candidate",
      organizationId: ctx.org.id,
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate/exams",
      cookies: { "auth-token": token },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("Seed candidate without profile gets empty exam list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate/exams",
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
