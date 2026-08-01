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

// Minimal valid incident payload (matches MarkProctorIncidentRequestSchema —
// no {data} envelope; Fastify schema validation runs at preValidation, before
// the scoped-capability preHandler). For capability-bearing roles (Admin/Proctor)
// the attempt resolver runs first and returns resource_not_found -> 404
// (classified "passed"); capability-less roles fail the preset check -> 403
// ("denied"). Both outcomes are correct capability verdicts.
const INCIDENT_PAYLOAD = {
  incidentType: "manual_note_added",
  examId: EXAM_ID,
  reasonCode: "attention_lost",
};

const routes: readonly MatrixRoute[] = [
  ["GET", "/api/admin/proctor/exams"],
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

  // J4-I1B (ADR-015 §13): AttemptMisconductMark is REMOVED from the Proctor
  // preset, so the legacy audit-only proctor-incident marker is Admin-only.
  // A Proctor call now fails the capability gate (403 PERMISSION_DENIED) —
  // the route itself stays scoped for Admin (missing attempt → 404 → passed).
  it("Proctor is denied the legacy proctor-incident marker after J4-I1B (grant removed)", async () => {
    const verdict = await fixture.verdict(
      "Proctor",
      "POST",
      `/api/admin/attempts/${ATTEMPT_ID}/proctor-incident`,
      INCIDENT_PAYLOAD,
    );
    expect(verdict).toBe("denied");
    const adminVerdict = await fixture.verdict(
      "Admin",
      "POST",
      `/api/admin/attempts/${ATTEMPT_ID}/proctor-incident`,
      INCIDENT_PAYLOAD,
    );
    // Admin holds the grant; the scoped resolver still runs (missing attempt →
    // 404 RESOURCE_NOT_FOUND, classified "passed" = capability gate passed).
    expect(adminVerdict).toBe("passed");
  });

  // J4-I1B (ADR-015 §13): AttemptForceSubmit is REMOVED from the Proctor
  // preset — force-submit is Admin-only while staying scoped.
  it("Proctor is denied force-submit after J4-I1B (grant removed)", async () => {
    const verdict = await fixture.verdict(
      "Proctor",
      "POST",
      `/api/admin/attempts/${ATTEMPT_ID}/force-submit`,
      {},
    );
    expect(verdict).toBe("denied");
  });

  // J4-I1B (ADR-015 §13): AttemptMisconductMark is REMOVED from the Proctor
  // preset — misconduct marking is Admin-only while staying scoped.
  it("Proctor is denied misconduct marking after J4-I1B (grant removed)", async () => {
    const verdict = await fixture.verdict(
      "Proctor",
      "POST",
      `/api/admin/attempts/${ATTEMPT_ID}/misconduct`,
      { severity: "warning", notes: "test misconduct note" },
    );
    expect(verdict).toBe("denied");
  });
});
