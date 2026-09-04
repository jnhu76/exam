import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, setNavigate } from "./api";

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { toast } from "sonner";

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setNavigate(() => {});
  });

  describe("GET requests", () => {
    it("attaches auth cookies to requests", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await api.get<{ status: string }>("/api/health");

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/health",
        expect.objectContaining({ credentials: "include" }),
      );
    });

    it("does not set Content-Type for GET requests", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await api.get("/api/health");

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/health",
        expect.objectContaining({
          headers: {},
        }),
      );
    });

    it("parses JSON response body", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ name: "test", count: 42 }), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const result = await api.get<{ name: string; count: number }>(
        "/api/data",
      );

      expect(result).toEqual({ name: "test", count: 42 });
    });

    it("returns undefined for 204 No Content", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
      );

      const result = await api.post("/api/resource/1");

      expect(result).toBeUndefined();
    });
  });

  describe("POST requests", () => {
    it("sends POST with JSON body", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "1" }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await api.post<{ id: string }, { name: string }>("/api/items", {
        name: "new item",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/items",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "new item" }),
          credentials: "include",
        }),
      );
    });

    it("sends POST without body when undefined", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await api.post("/api/action");

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/action",
        expect.objectContaining({
          method: "POST",
          body: undefined,
        }),
      );
    });

    it("does not set Content-Type when POST body is undefined", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await api.post("/api/exams/1/publish");

      const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
      expect(callArgs.headers).not.toHaveProperty("Content-Type");
      expect(callArgs.body).toBeUndefined();
    });
  });

  describe("DELETE requests", () => {
    it("does not set Content-Type header", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", fetchMock);

      await api.delete("/api/courses/1");

      const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
      expect(callArgs.headers).not.toHaveProperty("Content-Type");
    });
  });

  describe("error handling", () => {
    it("redirects unauthorized requests to login via navigate", async () => {
      const navigateMock = vi.fn();
      setNavigate(navigateMock);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
      );

      await expect(api.get("/api/me")).rejects.toThrow("401");
      expect(navigateMock).toHaveBeenCalledWith("/login");
    });

    it("does not throw if navigate is not set on 401", async () => {
      setNavigate(null as never);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
      );

      await expect(api.get("/api/me")).rejects.toThrow("401");
    });

    it("throws ApiError with status for non-ok responses", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 })),
      );

      await expect(api.get("/api/missing")).rejects.toThrow("404");
    });

    it("throws ApiError for 500 responses", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(new Response("Server Error", { status: 500 })),
      );

      await expect(api.get("/api/broken")).rejects.toThrow("500");
    });

    it("preserves ErrorResponse v0 fields on ApiError", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: "VALIDATION_ERROR",
                message: "请求参数无效",
                details: {
                  fields: [
                    {
                      field: "username",
                      code: "TOO_SMALL",
                      message: "用户名不能为空",
                    },
                  ],
                },
                requestId: "req-web",
              },
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      );

      await expect(api.post("/api/auth/login", {})).rejects.toMatchObject({
        name: "ApiError",
        status: 400,
        code: "VALIDATION_ERROR",
        details: {
          fields: [
            {
              field: "username",
              code: "TOO_SMALL",
              message: "用户名不能为空",
            },
          ],
        },
        requestId: "req-web",
      });
    });

    it("shows toast on network failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );

      await expect(api.get("/api/unreachable")).rejects.toThrow(
        "Network request failed",
      );
      expect(toast.error).toHaveBeenCalledWith("网络连接失败，请稍后重试");
    });

    it("wraps unknown errors as ApiError with status 0", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Network error")),
      );

      await expect(api.get("/api/fail")).rejects.toMatchObject({
        name: "ApiError",
        status: 0,
      });
    });
  });

  describe("ApiError class", () => {
    it("exposes structured error metadata", () => {
      const error = new ApiError(
        403,
        "无权执行此操作",
        "PERMISSION_DENIED",
        { action: "user.update" },
        "req-class",
      );

      expect(error.name).toBe("ApiError");
      expect(error.status).toBe(403);
      expect(error.message).toBe("无权执行此操作");
      expect(error.code).toBe("PERMISSION_DENIED");
      expect(error.details).toEqual({ action: "user.update" });
      expect(error.requestId).toBe("req-class");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("C3 browser message authority (wire layer)", () => {
    it("T1: keeps the server compat message verbatim for a known code — never contracts registry text", async () => {
      // If the client re-resolves known codes through the server
      // compatibility catalog (registry-first), .message would become 请先登录
      // and this test fails (mutation M5).
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: "AUTH_REQUIRED",
                message: "服务端自定义文案",
                requestId: "req-c3-1",
              },
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      );

      await expect(api.get("/api/protected")).rejects.toMatchObject({
        name: "ApiError",
        status: 401,
        code: "AUTH_REQUIRED",
        message: "服务端自定义文案",
        serverMessage: "服务端自定义文案",
        requestId: "req-c3-1",
      });
    });

    it("synthesizes the status string when a known code carries no wire message", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: "AUTH_REQUIRED",
                requestId: "req-c3-2",
              },
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      );

      await expect(api.get("/api/protected")).rejects.toMatchObject({
        name: "ApiError",
        status: 401,
        code: "AUTH_REQUIRED",
        message: "401 Request failed",
        serverMessage: undefined,
      });
    });

    it("treats an empty wire message as not usable", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: { code: "AUTH_REQUIRED", message: "" },
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      );

      await expect(api.get("/api/protected")).rejects.toMatchObject({
        name: "ApiError",
        status: 401,
        code: "AUTH_REQUIRED",
        message: "401 Request failed",
        serverMessage: "",
      });
    });

    it("T4: unknown code keeps the server compatibility message", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: "TOTALLY_NEW_CODE_NOT_IN_REGISTRY",
                message: "上游服务返回的特殊文案",
                requestId: "req-c3-4",
              },
            }),
            {
              status: 418,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      );

      await expect(api.get("/api/strange")).rejects.toMatchObject({
        name: "ApiError",
        status: 418,
        code: "TOTALLY_NEW_CODE_NOT_IN_REGISTRY",
        message: "上游服务返回的特殊文案",
        serverMessage: "上游服务返回的特殊文案",
      });
    });

    it("T5: unknown code with an empty wire message degrades to the status string", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: "TOTALLY_NEW_CODE_NOT_IN_REGISTRY",
                message: "",
              },
            }),
            {
              status: 418,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      );

      await expect(api.get("/api/strange")).rejects.toMatchObject({
        name: "ApiError",
        status: 418,
        code: "TOTALLY_NEW_CODE_NOT_IN_REGISTRY",
        message: "418 Request failed",
      });
    });

    it("falls back to status string when code is unknown and message is absent", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: "TOTALLY_NEW_CODE_NOT_IN_REGISTRY",
              },
            }),
            {
              status: 418,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      );

      await expect(api.get("/api/strange")).rejects.toMatchObject({
        name: "ApiError",
        status: 418,
        code: "TOTALLY_NEW_CODE_NOT_IN_REGISTRY",
        message: "418 Request failed",
      });
    });

    it("falls back to status string when body cannot be parsed", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response("not-json", {
            status: 502,
          }),
        ),
      );

      await expect(api.get("/api/upstream")).rejects.toMatchObject({
        name: "ApiError",
        status: 502,
        message: "502 Request failed",
      });
    });

    it("preserves error details machine payload alongside the compat message", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: "RESOURCE_CONFLICT",
                message: "资源状态冲突",
                details: {
                  reason: "COURSE_CODE_EXISTS",
                  params: { courseCode: "CS101" },
                },
                requestId: "req-c3-5",
              },
            }),
            {
              status: 409,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      );

      await expect(api.post("/api/courses", {})).rejects.toMatchObject({
        name: "ApiError",
        status: 409,
        code: "RESOURCE_CONFLICT",
        details: {
          reason: "COURSE_CODE_EXISTS",
          params: { courseCode: "CS101" },
        },
        requestId: "req-c3-5",
      });
    });
  });
});
