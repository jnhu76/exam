import { setupServer } from "msw/node";
import { authHandlers } from "./msw-handlers";
import { http, HttpResponse } from "msw";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

const examHandlers = [
  http.get(`${API_BASE}/api/exams`, () => {
    return HttpResponse.json({
      items: [
        {
          id: "exam-1",
          title: "测试考试1",
          description: "这是一个测试考试",
          status: "published",
          durationMinutes: 60,
          passingScore: 60,
          totalScore: 100,
          courseId: "course-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  }),

  http.post(`${API_BASE}/api/exams`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      {
        id: "exam-new",
        ...body,
        status: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { status: 201 },
    );
  }),

  http.patch(`${API_BASE}/api/exams/:id`, async ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      title: "更新的考试",
      status: "published",
      updatedAt: new Date().toISOString(),
    });
  }),
];

const candidateHandlers = [
  http.get(`${API_BASE}/api/candidates`, () => {
    return HttpResponse.json({
      items: [
        {
          id: "candidate-1",
          userId: "user-2",
          name: "张三",
          fields: { candidateId: "C001" },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  }),

  http.post(`${API_BASE}/api/enrollments`, async () => {
    return HttpResponse.json(
      {
        id: "enrollment-1",
        status: "enrolled",
      },
      { status: 201 },
    );
  }),
];

const scoreHandlers = [
  http.get(`${API_BASE}/api/scores`, () => {
    return HttpResponse.json({
      items: [
        {
          id: "score-1",
          examId: "exam-1",
          candidateId: "candidate-1",
          score: 85,
          passed: true,
        },
      ],
      total: 1,
    });
  }),
];

export const server = setupServer(
  ...authHandlers,
  ...examHandlers,
  ...candidateHandlers,
  ...scoreHandlers,
);
