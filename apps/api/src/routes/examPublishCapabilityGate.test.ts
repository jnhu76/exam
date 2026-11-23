import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  SUPPORTED_PRODUCT_CAPABILITIES,
  type ProductCapabilityId,
  type ResolvedProductConfiguration,
} from "@exam/domain";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";

/**
 * W2c.1 counterexamples (ADR-022 Phase 2 #678): the publish seam is an
 * authoritative new-commitment boundary (product-capability-composition.md
 * §7 layer 4), so POST /api/exams/:id/publish must judge the CURRENT draft
 * material against the deployment ceiling resolved by the canonical
 * composition root — including the bypass-the-frontend channel (direct API
 * call) and the republish channel (EXSEM-004 re-acceptance).
 *
 * Controlled configuration injection: same seam and same shape as
 * product/questionWriteCapabilityGuard.test.ts and question.test.ts (W2a/W2b)
 * — the ONLY test seam is the canonical composition root (ADR-022 D4), and
 * the default (`enabled === undefined`) resolves the real production Standard
 * configuration, so the deployment source of truth in production is untouched.
 */
const capabilityHarness = vi.hoisted(() => ({
  enabled: undefined as readonly string[] | undefined,
}));

vi.mock("../product/compositionRoot.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../product/compositionRoot.js")>();
  const domain =
    await vi.importActual<typeof import("@exam/domain")>("@exam/domain");
  return {
    ...actual,
    getResolvedProductConfiguration: (): ResolvedProductConfiguration => {
      const enabled = capabilityHarness.enabled;
      if (enabled === undefined) {
        return actual.getResolvedProductConfiguration();
      }
      const allowed = new Set<string>(enabled);
      return Object.freeze({
        revision: 1 as const,
        presentation: "standard",
        enabled: Object.freeze(
          domain.SUPPORTED_PRODUCT_CAPABILITIES.filter((capability) =>
            allowed.has(capability),
          ),
        ),
        allows: (capability: ProductCapabilityId): boolean =>
          allowed.has(capability),
      });
    },
  };
});

/** Standard minus exactly the listed capabilities (test-only bounded ceiling). */
function useBoundedCapabilitiesWithout(
  disabled: readonly ProductCapabilityId[],
): void {
  capabilityHarness.enabled = SUPPORTED_PRODUCT_CAPABILITIES.filter(
    (capability) => !disabled.includes(capability),
  );
}

describe("exam publish capability gate (W2c.1 #678)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Publish Gate Course",
        code: `PGC-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id as string;
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  beforeEach(() => {
    capabilityHarness.enabled = undefined;
  });

  const RICH_DOC = {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Solve: ", marks: ["bold"] },
          { type: "inlineMath", latex: "x^2-1=0" },
        ],
      },
    ],
  };

  /**
   * Authors a rich-prompt choice question through the SUPPORTED write seam
   * under the default full Standard ceiling (W2a guard passes), then a draft
   * exam with a future openAt so a legal publish stays `published`.
   */
  async function createRichDraftExam(title: string): Promise<string> {
    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: "client projection is never trusted",
        contentDocument: RICH_DOC,
        options: [
          { id: "a", content: "0" },
          { id: "b", content: "1" },
        ],
        standardAnswer: "a",
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(qRes.statusCode, qRes.body).toBe(201);
    const questionId = qRes.json().id as string;

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title,
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() + 3600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000 + 3600_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(examRes.statusCode, examRes.body).toBe(201);
    return examRes.json().id as string;
  }

  async function publish(examId: string) {
    return ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
  }

  async function examStatus(examId: string): Promise<string> {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().status as string;
  }

  it("RED: a direct publish call of a rich draft under a ceiling without content.prompt.rich is rejected fail-closed; the same draft publishes under Standard", async () => {
    const examId = await createRichDraftExam("Gate direct publish");

    // Lower the deployment ceiling AFTER the draft exists: a historical draft
    // may not become a NEW rich-prompt commitment on this deployment.
    useBoundedCapabilitiesWithout(["content.prompt.rich"]);

    const rejected = await publish(examId);
    expect(rejected.statusCode, rejected.body).toBe(400);
    expect(rejected.json().error.code).toBe("VALIDATION_ERROR");
    expect(await examStatus(examId)).toBe("draft");

    // Same route, same draft, deployment back at the full Standard ceiling:
    // the publish decision must track the composition root per call, not a
    // frozen answer — the draft publishes legally.
    capabilityHarness.enabled = undefined;
    const allowed = await publish(examId);
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(allowed.json().status).toBe("published");
  });

  it("RED: republishing after unpublish under a lowered ceiling is rejected and keeps the draft (EXSEM-004 re-acceptance)", async () => {
    const examId = await createRichDraftExam("Gate republish");

    const first = await publish(examId);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().status).toBe("published");

    const unpublishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/unpublish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(unpublishRes.statusCode, unpublishRes.body).toBe(200);
    expect(unpublishRes.json().status).toBe("draft");

    // The retained snapshot is non-authoritative residue (EXSEM-004): the
    // republish must re-judge CURRENT material against the CURRENT ceiling.
    useBoundedCapabilitiesWithout(["content.prompt.rich"]);

    const rejected = await publish(examId);
    expect(rejected.statusCode, rejected.body).toBe(400);
    expect(rejected.json().error.code).toBe("VALIDATION_ERROR");
    expect(await examStatus(examId)).toBe("draft");
  });
});
