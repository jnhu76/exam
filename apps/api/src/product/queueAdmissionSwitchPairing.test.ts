import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/schema/pg";
import {
  MINIMAL_PRODUCT_CONFIGURATION,
  SUPPORTED_PRODUCT_CAPABILITIES,
  resolveDeploymentProductConfiguration,
  type ResolvedProductConfiguration,
} from "@exam/domain";
import type { Database } from "@exam/db/types";
import { hashPassword } from "@exam/auth/password";
import { signJWT } from "@exam/auth/session";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { auditDeploymentSwitch } from "./deploymentSwitchPreflight.js";
import {
  buildTestApp,
  uniquePrefix,
  type TestContext,
} from "../routes/testHelpers.js";
import courseRoutes from "../routes/course.js";
import questionRoutes from "../routes/question.js";
import examRoutes from "../routes/exam.js";
import attemptRoutes from "../routes/attempts.js";

/**
 * #678 review pairing counterexample (ADR-022 Phase 3): ONE queue-required
 * exam published under full Standard, then the deployment ceiling switching
 * to the Minimal preset's admission set MID-LIFECYCLE.
 *
 * The pair this file owns (the reject arm — a NEW queue-required draft
 * publish is rejected fail-closed with no snapshot — lives in
 * routes/examPublishCapabilityGate.test.ts):
 *
 *   the switch check runs BEFORE the Minimal ceiling takes effect
 *   (deploymentSwitchPreflight: the frozen per-exam requireQueue policy is
 *   an ACCEPTED execution obligation whose fulfillment path is kernel, so
 *   the switch is allowed), and AFTER it takes effect the published queue
 *   exam keeps running the candidate chain: 放行 (join → batch release →
 *   ready) → 领卷 (start leases the paper) → 呈现/保存 — while the ceiling
 *   no longer admits NEW admission.queue commitments.
 *
 * Level justification (AGENTS §7 / testing.md §4.0): a browser session
 * cannot witness a deployment ceiling switch (the static bootstrap
 * configuration changes only across server boots), so the switch semantics
 * live at the API+PostgreSQL level through the canonical composition-root
 * seam (identical to capabilitySwitchPairing.test.ts).
 */

/** Same controlled seam as capabilitySwitchPairing.test.ts (W3.3). */
const capabilityHarness = vi.hoisted(() => ({
  enabled: undefined as readonly string[] | undefined,
}));

vi.mock("./compositionRoot.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./compositionRoot.js")>();
  const domain =
    await vi.importActual<typeof import("@exam/domain")>("@exam/domain");
  return {
    ...actual,
    getResolvedProductConfiguration: (): ResolvedProductConfiguration => {
      // ENVIRONMENT-INDEPENDENT: undefined resolves the real production
      // configuration (full Standard here); the explicit list is the Minimal
      // preset's enabled set through the ONE domain resolver — the suite
      // controls its own phases instead of following ambient PRODUCT_PRESET.
      const enabled = capabilityHarness.enabled;
      const source = {
        ...domain.STANDARD_PRODUCT_CONFIGURATION,
        enabled:
          enabled === undefined
            ? domain.SUPPORTED_PRODUCT_CAPABILITIES
            : domain.SUPPORTED_PRODUCT_CAPABILITIES.filter((capability) =>
                (enabled as readonly string[]).includes(capability),
              ),
      };
      return domain.resolveDeploymentProductConfiguration(source);
    },
  };
});

/** The Minimal preset's enabled set, resolved through the domain resolver. */
function minimalCeiling(): ResolvedProductConfiguration {
  return resolveDeploymentProductConfiguration(MINIMAL_PRODUCT_CONFIGURATION);
}

describe("queue-required exam under a Standard→Minimal ceiling switch (#678 review)", () => {
  let ctx: TestContext;
  let courseId: string;
  let examId: string;
  let questionId: string;
  let candidateToken: string;

  function adminCookies() {
    return { cookies: { "auth-token": ctx.adminToken } };
  }

  function candidateCookies() {
    return { cookies: { "auth-token": candidateToken } };
  }

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Queue Pairing Course",
        code: `QPAIR-${uniquePrefix()}`,
        description: "",
      },
      ...adminCookies(),
    });
    expect(courseRes.statusCode, courseRes.body).toBe(201);
    courseId = courseRes.json().id as string;

    // One enrolled candidate, inserted through the same DB shape the
    // Rich-pairing suite uses (no auth-surface detour for fixture setup).
    const userId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const now = new Date();
    await ctx.db.insert(schema.users).values({
      id: userId,
      organizationId: ctx.org.id,
      username: `qpair-c1-${uniquePrefix()}`,
      passwordHash: await hashPassword("password123"),
      name: "Queue Pairing Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: crypto.randomUUID(),
      organizationId: ctx.org.id,
      userId,
      role: "Candidate",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.candidateProfiles).values({
      id: profileId,
      organizationId: ctx.org.id,
      userId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    const rows = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    candidateToken = signJWT(
      {
        actorId: userId,
        role: rows[0]!.role as never,
        organizationId: ctx.org.id,
        authEpoch: rows[0]!.authEpoch,
      },
      getRuntimeConfig().authSecret.jwtSecret,
    );

    // ── Phase A under FULL Standard: a queue-required objective exam is
    // authored, published and opened (the only lifecycle point where the
    // queue commitment is legal — the G3 freeze gate judges it then).
    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "排队考试的判断题",
        standardAnswer: true,
        score: 100,
      },
      ...adminCookies(),
    });
    expect(qRes.statusCode, qRes.body).toBe(201);
    questionId = qRes.json().id as string;

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: `QPAIR-queue-legacy-${uniquePrefix()}`,
        description: "",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3_600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
        controlFlags: { requireQueue: true },
      },
      ...adminCookies(),
    });
    expect(examRes.statusCode, examRes.body).toBe(201);
    examId = examRes.json().id as string;

    const publish = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      ...adminCookies(),
    });
    expect(publish.statusCode, publish.body).toBe(200);

    await ctx.db
      .update(schema.exams)
      .set({ status: "open", updatedAt: new Date() })
      .where(eq(schema.exams.id, examId));
    const enroll = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [profileId] },
      ...adminCookies(),
    });
    expect(enroll.statusCode, enroll.body).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  it("the switch is allowed (queue fulfillment is kernel), then the published queue exam still admits and leases under Minimal", async () => {
    // ── The switch check runs BEFORE the Minimal ceiling takes effect: the
    // frozen per-exam queue policy is an accepted obligation whose
    // fulfillment path is kernel (candidate-self-service queue reconcile),
    // so the Minimal switch is allowed.
    const preflight = await auditDeploymentSwitch(
      ctx.db as Database,
      minimalCeiling(),
    );
    expect(preflight.allowed).toBe(true);
    expect(preflight.violations).toEqual([]);

    // ── The ceiling takes effect: the Minimal preset's admission set.
    capabilityHarness.enabled = MINIMAL_PRODUCT_CONFIGURATION.enabled;

    // ── 放行: the candidate joins the queue and the first batch releases
    // at the anchor instant (batchSize ≥ 1), so they are ready under the
    // queue path the Standard publish froze.
    const join = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/queue`,
      ...candidateCookies(),
    });
    expect(join.statusCode, join.body).toBe(200);
    expect(join.json().status).toBe("ready");

    // ── 领卷: start leases the paper through the queue admission gate.
    const start = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      ...candidateCookies(),
    });
    expect(start.statusCode, start.body).toBe(201);
    const attemptId = start.json().id as string;

    // ── 呈现/保存: the frozen snapshot serves the question and the answer
    // saves on the same kernel save path.
    const take = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${attemptId}/take`,
      ...candidateCookies(),
    });
    expect(take.statusCode, take.body).toBe(200);
    const served = (
      take.json().questions as Array<{ id: string; prompt: unknown }>
    ).find((q) => q.id === questionId);
    expect(served?.prompt).toBe("排队考试的判断题");

    const save = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      ...candidateCookies(),
    });
    expect(save.statusCode, save.body).toBe(200);
  });
});
