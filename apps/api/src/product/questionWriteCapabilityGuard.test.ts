import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import {
  SUPPORTED_PRODUCT_CAPABILITIES,
  type ProductCapabilityId,
  type ResolvedProductConfiguration,
} from "@exam/domain";
import questionRoutes from "../routes/question.js";
import courseRoutes from "../routes/course.js";
import { buildTestApp, uniquePrefix } from "../routes/testHelpers.js";

/**
 * ADR-022 Phase 2 — question write capability guard.
 *
 * :254 "disabled capability rejected at authoritative new-write boundaries";
 * :255 "manual demand and Rich use derived from actual frozen materials, not
 * profile name". The authoritative write seam is the question create/update
 * handler: the guard must derive the required capabilities from the FINAL
 * material (type, prompt document, option documents, answer mode) and reject
 * the write when any of them exceeds the deployment ceiling — before the
 * repository write, so a rejected command leaves no new content.
 *
 * Controlled configuration injection: the ONLY seam is the canonical
 * composition root. These tests vi.mock `getResolvedProductConfiguration` so
 * a bounded (partial-Standard) resolved configuration is observable at the
 * write boundary. There is deliberately no production setter: Phase 4
 * introduces persisted configuration, and any earlier runtime write path
 * would bypass the composition root (product-capability-composition.md §6).
 * If the guard does not consult this seam per write, the disabled cases
 * below see the full Standard ceiling and fail.
 */

const guardHarness = vi.hoisted(() => ({
  enabled: undefined as readonly string[] | undefined,
}));

vi.mock("./compositionRoot.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./compositionRoot.js")>();
  const domain =
    await vi.importActual<typeof import("@exam/domain")>("@exam/domain");
  return {
    ...actual,
    getResolvedProductConfiguration: (): ResolvedProductConfiguration => {
      const enabled = guardHarness.enabled;
      if (enabled === undefined) {
        return actual.getResolvedProductConfiguration();
      }
      // Controlled test double of a bounded resolved configuration. The real
      // resolver's guarded-partial semantics are pinned in @exam/domain
      // productCapabilities.test.ts; this double isolates the write-guard
      // contract from resolver construction. Production shape is mirrored so
      // the seam under test is the real one.
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

/** Standard minus exactly the listed capabilities. */
function useBoundedCapabilitiesWithout(
  disabled: readonly ProductCapabilityId[],
): void {
  guardHarness.enabled = SUPPORTED_PRODUCT_CAPABILITIES.filter(
    (capability) => !disabled.includes(capability),
  );
}

function useStandardCapabilities(): void {
  guardHarness.enabled = undefined;
}

describe("question write capability guard (ADR-022 Phase 2)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;

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

  const OPTION_DOC = {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "inlineMath", latex: "\\pm 1" }],
      },
    ],
  };

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
    });
    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Capability Course",
        code: `CAP-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id as string;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(() => {
    useStandardCapabilities();
  });

  async function createQuestion(payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: { courseId, score: 5, difficulty: 1, ...payload },
      cookies: { "auth-token": ctx.adminToken },
    });
  }

  async function patchQuestion(id: string, payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${id}`,
      payload,
      cookies: { "auth-token": ctx.adminToken },
    });
  }

  async function getQuestion(id: string) {
    return ctx.app.inject({
      method: "GET",
      url: `/api/questions/${id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
  }

  async function listTotal(): Promise<number> {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/questions?courseId=${courseId}&pageSize=1`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    return res.json().total as number;
  }

  // ── Allowed items still succeed under a bounded ceiling ──────────

  it("keeps an enabled question type creatable while others are disabled", async () => {
    useBoundedCapabilitiesWithout([
      "question.multiple_choice",
      "content.prompt.rich",
      "content.option.rich",
      "answer.text.rich",
    ]);
    const res = await createQuestion({
      type: "single_choice",
      content: "1+1=?",
      options: [
        { id: "a", content: "2" },
        { id: "b", content: "3" },
      ],
      standardAnswer: "a",
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().type).toBe("single_choice");
  });

  it("keeps plain text_response creatable while every rich slot is disabled", async () => {
    useBoundedCapabilitiesWithout([
      "question.multiple_choice",
      "content.prompt.rich",
      "content.option.rich",
      "answer.text.rich",
    ]);
    const res = await createQuestion({
      type: "text_response",
      content: "简述两个系统的区别。",
      options: [],
      standardAnswer: null,
      rubric: "按点给分",
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().contentDocument).toBeNull();
  });

  // ── Disabled capabilities are rejected at the write boundary ─────

  it("rejects a disabled question type at create and persists nothing", async () => {
    useBoundedCapabilitiesWithout(["question.multiple_choice"]);
    const totalBefore = await listTotal();
    const res = await createQuestion({
      type: "multiple_choice",
      content: "多选题（部署已禁用该题型）",
      options: [
        { id: "a", content: "1", isCorrect: true },
        { id: "b", content: "2", isCorrect: false },
      ],
      standardAnswer: ["a"],
    });
    expect(res.statusCode, res.body).toBe(400);
    // The rejection is a capability refusal, not an actor-permission denial
    // (ADR-022 D3: separate authorities — 400, never 403, for Admin here).
    expect(res.statusCode).not.toBe(403);
    // Failure leaves no new content (single write seam, guard before repo).
    expect(await listTotal()).toBe(totalBefore);
  });

  it("rejects a rich prompt when content.prompt.rich is disabled", async () => {
    useBoundedCapabilitiesWithout(["content.prompt.rich"]);
    const res = await createQuestion({
      type: "text_response",
      contentDocument: RICH_DOC,
      options: [],
      standardAnswer: null,
      rubric: "按步骤给分",
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("rejects a rich option when content.option.rich is disabled", async () => {
    useBoundedCapabilitiesWithout(["content.option.rich"]);
    const res = await createQuestion({
      type: "single_choice",
      content: "选出正确项",
      options: [
        { id: "a", content: "0" },
        { id: "b", contentDocument: OPTION_DOC },
      ],
      standardAnswer: "b",
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("rejects a rich answer slot when answer.text.rich is disabled", async () => {
    useBoundedCapabilitiesWithout(["answer.text.rich"]);
    const res = await createQuestion({
      type: "text_response",
      content: "请作答（题干为纯文本）",
      answerMode: "rich",
      options: [],
      standardAnswer: null,
      rubric: "按点给分",
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  // ── Updates are judged on the merged final material ──────────────

  it("rejects an update that introduces a disabled rich prompt, leaving the row unchanged", async () => {
    useBoundedCapabilitiesWithout(["content.prompt.rich"]);
    const created = await createQuestion({
      type: "text_response",
      content: "纯文本题干",
      options: [],
      standardAnswer: null,
      rubric: "r",
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const res = await patchQuestion(id, { contentDocument: RICH_DOC });
    expect(res.statusCode, res.body).toBe(400);
    const read = await getQuestion(id);
    expect(read.json().contentDocument).toBeNull();
  });

  it("rejects an update that switches the type to a disabled question type", async () => {
    useBoundedCapabilitiesWithout(["question.multiple_choice"]);
    const created = await createQuestion({
      type: "single_choice",
      content: "单选（将尝试改为已禁用的多选）",
      options: [
        { id: "a", content: "1" },
        { id: "b", content: "2" },
      ],
      standardAnswer: "a",
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const res = await patchQuestion(id, {
      type: "multiple_choice",
      options: [
        { id: "a", content: "1", isCorrect: true },
        { id: "b", content: "2", isCorrect: false },
      ],
      standardAnswer: ["a"],
    });
    expect(res.statusCode, res.body).toBe(400);
    const read = await getQuestion(id);
    expect(read.json().type).toBe("single_choice");
  });

  it("rejects a non-eliminating edit that keeps disabled rich material (whole-material semantics)", async () => {
    // Pinned semantics: an update is judged on the merged FINAL material.
    // A legacy rich question (created while rich was enabled) cannot receive
    // any non-eliminating edit once its rich capabilities are disabled —
    // keeping the rich material in the merged view is itself a new
    // commitment of the disabled capability. The legal paths out are the
    // eliminating edit (contentDocument/answerMode cleared) and delete,
    // proven below. W2b (import) must share this same derivation.
    useStandardCapabilities();
    const created = await createQuestion({
      type: "text_response",
      contentDocument: RICH_DOC,
      answerMode: "rich",
      options: [],
      standardAnswer: null,
      rubric: "按步骤给分",
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;

    useBoundedCapabilitiesWithout(["content.prompt.rich", "answer.text.rich"]);
    const res = await patchQuestion(id, { score: 9 });
    expect(res.statusCode, res.body).toBe(400);
    const read = await getQuestion(id);
    expect(read.json().score).not.toBe(9);
  });

  // ── Existing obligations stay fulfillable after a downgrade ──────

  it("keeps reading, eliminating and deleting a legacy rich question legal after a downgrade", async () => {
    // ADR-022 D5: disabling a capability blocks NEW commitments; historical
    // Rich content keeps read/eliminate/delete paths.
    useStandardCapabilities();
    const created = await createQuestion({
      type: "text_response",
      contentDocument: RICH_DOC,
      answerMode: "rich",
      options: [],
      standardAnswer: null,
      rubric: "按步骤给分",
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;

    // The delete leg needs a SECOND still-rich legacy question; both legacy
    // rows are created under Standard BEFORE the downgrade.
    const stillRich = await createQuestion({
      type: "text_response",
      contentDocument: RICH_DOC,
      answerMode: "rich",
      options: [],
      standardAnswer: null,
      rubric: "r",
    });
    expect(stillRich.statusCode, stillRich.body).toBe(201);

    useBoundedCapabilitiesWithout(["content.prompt.rich", "answer.text.rich"]);

    // READ stays legal and returns the preserved document.
    const read = await getQuestion(id);
    expect(read.statusCode).toBe(200);
    expect(read.json().contentDocument).toEqual(RICH_DOC);

    // ELIMINATE stays legal: explicitly clearing every rich slot leaves a
    // final material the bounded ceiling admits.
    const eliminated = await patchQuestion(id, {
      contentDocument: null,
      content: "回到纯文本题干",
      answerMode: null,
    });
    expect(eliminated.statusCode, eliminated.body).toBe(200);
    expect(eliminated.json().contentDocument).toBeNull();

    // DELETE stays legal for a still-rich legacy question.
    const deleted = await ctx.app.inject({
      method: "DELETE",
      url: `/api/questions/${stillRich.json().id as string}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(deleted.statusCode).toBe(204);
  });
});
