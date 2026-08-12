import type { FastifyPluginAsync } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerGradingQueueRoutes } from "../routes/gradingQueue.js";
import {
  buildPermissionMatrixFixture,
  type MatrixRole,
  type MatrixRoute,
  type MatrixVerdict,
  type PermissionMatrixFixture,
} from "./permissionMatrix.helpers.js";

const ATTEMPT_ID = "00000000-0000-4000-8000-0000000000aa";

const routes: readonly MatrixRoute[] = [
  ["GET", "/api/admin/grading-queue"],
  ["GET", `/api/admin/attempts/${ATTEMPT_ID}/grading-details`],
  [
    "POST",
    `/api/admin/attempts/${ATTEMPT_ID}/grade-question`,
    { questionId: "q", score: 0 },
  ],
];

describe("RBAC permission matrix — grading routes", () => {
  let fixture: PermissionMatrixFixture;

  const plugin: FastifyPluginAsync = async (fastify) => {
    await fastify.register(registerGradingQueueRoutes);
  };

  beforeAll(async () => {
    fixture = await buildPermissionMatrixFixture(plugin);
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  it.each<[MatrixRole, MatrixVerdict]>([
    ["Admin", "passed"],
    ["Grader", "passed"],
    ["Proctor", "denied"],
    ["Candidate", "denied"],
    ["Teacher", "denied"],
    ["Maintainer", "denied"],
  ])(
    "%s receives the expected grading capability verdict",
    async (role, expected) => {
      for (const [method, url, payload] of routes) {
        expect(
          await fixture.verdict(role, method, url, payload),
          `${method} ${url}`,
        ).toBe(expected);
      }
    },
  );
});
