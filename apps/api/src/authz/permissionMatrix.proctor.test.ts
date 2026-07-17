import type { FastifyPluginAsync } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerAdminAttemptRoutes } from "../routes/attempts.admin.js";
import proctorMonitoringRoutes from "../routes/proctorMonitoring.js";
import {
  buildPermissionMatrixFixture,
  type MatrixRole,
  type MatrixRoute,
  type MatrixVerdict,
  type PermissionMatrixFixture,
} from "./permissionMatrix.helpers.js";

const EXAM_ID = "00000000-0000-4000-8000-0000000000ee";
const ATTEMPT_ID = "00000000-0000-4000-8000-0000000000aa";

const routes: readonly MatrixRoute[] = [
  ["GET", `/api/admin/exams/${EXAM_ID}/proctor/attempts`],
  ["GET", `/api/admin/attempts/${ATTEMPT_ID}/proctor-events`],
];

describe("RBAC permission matrix — proctor routes", () => {
  let fixture: PermissionMatrixFixture;

  const plugin: FastifyPluginAsync = async (fastify) => {
    await fastify.register(registerAdminAttemptRoutes);
    await fastify.register(proctorMonitoringRoutes);
  };

  beforeAll(async () => {
    fixture = await buildPermissionMatrixFixture(plugin);
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  it.each<[MatrixRole, MatrixVerdict]>([
    ["Admin", "passed"],
    ["Proctor", "passed"],
    ["Grader", "denied"],
    ["Candidate", "denied"],
    ["Teacher", "denied"],
  ])(
    "%s receives the expected proctor capability verdict",
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
