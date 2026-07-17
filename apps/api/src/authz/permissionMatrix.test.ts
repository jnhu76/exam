import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { signJWT } from "@exam/auth/src/session.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { buildTestApp } from "../routes/testHelpers.js";
import { registerGradingQueueRoutes } from "../routes/gradingQueue.js";
import { registerAdminAttemptRoutes } from "../routes/attempts.admin.js";
import proctorMonitoringRoutes from "../routes/proctorMonitoring.js";
import questionRoutes from "../routes/question.js";
import examRoutes from "../routes/exam.js";
import scoreRoutes from "../routes/scores.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

// Stable fake ids: the capability gate runs BEFORE the handler, so a denied
// role 403s regardless of whether the resource exists; a passed role reaches
// the handler (which may 404, still "passed the gate"). No seeding needed.
const FAKE_EXAM_ID = "00000000-0000-4000-8000-0000000000ee";
const FAKE_ATTEMPT_ID = "00000000-0000-4000-8000-0000000000aa";

/**
 * Permission matrix test (RBAC runtime activation, PR #3 Step 7).
 *
 * For each flipped route, asserts the capability gate's verdict across the
 * human role matrix, per the ADR Role→Permission matrix:
 *  - Admin:   passes every flipped route (compatibility superset).
 *  - Proctor: passes proctor routes, 403 on grading routes.
 *  - Grader:  passes grading routes, 403 on proctor routes.
 *  - Candidate: 403 on all flipped admin routes.
 *  - Teacher: 403 on proctor/grading routes.
 *
 * The assertion distinguishes a CAPABILITY denial (403 PERMISSION_DENIED at the
 * gate) from passing the gate (any non-403, e.g. 200/404/409 — the route then
 * applies its own logic).
 */

type Role = "Admin" | "Teacher" | "Proctor" | "Grader" | "Candidate";

async function createUserWithRole(
  db: import("@exam/db/src/types.js").Database,
  orgId: string,
  role: Role,
  username: string,
): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  await db.insert(schema.users).values({
    id,
    organizationId: orgId,
    username,
    passwordHash: await hashPassword("pw123456"),
    name: `${role} user`,
    role,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const token = signJWT(
    { actorId: id, role, organizationId: orgId },
    getRuntimeConfig().authSecret.jwtSecret,
  );
  return { id, token };
}

function isCapabilityDenied(statusCode: number, body: unknown): boolean {
  return (
    statusCode === 403 && JSON.stringify(body).includes("PERMISSION_DENIED")
  );
}

describe("RBAC Step 7 permission matrix (flipped routes)", () => {
  let t: Awaited<ReturnType<typeof buildTestApp>>;
  let tokens: Record<Role, string>;

  const combinedPlugin: FastifyPluginAsync = async (fastify) => {
    await fastify.register(registerGradingQueueRoutes);
    await fastify.register(registerAdminAttemptRoutes);
    await fastify.register(proctorMonitoringRoutes);
    await fastify.register(questionRoutes);
    await fastify.register(examRoutes);
    await fastify.register(scoreRoutes);
  };

  beforeAll(async () => {
    t = await buildTestApp(combinedPlugin, { prefix: "/api" });

    // Create users for each role + tokens.
    const entries = await Promise.all(
      (["Admin", "Teacher", "Proctor", "Grader", "Candidate"] as Role[]).map(
        async (r) => {
          const { token } = await createUserWithRole(
            t.db,
            t.org.id,
            r,
            `matrix-${r.toLowerCase()}-${randomUUID().slice(0, 6)}`,
          );
          return [r, token] as const;
        },
      ),
    );
    tokens = Object.fromEntries(entries) as Record<Role, string>;
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // Helper: inject and classify as "denied at gate" vs "passed gate".
  async function verdict(
    role: Role,
    method: string,
    url: string,
    payload?: unknown,
  ): Promise<"denied" | "passed"> {
    const res = await t.app.inject({
      method: method as "GET" | "POST",
      url,
      payload,
      cookies: { "auth-token": tokens[role] },
    });
    return isCapabilityDenied(res.statusCode, res.json()) ? "denied" : "passed";
  }

  // ── Proctor routes (built lazily so attemptId is set) ──
  function proctorRoutes(): Array<[string, string]> {
    return [
      ["GET", `/api/admin/exams/${FAKE_EXAM_ID}/proctor/attempts`],
      ["GET", `/api/admin/attempts/${FAKE_ATTEMPT_ID}/proctor-events`],
    ];
  }

  it("Admin passes proctor routes", async () => {
    for (const [m, u] of proctorRoutes()) {
      expect(await verdict("Admin", m, u), `${m} ${u}`).toBe("passed");
    }
  });
  it("Proctor passes proctor routes", async () => {
    for (const [m, u] of proctorRoutes()) {
      expect(await verdict("Proctor", m, u), `${m} ${u}`).toBe("passed");
    }
  });
  it("Grader is denied proctor routes", async () => {
    for (const [m, u] of proctorRoutes()) {
      expect(await verdict("Grader", m, u), `${m} ${u}`).toBe("denied");
    }
  });
  it("Candidate is denied proctor routes", async () => {
    for (const [m, u] of proctorRoutes()) {
      expect(await verdict("Candidate", m, u), `${m} ${u}`).toBe("denied");
    }
  });
  it("Teacher is denied proctor routes", async () => {
    for (const [m, u] of proctorRoutes()) {
      expect(await verdict("Teacher", m, u), `${m} ${u}`).toBe("denied");
    }
  });

  // ── Grading routes ──
  function gradingRoutes(): Array<[string, string, unknown?]> {
    return [
      ["GET", "/api/admin/grading-queue"],
      ["GET", `/api/admin/attempts/${FAKE_ATTEMPT_ID}/grading-details`],
      // grade-question is a write, but the capability gate runs before the
      // handler; a passed role reaches the handler (which 404s on the fake
      // attempt — still "passed the gate"). Payload is the minimal valid shape.
      [
        "POST",
        `/api/admin/attempts/${FAKE_ATTEMPT_ID}/grade-question`,
        { questionId: "q", score: 0 },
      ],
    ];
  }

  it("Admin passes grading routes", async () => {
    for (const [m, u, p] of gradingRoutes()) {
      expect(await verdict("Admin", m, u, p), `${m} ${u}`).toBe("passed");
    }
  });
  it("Grader passes grading routes", async () => {
    for (const [m, u, p] of gradingRoutes()) {
      expect(await verdict("Grader", m, u, p), `${m} ${u}`).toBe("passed");
    }
  });
  it("Proctor is denied grading routes", async () => {
    for (const [m, u, p] of gradingRoutes()) {
      expect(await verdict("Proctor", m, u, p), `${m} ${u}`).toBe("denied");
    }
  });
  it("Candidate is denied grading routes", async () => {
    for (const [m, u, p] of gradingRoutes()) {
      expect(await verdict("Candidate", m, u, p), `${m} ${u}`).toBe("denied");
    }
  });
  it("Teacher is denied grading routes", async () => {
    for (const [m, u, p] of gradingRoutes()) {
      expect(await verdict("Teacher", m, u, p), `${m} ${u}`).toBe("denied");
    }
  });

  // ── P4-2B: question CRUD capability cutover ──
  // GET routes are the authoritative capability-gate proof: they carry no
  // payload, so Zod validation cannot preempt the gate. The write routes
  // (POST/PATCH/DELETE/import) use the IDENTICAL requireCapability decorator,
  // so the GET verdict transitively proves the write gate decision per role.
  // (Write-route validation shape is owned by P2 authoring tests; the
  // Teacher-creates-text_response write proof lives in question.test.ts.)
  const FAKE_QUESTION_ID = "00000000-0000-4000-8000-0000000000bb";
  function questionReadRoutes(): Array<[string, string]> {
    return [
      ["GET", "/api/questions"],
      ["GET", `/api/questions/${FAKE_QUESTION_ID}`],
    ];
  }

  it("P4-2B Admin passes question routes", async () => {
    for (const [m, u] of questionReadRoutes()) {
      expect(await verdict("Admin", m, u), `${m} ${u}`).toBe("passed");
    }
  });
  it("P4-2B Teacher passes question routes (preset grants QuestionView)", async () => {
    for (const [m, u] of questionReadRoutes()) {
      expect(await verdict("Teacher", m, u), `${m} ${u}`).toBe("passed");
    }
  });
  it("P4-2B Candidate is denied question routes", async () => {
    for (const [m, u] of questionReadRoutes()) {
      expect(await verdict("Candidate", m, u), `${m} ${u}`).toBe("denied");
    }
  });
  it("P4-2B Grader is denied question routes", async () => {
    for (const [m, u] of questionReadRoutes()) {
      expect(await verdict("Grader", m, u), `${m} ${u}`).toBe("denied");
    }
  });
  it("P4-2B Proctor is denied question routes", async () => {
    for (const [m, u] of questionReadRoutes()) {
      expect(await verdict("Proctor", m, u), `${m} ${u}`).toBe("denied");
    }
  });
  it("P4-2B Unauthenticated is 401 on question routes", async () => {
    for (const [m, u] of questionReadRoutes()) {
      const res = await t.app.inject({ method: m as "GET", url: u });
      expect(res.statusCode, `${m} ${u}`).toBe(401);
    }
  });

  // ── P4-2C: exam authoring/lifecycle capability cutover ──
  // GET /exams + GET /exams/:id are the clean Teacher-allow proof (no payload
  // -> validation cannot preempt the gate). The lifecycle/enrollment writes
  // use the same requireCapability decorator, so the GET verdict transitively
  // proves the write gate. Admin-only routes (unpublish/extend/cancel/archive/
  // delete) STAY on requireRole(["Admin"]); Teacher must be denied there.
  const FAKE_EXAM_ID = "00000000-0000-4000-8000-0000000000ee";
  function examReadRoutes(): Array<[string, string]> {
    return [
      ["GET", "/api/exams"],
      ["GET", `/api/exams/${FAKE_EXAM_ID}`],
      // score list — Teacher preset grants ScoreAllView
      ["GET", `/api/exams/${FAKE_EXAM_ID}/scores`],
    ];
  }

  it("P4-2C Admin passes exam read routes", async () => {
    for (const [m, u] of examReadRoutes()) {
      expect(await verdict("Admin", m, u), `${m} ${u}`).toBe("passed");
    }
  });
  it("P4-2C Teacher passes exam read routes (ExamView + ScoreAllView)", async () => {
    for (const [m, u] of examReadRoutes()) {
      expect(await verdict("Teacher", m, u), `${m} ${u}`).toBe("passed");
    }
  });
  it("P4-2C Candidate is denied exam read routes", async () => {
    for (const [m, u] of examReadRoutes()) {
      expect(await verdict("Candidate", m, u), `${m} ${u}`).toBe("denied");
    }
  });
  it("P4-2C Grader is denied exam read routes", async () => {
    for (const [m, u] of examReadRoutes()) {
      expect(await verdict("Grader", m, u), `${m} ${u}`).toBe("denied");
    }
  });
  it("P4-2C Proctor is denied exam read routes", async () => {
    for (const [m, u] of examReadRoutes()) {
      expect(await verdict("Proctor", m, u), `${m} ${u}`).toBe("denied");
    }
  });
  it("P4-2C Unauthenticated is 401 on exam read routes", async () => {
    for (const [m, u] of examReadRoutes()) {
      const res = await t.app.inject({ method: m as "GET", url: u });
      expect(res.statusCode, `${m} ${u}`).toBe(401);
    }
  });

  // Admin-only exam routes MUST deny Teacher (stayed on requireRole; task 8.2
  // explicitly keeps these Admin-only). DELETE has no body, so validation
  // cannot preempt the gate — clean denial proof.
  it("P4-2C Teacher is denied Admin-only exam DELETE (Admin-only by design)", async () => {
    const res = await t.app.inject({
      method: "DELETE",
      url: `/api/exams/${FAKE_EXAM_ID}`,
      cookies: { "auth-token": tokens["Teacher"] },
    });
    expect(res.statusCode).toBe(403);
  });
});
