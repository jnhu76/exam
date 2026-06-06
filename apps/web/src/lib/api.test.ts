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
    it("has correct name and status", () => {
      const error = new ApiError(403, "Forbidden");

      expect(error.name).toBe("ApiError");
      expect(error.status).toBe(403);
      expect(error.message).toBe("Forbidden");
      expect(error).toBeInstanceOf(Error);
    });
  });
});
