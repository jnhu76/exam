import { describe, expect, it } from "vitest";
import { getApiErrorMessage, getApiFieldErrors } from "./apiErrors";

describe("apiErrors", () => {
  it("reads messages from Error instances", () => {
    expect(getApiErrorMessage(new Error("保存失败"))).toBe("保存失败");
  });

  it("reads messages from plain API error objects", () => {
    expect(getApiErrorMessage({ message: "字段名已存在" })).toBe(
      "字段名已存在",
    );
  });

  it("falls back when no message is available", () => {
    expect(getApiErrorMessage({ code: "VALIDATION_ERROR" }, "默认错误")).toBe(
      "默认错误",
    );
  });

  it("maps validation field details", () => {
    expect(
      getApiFieldErrors({
        details: {
          fields: [
            { field: "name", message: "请输入名称" },
            { field: "ignored" },
          ],
        },
      }),
    ).toEqual({ name: "请输入名称" });
  });
});
