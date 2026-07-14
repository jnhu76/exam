import { describe, expect, it, beforeAll, afterAll } from "vitest";
import questionRoutes from "./question.js";
import courseRoutes from "./course.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";

describe("question routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Q Course",
        code: `QC-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("POST /api/questions creates a single_choice question", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: "What is 1+1?",
        options: [
          { id: "a", content: "1" },
          { id: "b", content: "2", isCorrect: true },
          { id: "c", content: "3" },
        ],
        standardAnswer: "b",
        score: 10,
        difficulty: 1,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.type).toBe("single_choice");
    expect(body.content).toBe("What is 1+1?");
    expect(body.courseId).toBe(courseId);
    expect(body).toHaveProperty("id");
  });

  it("POST /api/questions creates a true_false question", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "The sky is blue.",
        standardAnswer: true,
        score: 5,
        difficulty: 1,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe("true_false");
  });

  it("POST /api/questions creates a subjective (null standardAnswer) single_choice question", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: "Discuss the trade-offs in detail.",
        options: [
          { id: "a", content: "Option A" },
          { id: "b", content: "Option B" },
        ],
        standardAnswer: null,
        score: 20,
        difficulty: 3,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.type).toBe("single_choice");
    expect(body.standardAnswer).toBeNull();
  });

  it("POST /api/questions creates a subjective (null standardAnswer) fill_blank question", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "fill_blank",
        content: "Write your essay in the blank: ____",
        standardAnswer: null,
        score: 30,
        difficulty: 3,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().standardAnswer).toBeNull();
  });

  it("POST /api/questions still rejects single_choice with a non-option answer", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: "Objective question",
        options: [
          { id: "a", content: "A" },
          { id: "b", content: "B" },
        ],
        standardAnswer: "zzz",
        score: 5,
        difficulty: 1,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/questions creates a fill_blank question", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "fill_blank",
        content: "The capital of France is ____.",
        standardAnswer: "Paris",
        score: 10,
        difficulty: 2,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe("fill_blank");
  });

  it("POST /api/questions creates a multiple_choice question", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "multiple_choice",
        content: "Select even numbers.",
        options: [
          { id: "a", content: "1" },
          { id: "b", content: "2", isCorrect: true },
          { id: "c", content: "3" },
          { id: "d", content: "4", isCorrect: true },
        ],
        standardAnswer: ["b", "d"],
        score: 10,
        difficulty: 2,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe("multiple_choice");
  });

  it("GET /api/questions returns list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/questions",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body.items.length).toBeGreaterThanOrEqual(4);
  });

  it("GET /api/questions filters by courseId", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/questions?courseId=${courseId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.every((q: any) => q.courseId === courseId)).toBe(true);
  });

  it("GET /api/questions filters by type", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/questions?type=single_choice",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.every((q: any) => q.type === "single_choice")).toBe(true);
  });

  it("GET /api/questions filters by server-side content search (case-insensitive, substring)", async () => {
    // Seed a known question so the search assertion does not depend on the
    // execution order of other tests in this file.
    const needle = "Photosynthesis produces OXYGEN and glucose.";
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: needle,
        options: [
          { id: "a", content: "A" },
          { id: "b", content: "B", isCorrect: true },
        ],
        standardAnswer: "b",
        score: 5,
        difficulty: 2,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(createRes.statusCode).toBe(201);

    // Lowercase substring of the mixed-case content.
    const lower = await ctx.app.inject({
      method: "GET",
      url: `/api/questions?courseId=${courseId}&search=produces+oxygen`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(lower.statusCode).toBe(200);
    const lowerBody = lower.json();
    expect(lowerBody.items.length).toBeGreaterThan(0);
    expect(lowerBody.total).toBe(lowerBody.items.length);
    expect(
      lowerBody.items.every((q: any) =>
        q.content.toLowerCase().includes("produces oxygen"),
      ),
    ).toBe(true);

    // Same term in UPPER must match the same rows (case-insensitivity).
    const upper = await ctx.app.inject({
      method: "GET",
      url: `/api/questions?courseId=${courseId}&search=PRODUCES+OXYGEN`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(upper.statusCode).toBe(200);
    expect(upper.json().total).toBe(lowerBody.total);

    // A search term that matches nothing returns an empty page, total 0.
    // NB: the term uses ILIKE metacharacters (_) deliberately — they must be
    // treated as literals, NOT single-char wildcards, or this would match the
    // seeded row above (each _ absorbing one char).
    const none = await ctx.app.inject({
      method: "GET",
      url: `/api/questions?courseId=${courseId}&search=__no_such_content_zzz__`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(none.statusCode).toBe(200);
    expect(none.json().total).toBe(0);
    expect(none.json().items).toEqual([]);
  });

  it("GET /api/questions treats empty/whitespace search as no-op", async () => {
    const base = await ctx.app.inject({
      method: "GET",
      url: `/api/questions?courseId=${courseId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const empty = await ctx.app.inject({
      method: "GET",
      url: `/api/questions?courseId=${courseId}&search=`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const ws = await ctx.app.inject({
      method: "GET",
      url: `/api/questions?courseId=${courseId}&search=%20%20`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(base.json().total).toBe(empty.json().total);
    expect(base.json().total).toBe(ws.json().total);
  });

  it("GET /api/questions/:id returns single question", async () => {
    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/questions",
      cookies: { "auth-token": ctx.adminToken },
    });
    const first = listRes.json().items[0];

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/questions/${first.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(first.id);
  });

  it("PATCH /api/questions/:id updates a question", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "To update.",
        standardAnswer: true,
        score: 5,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${created.id}`,
      payload: { content: "Updated content." },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("Updated content.");
  });

  it("DELETE /api/questions/:id deletes a question", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "To delete.",
        standardAnswer: false,
        score: 5,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/questions/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(204);
  });

  it("POST /api/questions rejects single_choice with < 2 options", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: "Bad question.",
        options: [{ id: "a", content: "Only one" }],
        standardAnswer: "a",
        score: 10,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/questions rejects fill_blank without ____ in content", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "fill_blank",
        content: "No placeholder here.",
        standardAnswer: "answer",
        score: 10,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/questions rejects true_false with non-boolean answer", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "Bad answer type.",
        standardAnswer: "yes",
        score: 10,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/questions returns 401 without auth", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/questions",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(body.error.requestId).toBeDefined();
  });

  it("GET /api/questions/:id returns 404 ErrorResponse v0 for missing question", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/questions/00000000-0000-0000-0000-000000000000",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(body.error.requestId).toBeDefined();
  });

  it("POST /api/questions returns 400 ErrorResponse v0 for invalid courseId", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId: "00000000-0000-0000-0000-000000000000",
        type: "true_false",
        content: "Bad course question.",
        standardAnswer: true,
        score: 5,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.requestId).toBeDefined();
    expect(body.error.details.fields).toBeDefined();
    expect(body.error.details.fields[0].field).toBe("courseId");
  });

  it("DELETE /api/questions/:id returns 404 ErrorResponse v0 for missing question", async () => {
    const res = await ctx.app.inject({
      method: "DELETE",
      url: "/api/questions/00000000-0000-0000-0000-000000000000",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(body.error.requestId).toBeDefined();
  });

  it("POST /api/questions/import imports valid rows", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions/import",
      payload: {
        courseId,
        rows: [
          {
            type: "single_choice",
            content: "Import Q1?",
            optionA: "A",
            optionB: "B",
            optionC: "C",
            optionD: "D",
            standardAnswer: "A",
            score: 10,
          },
          {
            type: "true_false",
            content: "Import Q2?",
            standardAnswer: true,
            score: 5,
          },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.valid).toBe(2);
    expect(body.errors).toBe(0);
  });

  it("POST /api/questions/import with confirm=true persists a log and returns logId", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions/import",
      payload: {
        courseId,
        confirm: true,
        rows: [
          {
            type: "true_false",
            content: "Confirm log Q?",
            standardAnswer: true,
            score: 5,
          },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(1);
    expect(body.logId).toEqual(expect.any(String));
  });

  it("POST /api/questions/import without confirm does not return logId", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions/import",
      payload: {
        courseId,
        rows: [
          {
            type: "true_false",
            content: "Preview Q?",
            standardAnswer: false,
            score: 5,
          },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.logId).toBeUndefined();
  });

  // ── P3-L0-1C: rubric production write/read path closure ─────────
  // Proves the historical gap is fixed: rubric flows through POST/PATCH
  // routes (not just repo/contract) and survives a real DB round-trip.

  it("POST /api/questions persists a text_response rubric and returns it", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "text_response",
        content: "请阐述你的观点",
        standardAnswer: null,
        score: 20,
        difficulty: 3,
        rubric: "按逻辑完整性、关键概念、论证质量给分",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.type).toBe("text_response");
    expect(body.rubric).toBe("按逻辑完整性、关键概念、论证质量给分");
    expect(body.id).toBeDefined();
  });

  it("GET /api/questions/:id returns the persisted text_response rubric", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "text_response",
        content: "返回读取测试",
        standardAnswer: null,
        score: 10,
        rubric: "Award full credit for a correct logical chain",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/questions/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rubric).toBe(
      "Award full credit for a correct logical chain",
    );
  });

  it("PATCH /api/questions/:id persists rubric updates", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "text_response",
        content: "待更新 rubric 的题",
        standardAnswer: null,
        score: 15,
        rubric: "初始评分标准",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();

    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${created.id}`,
      payload: { rubric: "更新后的评分标准" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().rubric).toBe("更新后的评分标准");

    // Re-read through GET to prove the value is persisted, not just echoed.
    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/questions/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().rubric).toBe("更新后的评分标准");
  });

  it("PATCH /api/questions/:id without rubric field preserves the persisted rubric", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "text_response",
        content: "省略 rubric 字段的 PATCH 测试",
        standardAnswer: null,
        score: 12,
        rubric: "Original rubric",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();

    // PATCH with an unrelated mutable field, omitting rubric entirely,
    // so the update path executes without touching the rubric key.
    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${created.id}`,
      payload: { content: "Updated content, rubric field omitted" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(patchRes.statusCode).toBe(200);

    // Independent readback through the production GET path.
    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/questions/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().rubric).toBe("Original rubric");
  });

  it("PATCH /api/questions/:id with rubric=null clears the persisted rubric", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "text_response",
        content: "显式 null 清空 rubric 测试",
        standardAnswer: null,
        score: 12,
        rubric: "Original rubric",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();

    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${created.id}`,
      payload: { rubric: null },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(patchRes.statusCode).toBe(200);

    // Independent readback through the production GET path; do not infer
    // correctness from the PATCH response alone.
    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/questions/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().rubric).toBeNull();
  });

  it("GET /api/questions list projects rubric (null for objective questions)", async () => {
    // Objective question created without rubric → null semantics.
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "rubric null semantics marker question",
        standardAnswer: true,
        score: 2,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/questions/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rubric).toBeNull();
  });

  it("POST /api/questions/import persists a text_response row with rubric", async () => {
    const previewRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions/import",
      payload: {
        courseId,
        confirm: true,
        rows: [
          {
            type: "text_response",
            content: "导入的简答题",
            standardAnswer: null,
            score: 8,
            rubric: "导入评分标准",
          },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(previewRes.statusCode).toBe(200);
    const body = previewRes.json();
    expect(body.valid).toBe(1);
    expect(body.errors).toBe(0);

    // Confirm the imported row's rubric actually reached questions.rubric.
    const listRes = await ctx.app.inject({
      method: "GET",
      url: `/api/questions?courseId=${courseId}&type=text_response`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(listRes.statusCode).toBe(200);
    const items = listRes.json().items as Array<{
      content: string;
      rubric: string | null;
    }>;
    const imported = items.find((q) => q.content === "导入的简答题");
    expect(imported).toBeDefined();
    expect(imported?.rubric).toBe("导入评分标准");
  });

  it("POST /api/questions/import reports errors for invalid rows", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions/import",
      payload: {
        courseId,
        rows: [
          {
            type: "single_choice",
            content: "Valid row",
            optionA: "A",
            optionB: "B",
            standardAnswer: "A",
            score: 10,
          },
          {
            type: "fill_blank",
            content: "No placeholder.",
            standardAnswer: "x",
            score: 5,
          },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.valid).toBe(1);
    expect(body.errors).toBe(1);
    expect(body.details[1].status).toBe("error");
  });
});
