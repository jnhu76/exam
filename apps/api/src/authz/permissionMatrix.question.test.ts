import type { FastifyPluginAsync } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import questionRoutes from "../routes/question.js";
import {
  buildPermissionMatrixFixture,
  type MatrixRole,
  type MatrixRoute,
  type MatrixVerdict,
  type PermissionMatrixFixture,
} from "./permissionMatrix.helpers.js";

const QUESTION_ID = "00000000-0000-4000-8000-0000000000bb";

const routes: readonly MatrixRoute[] = [
  ["GET", "/api/questions"],
  ["GET", `/api/questions/${QUESTION_ID}`],
];

describe("RBAC permission matrix — question routes", () => {
  let fixture: PermissionMatrixFixture;

  const plugin: FastifyPluginAsync = async (fastify) => {
    await fastify.register(questionRoutes);
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
    "%s receives the expected question capability verdict",
    async (role, expected) => {
      for (const [method, url, payload] of routes) {
        expect(
          await fixture.verdict(role, method, url, payload),
          `${method} ${url}`,
        ).toBe(expected);
      }
    },
  );

  it("rejects unauthenticated question requests", async () => {
    for (const [method, url] of routes) {
      const response = await fixture.app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
