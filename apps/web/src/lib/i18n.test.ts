import { describe, it, expect } from "vitest";
import { ApiError } from "./api";
import { resolveErrorMessage } from "./i18n";

describe("resolveErrorMessage", () => {
  it("returns localized message for known error code", () => {
    const err = new ApiError(401, "server zh-CN", "AUTH_REQUIRED");
    expect(resolveErrorMessage(err)).toBe("请先登录");
  });

  it("falls back to err.message when code is unknown", () => {
    const err = new ApiError(500, "server raw text", "UNKNOWN_CODE");
    expect(resolveErrorMessage(err)).toBe("server raw text");
  });

  it("falls back to err.message when code is undefined", () => {
    const err = new ApiError(500, "some message");
    expect(resolveErrorMessage(err)).toBe("some message");
  });

  it("returns err.message for generic Error without code", () => {
    const err = new Error("something broke");
    expect(resolveErrorMessage(err)).toBe("something broke");
  });

  it("returns default message for generic Error with empty message", () => {
    const err = new Error("");
    expect(resolveErrorMessage(err)).toBe("操作失败，请重试");
  });

  it("returns default message for ApiError with empty message and no code", () => {
    const err = new ApiError(500, "");
    expect(resolveErrorMessage(err)).toBe("操作失败，请重试");
  });

  it("returns default message for unknown error type", () => {
    expect(resolveErrorMessage("string error")).toBe("操作失败，请重试");
  });

  it("returns default message for null/undefined", () => {
    expect(resolveErrorMessage(null)).toBe("操作失败，请重试");
    expect(resolveErrorMessage(undefined)).toBe("操作失败，请重试");
  });

  it("uses server message as fallback when code exists but locale lookup fails", () => {
    const err = new ApiError(400, "自定义服务端消息", "NONEXISTENT_CODE");
    expect(resolveErrorMessage(err)).toBe("自定义服务端消息");
  });
});
