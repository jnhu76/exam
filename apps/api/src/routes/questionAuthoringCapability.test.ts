import { afterAll, beforeAll, describe, expect, it } from "vitest";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  uniquePrefix,
} from "./testHelpers.js";

describe("question routes — Teacher authoring capabilities", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let teacherToken: string;
  let candidateToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "P4-2B Course",
        code: `P42B-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(courseRes.statusCode).toBe(201);
    courseId = courseRes.json().id;

    // RBAC-M10-E: delegates to createAssignedUserForTest so the user gets an
    // active primary role assignment — without it, authenticate denies 401 and
    // the capability decisions under test never run.
    const createUserToken = async (role: "Teacher" | "Candidate") => {
      const { token } = await createAssignedUserForTest(
        ctx.db,
        ctx.org.id,
        role as never,
        `p42b-${role.toLowerCase()}-question-auth`,
      );
      return token;
    };
    teacherToken = await createUserToken("Teacher");
    candidateToken = await createUserToken("Candidate");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("Teacher completes create, list, detail, update, and delete", async () => {
    const createRes = await ctx.app.inject({
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
      cookies: { "auth-token": teacherToken },
    });
    expect(createRes.statusCode).toBe(201);
    const questionId = createRes.json().id as string;

    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/questions",
      cookies: { "auth-token": teacherToken },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: questionId })]),
    );

    const detailRes = await ctx.app.inject({
      method: "GET",
      url: `/api/questions/${questionId}`,
      cookies: { "auth-token": teacherToken },
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().rubric).toBe(
      "按逻辑完整性、关键概念、论证质量给分",
    );

    const updateRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${questionId}`,
      payload: { content: "更新后的题目内容" },
      cookies: { "auth-token": teacherToken },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().content).toBe("更新后的题目内容");

    const deleteRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/questions/${questionId}`,
      cookies: { "auth-token": teacherToken },
    });
    expect(deleteRes.statusCode).toBe(204);
  });

  it("Teacher imports and persists valid questions", async () => {
    const importRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions/import",
      payload: {
        courseId,
        confirm: true,
        rows: [
          {
            type: "true_false",
            content: "Teacher imported question",
            standardAnswer: true,
            score: 5,
          },
        ],
      },
      cookies: { "auth-token": teacherToken },
    });
    expect(importRes.statusCode).toBe(200);
    expect(importRes.json()).toMatchObject({ valid: 1, errors: 0 });

    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/questions?search=Teacher%20imported%20question",
      cookies: { "auth-token": teacherToken },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: "Teacher imported question" }),
      ]),
    );
  });

  it("Candidate is denied at the question capability gate", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "text_response",
        content: "x",
        standardAnswer: null,
        score: 1,
        rubric: "r",
      },
      cookies: { "auth-token": candidateToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: expect.objectContaining({ code: "PERMISSION_DENIED" }),
    });
  });

  it("Admin retains question creation access", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: "Admin still works",
        options: [
          { id: "a", content: "1" },
          { id: "b", content: "2", isCorrect: true },
        ],
        standardAnswer: "b",
        score: 5,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
  });
});
