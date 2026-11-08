import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  __resetNetworkFailureLimiterForTest,
  API_STATIC_SEGMENTS,
  api,
  ApiError,
  setNavigate,
} from "./api";

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import { logger } from "@/lib/logger";

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setNavigate(() => {});
    vi.clearAllMocks();
    __resetNetworkFailureLimiterForTest();
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

    it("warns api.network_failed with a masked path pattern on transport failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );

      await expect(
        api.get("/api/candidate/exams/550e8400-e29b-41d4-a716-446655440000"),
      ).rejects.toBeInstanceOf(ApiError);

      expect(logger.warn).toHaveBeenCalledWith("api.network_failed", {
        pathPattern: "/api/candidate/exams/:id",
      });
    });

    it("masks all-digit path segments in the pattern", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );

      await expect(api.get("/api/exams/42/publish")).rejects.toBeInstanceOf(
        ApiError,
      );

      expect(logger.warn).toHaveBeenCalledWith("api.network_failed", {
        pathPattern: "/api/exams/:id/publish",
      });
    });

    it("keeps vocabulary segments around a masked uuid as today", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );

      await expect(
        api.get(
          "/api/admin/attempts/9f8e7d6c-1a2b-3c4d-5e6f-7a8b9c0d1e2f/proctor-events",
        ),
      ).rejects.toBeInstanceOf(ApiError);

      expect(logger.warn).toHaveBeenCalledWith("api.network_failed", {
        pathPattern: "/api/admin/attempts/:id/proctor-events",
      });
    });

    it("masks opaque non-vocabulary segments to :id", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );

      await expect(
        api.get("/api/attempts/att_9f8e7d6c/heartbeat"),
      ).rejects.toBeInstanceOf(ApiError);

      expect(logger.warn).toHaveBeenCalledWith("api.network_failed", {
        pathPattern: "/api/attempts/:id/heartbeat",
      });
    });

    it("masks slug-like segments that are not in the vocabulary", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );

      await expect(
        api.get("/api/exams/exam-final-2026x/publish"),
      ).rejects.toBeInstanceOf(ApiError);

      expect(logger.warn).toHaveBeenCalledWith("api.network_failed", {
        pathPattern: "/api/exams/:id/publish",
      });
    });

    it("keeps an all-static path unchanged and drops the query string", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );

      await expect(
        api.get("/api/auth/login?ticket=opaque-token"),
      ).rejects.toBeInstanceOf(ApiError);

      expect(logger.warn).toHaveBeenCalledWith("api.network_failed", {
        pathPattern: "/api/auth/login",
      });
    });

    it("masks uuid path segments and drops query strings in the pattern", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );

      await expect(
        api.get(
          "/api/attempts/550e8400-e29b-41d4-a716-446655440000/answers?page=2",
        ),
      ).rejects.toBeInstanceOf(ApiError);

      expect(logger.warn).toHaveBeenCalledWith("api.network_failed", {
        pathPattern: "/api/attempts/:id/answers",
      });
    });

    it("rate-limits repeated failures for the same path pattern", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );

      // A polling page hammering a dead gateway must stay a bounded number
      // of persisted rows.
      for (let i = 0; i < 7; i++) {
        await expect(api.get("/api/health")).rejects.toBeInstanceOf(ApiError);
      }
      expect(logger.warn).toHaveBeenCalledTimes(5);

      // A different pattern is unaffected by the exhausted key.
      await expect(api.get("/api/users/9")).rejects.toBeInstanceOf(ApiError);
      expect(logger.warn).toHaveBeenCalledTimes(6);
    });

    it("does not warn for aborted requests or non-2xx ApiError responses", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ error: { code: "X" } }), {
              status: 500,
            }),
          ),
      );

      await expect(
        api.get("/api/health", { signal: new AbortController().signal }),
      ).rejects.toThrow();
      await expect(api.get("/api/health")).rejects.toBeInstanceOf(ApiError);

      expect(logger.warn).not.toHaveBeenCalled();
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

/**
 * Vocabulary sync for `api.network_failed` path categories: the persisted
 * category may only contain segments from API_STATIC_SEGMENTS, so every
 * static segment of every production `/api/` literal must be in the set.
 * A new endpoint without a vocabulary entry fails here instead of silently
 * persisting raw segments (the runtime itself still degrades unknown
 * segments to `:id`, so the failure is a vocabulary-maintenance signal,
 * not a leak).
 */
describe("API path-category vocabulary sync", () => {
  /** String literal (any quote style) that starts with `/api/`. */
  const API_LITERAL = /(["`'])(\/api\/[^"`']*)\1/g;

  const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

  /** Collects static segments of `/api/` literals under a source tree. */
  function collectApiStaticSegments(root: string): Set<string> {
    const segments = new Set<string>();
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "__tests__") {
        continue;
      }
      const full = join(root, entry.name);
      if (entry.isDirectory()) {
        for (const segment of collectApiStaticSegments(full)) {
          segments.add(segment);
        }
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.test\.|\.stories\./.test(entry.name)) continue;
      const text = readFileSync(full, "utf8");
      for (const match of text.matchAll(API_LITERAL)) {
        const pathPart = match[2]!.split("?")[0]!;
        for (const segment of pathPart.split("/")) {
          // Template placeholders are dynamic values, not static vocabulary.
          if (segment === "" || segment.includes("${")) continue;
          segments.add(segment);
        }
      }
    }
    return segments;
  }

  it("API_STATIC_SEGMENTS contains every static segment of production /api/ literals", () => {
    const segments = collectApiStaticSegments(SRC_ROOT);

    // Guard against a silently broken scanner: the auth endpoints are real
    // call sites, so they must be among the extracted segments.
    expect(segments.has("auth")).toBe(true);

    const missing = [...segments]
      .filter((segment) => !API_STATIC_SEGMENTS.has(segment))
      .sort();
    expect(
      missing,
      `segments used by /api/ literals but missing from API_STATIC_SEGMENTS: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

describe("api client — X-Request-Id success-path consumption (#865)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setNavigate(() => {});
    vi.clearAllMocks();
    __resetNetworkFailureLimiterForTest();
  });

  function okResponse(body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  it("requestWithMeta exposes the server x-request-id from a 2xx response", async () => {
    const requestId = "0b2f6f1e-7c1a-4c3f-9d2e-48464aa6b1f5";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          okResponse({ accepted: 1 }, { "x-request-id": requestId }),
        ),
    );

    const { data, meta } = await api.postWithMeta<{ accepted: number }>(
      "/api/client-events",
      { events: [] },
    );

    expect(data).toEqual({ accepted: 1 });
    expect(meta.requestId).toBe(requestId);
  });

  it("meta.requestId is null when the header is absent (older server / hop)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ ok: true })));

    const { meta } = await api.getWithMeta<{ ok: boolean }>("/api/health");

    expect(meta.requestId).toBeNull();
  });

  it("the plain request<T> API is unchanged (no meta leakage)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          okResponse({ ok: true }, { "x-request-id": "irrelevant-id" }),
        ),
    );

    const result = await api.get<{ ok: boolean }>("/api/health");

    expect(result).toEqual({ ok: true });
  });

  it("error responses keep using the envelope requestId (existing contract)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "bad",
              requestId: "envelope-req-id",
            },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(api.get("/api/nope")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      requestId: "envelope-req-id",
    });
  });

  it("postWithMeta keeps the shared 401 redirect on the error path", async () => {
    const navigateMock = vi.fn();
    setNavigate(navigateMock);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    await expect(
      api.postWithMeta("/api/attempts/att-1/answers/q1", { answer: null }),
    ).rejects.toThrow("401");
    // The meta wrapper must not bypass the shared requestWithMeta error
    // handling: an expired session still lands on /login.
    expect(navigateMock).toHaveBeenCalledWith("/login");
  });

  it("envelope/header requestId mismatch: envelope stays authoritative, header is captured, one bounded warn records the inconsistency (#924 Case D)", async () => {
    const mismatchResponse = () =>
      new Response(
        JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "boom",
            requestId: "envelope-req-id",
          },
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "x-request-id": "header-req-id",
          },
        },
      );
    // Fresh Response per call — a body can only be consumed once.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => mismatchResponse()),
    );

    await expect(api.postWithMeta("/api/items", {})).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      // Priority stays with the typed wire contract (the envelope); the
      // header is a captured observation, never the promoted fact.
      requestId: "envelope-req-id",
      headerRequestId: "header-req-id",
    });

    // Not silently choosing one: the inconsistency itself is recorded as a
    // bounded client-log warn (diagnostic trace, not an error framework).
    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const mismatchWarns = warnCalls.filter(
      ([name]) => name === "api.request_id_correlation_mismatch",
    );
    expect(mismatchWarns).toHaveLength(1);
    expect(mismatchWarns[0]![1]).toEqual({
      envelopeRequestId: "envelope-req-id",
      headerRequestId: "header-req-id",
    });

    // Bounded: the fixed-key limiter caps persisted warns per window even
    // under a storm of mismatching failures (same contract as
    // api.network_failed).
    for (let i = 0; i < 9; i += 1) {
      await expect(api.get("/api/items")).rejects.toThrow();
    }
    expect(
      warnCalls.filter(
        ([name]) => name === "api.request_id_correlation_mismatch",
      ).length,
    ).toBeLessThanOrEqual(5);
  });

  it("no correlation warn when the envelope and header agree or only one exists", async () => {
    // Both present and equal.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "A", message: "x", requestId: "same-id" },
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "x-request-id": "same-id",
            },
          },
        ),
      ),
    );
    await expect(api.get("/api/a")).rejects.toThrow();
    // Envelope only (no header — older hop).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "A", message: "x", requestId: "env-only" },
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    await expect(api.get("/api/b")).rejects.toThrow();
    // Header only (no envelope requestId).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "A", message: "x" } }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "x-request-id": "header-only",
          },
        }),
      ),
    );
    await expect(api.get("/api/c")).rejects.toMatchObject({
      headerRequestId: "header-only",
    });

    expect(
      vi
        .mocked(logger.warn)
        .mock.calls.filter(
          ([name]) => name === "api.request_id_correlation_mismatch",
        ),
    ).toHaveLength(0);
  });
});
