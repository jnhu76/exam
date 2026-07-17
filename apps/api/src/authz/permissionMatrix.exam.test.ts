import type { FastifyPluginAsync } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import examRoutes from "../routes/exam.js";
import scoreRoutes from "../routes/scores.js";
import {
  buildPermissionMatrixFixture,
  type MatrixRole,
  type MatrixRoute,
  type MatrixVerdict,
  type PermissionMatrixFixture,
} from "./permissionMatrix.helpers.js";

const EXAM_ID = "00000000-0000-4000-8000-0000000000ee";

const routes: readonly MatrixRoute[] = [
  ["GET", "/api/exams"],
  ["GET", `/api/exams/${EXAM_ID}`],
  ["GET", `/api/exams/${EXAM_ID}/scores`],
];

describe("RBAC permission matrix — exam routes", () => {
  let fixture: PermissionMatrixFixture;

  const plugin: FastifyPluginAsync = async (fastify) => {
    await fastify.register(examRoutes);
    await fastify.register(scoreRoutes);
  };

  beforeAll(async () => {
    fixture = await buildPermissionMatrixFixture(plugin);
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  it.each<[MatrixRole, MatrixVerdict]>([
    ["Admin", "passed"],
    ["Teacher", "passed"],
    ["Candidate", "denied"],
    ["Grader", "denied"],
    ["Proctor", "denied"],
  ])(
    "%s receives the expected exam capability verdict",
    async (role, expected) => {
      for (const [method, url, payload] of routes) {
        expect(
          await fixture.verdict(role, method, url, payload),
          `${method} ${url}`,
        ).toBe(expected);
      }
    },
  );

  it("rejects unauthenticated exam requests", async () => {
    for (const [method, url] of routes) {
      const response = await fixture.app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it.each<MatrixRole>(["Teacher", "Proctor", "Grader", "Candidate"])(
    "keeps exam deletion unavailable to %s",
    async (role) => {
      const response = await fixture.app.inject({
        method: "DELETE",
        url: `/api/exams/${EXAM_ID}`,
        cookies: { "auth-token": fixture.tokens[role] },
      });
      expect(response.statusCode).toBe(403);
    },
  );

  it("allows Admin through the exam deletion role gate", async () => {
    const response = await fixture.app.inject({
      method: "DELETE",
      url: `/api/exams/${EXAM_ID}`,
      cookies: { "auth-token": fixture.tokens.Admin },
    });
    expect(response.statusCode).not.toBe(401);
    expect(response.statusCode).not.toBe(403);
  });
});
