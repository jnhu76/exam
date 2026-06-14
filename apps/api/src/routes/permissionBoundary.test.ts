import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createCandidateViaApi,
  uniquePrefix,
} from "./testHelpers.js";
import authRoutes from "./auth.js";
import candidateRoutes from "./candidate.js";
import attemptRoutes from "./attempts.js";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import userRoutes from "./user.js";
import scoreRoutes from "./scores.js";
import { exportRoutes } from "./export.js";

describe("permission boundary", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(candidateRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(examRoutes);
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(userRoutes);
      await fastify.register(scoreRoutes);
      await fastify.register(exportRoutes);
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe("unauthenticated gets 401 on all protected endpoints", () => {
    it("GET /api/exams returns 401", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/exams",
      });
      expect(res.statusCode).toBe(401);
    });

    it("POST /api/candidates returns 401", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/candidates",
        payload: {
          username: "should-not-create",
          password: "password123",
          name: "Should Not Create",
          fields: {},
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("GET /api/exams/:id/export/scores returns 401", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/export/scores",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("candidate cannot access admin APIs", () => {
    let candidateToken: string;

    beforeAll(async () => {
      const candidate = await createCandidateViaApi(
        ctx.app,
        ctx.adminToken,
        `boundary-cand-01-${uniquePrefix()}`,
        ctx.org.id,
      );
      candidateToken = candidate.token;
    });

    it("GET /api/exams returns 403", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/exams",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("POST /api/candidates returns 403", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/candidates",
        payload: {
          username: "should-not-create-bnd",
          password: "password123",
          name: "Should Not Create",
          fields: {},
        },
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("GET /api/exams/:id/export/scores returns 403", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/exams/00000000-0000-0000-0000-000000000000/export/scores",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("DELETE /api/courses/:id returns 403", async () => {
      const res = await ctx.app.inject({
        method: "DELETE",
        url: "/api/courses/00000000-0000-0000-0000-000000000000",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("GET /api/users returns 403", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/users",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("admin can access all management APIs", () => {
    it("GET /api/exams returns 200", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/exams",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("GET /api/candidates returns 200", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/candidates",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("GET /api/users returns 200", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/users",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
