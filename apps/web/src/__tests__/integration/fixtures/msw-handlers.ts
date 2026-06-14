import { http, HttpResponse } from "msw";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export const authHandlers = [
  http.post(`${API_BASE}/api/auth/login`, async ({ request }) => {
    const body = (await request.json()) as {
      username: string;
      password: string;
    };
    if (body.username === "admin" && body.password === "password") {
      return HttpResponse.json({
        id: "user-1",
        username: "admin",
        name: "管理员",
        role: "Admin",
        organizationId: "org-1",
      });
    }
    return HttpResponse.json(
      { message: "Invalid username or password", code: "INVALID_CREDENTIALS" },
      { status: 401 },
    );
  }),

  http.post(`${API_BASE}/api/auth/logout`, async () => {
    return HttpResponse.json({ success: true });
  }),

  http.get(`${API_BASE}/api/auth/me`, async () => {
    return HttpResponse.json({
      id: "user-1",
      username: "admin",
      name: "管理员",
      role: "Admin",
      organizationId: "org-1",
    });
  }),
];
