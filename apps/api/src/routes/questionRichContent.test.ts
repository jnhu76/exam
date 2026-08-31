import { describe, expect, it, beforeAll, afterAll } from "vitest";
import questionRoutes from "./question.js";
import courseRoutes from "./course.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";

/**
 * #301 rich content write authority — server-side B′ seam integration tests.
 * The seam owns content derivation: client projections are never trusted,
 * fill_blank stays Plain-only, and rich ⇄ plain transitions are explicit.
 */
describe("#301 rich content write authority", () => {
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

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
    });
    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Rich Course",
        code: `RC-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function createQuestion(payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: { courseId, score: 5, difficulty: 1, ...payload },
      cookies: { "auth-token": ctx.adminToken },
    });
  }

  it("creates a rich text_response question without content; server derives projection", async () => {
    const res = await createQuestion({
      type: "text_response",
      contentDocument: RICH_DOC,
      answerMode: "rich",
      options: [],
      standardAnswer: null,
      rubric: "按步骤给分",
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.content).toBe("Solve: x^2-1=0");
    expect(body.contentDocument).toEqual(RICH_DOC);
    expect(body.answerMode).toBe("rich");
  });

  it("ignores a client-supplied content projection on rich writes", async () => {
    const res = await createQuestion({
      type: "text_response",
      content: "client says otherwise",
      contentDocument: RICH_DOC,
      options: [],
      standardAnswer: null,
      rubric: "rubric",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().content).toBe("Solve: x^2-1=0");
  });

  it("normalizes non-canonical rich documents before persistence", async () => {
    const transientForm = {
      ...RICH_DOC,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Sol", marks: ["bold"] },
            { type: "text", text: "ve: ", marks: ["bold"] },
            { type: "text", text: "" },
            { type: "inlineMath", latex: "x^2-1=0" },
          ],
        },
        { type: "paragraph", content: [] },
      ],
    };
    const res = await createQuestion({
      type: "text_response",
      contentDocument: transientForm,
      options: [],
      standardAnswer: null,
      rubric: "rubric",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().contentDocument).toEqual(RICH_DOC);
  });

  it("rejects fill_blank with rich content (hard rule)", async () => {
    const res = await createQuestion({
      type: "fill_blank",
      content: "____ + 1 = 2",
      contentDocument: RICH_DOC,
      standardAnswer: "1",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects answerMode on non-text_response", async () => {
    const res = await createQuestion({
      type: "single_choice",
      content: "q",
      answerMode: "rich",
      options: [
        { id: "a", content: "1" },
        { id: "b", content: "2" },
      ],
      standardAnswer: "a",
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates a rich option and derives its content projection", async () => {
    const optionDoc = {
      docVersion: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "inlineMath", latex: "pm 1" }],
        },
      ],
    };
    const res = await createQuestion({
      type: "single_choice",
      content: "x^2-1=0 的解是？",
      options: [
        { id: "a", content: "0" },
        { id: "b", contentDocument: optionDoc },
      ],
      standardAnswer: "b",
    });
    expect(res.statusCode).toBe(201);
    const options: Array<{
      id: string;
      content: string;
      contentDocument: unknown;
    }> = res.json().options;
    const richOption = options.find((o) => o.id === "b");
    expect(richOption?.content).toBe("pm 1");
    expect(richOption?.contentDocument).toEqual(optionDoc);
  });

  it("keeps plain creates legacy-shaped (contentDocument null, answerMode null)", async () => {
    const res = await createQuestion({
      type: "single_choice",
      content: "1+1=?",
      options: [
        { id: "a", content: "2" },
        { id: "b", content: "3" },
      ],
      standardAnswer: "a",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().contentDocument).toBeNull();
    expect(res.json().answerMode).toBeNull();
  });

  it("upgrades plain → rich on update and re-derives content", async () => {
    const created = await createQuestion({
      type: "text_response",
      content: "plain prompt",
      options: [],
      standardAnswer: null,
      rubric: "rubric",
    });
    const id = created.json().id as string;
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${id}`,
      payload: { contentDocument: RICH_DOC, answerMode: "rich" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("Solve: x^2-1=0");
    expect(res.json().answerMode).toBe("rich");
  });

  it("downgrades rich → plain only via explicit contentDocument: null", async () => {
    const created = await createQuestion({
      type: "text_response",
      contentDocument: RICH_DOC,
      options: [],
      standardAnswer: null,
      rubric: "rubric",
    });
    const id = created.json().id as string;
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${id}`,
      payload: { contentDocument: null, content: "back to plain" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().contentDocument).toBeNull();
    expect(res.json().content).toBe("back to plain");
  });

  it("rejects a bare content edit on a rich question (projection authority)", async () => {
    const created = await createQuestion({
      type: "text_response",
      contentDocument: RICH_DOC,
      options: [],
      standardAnswer: null,
      rubric: "rubric",
    });
    const id = created.json().id as string;
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${id}`,
      payload: { content: "sneaky edit" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    const readBack = await ctx.app.inject({
      method: "GET",
      url: `/api/questions/${id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(readBack.json().content).toBe("Solve: x^2-1=0");
  });

  it("rejects switching a rich question to fill_blank without clearing the document", async () => {
    const created = await createQuestion({
      type: "text_response",
      contentDocument: RICH_DOC,
      options: [],
      standardAnswer: null,
      rubric: "rubric",
    });
    const id = created.json().id as string;
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${id}`,
      payload: { type: "fill_blank", standardAnswer: "1" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });
});
