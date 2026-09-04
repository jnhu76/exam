import { describe, expect, it } from "vitest";
import {
  getApiErrorMessage,
  getApiFieldErrors,
  resolveFieldError,
} from "./apiErrors";

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

/**
 * C2 field violation protocol (message contract D0.7/D0.10): first-party
 * field semantics come from the machine `code + params` via the Web
 * catalog; the required server compatibility `message` is only a fallback
 * for unknown codes. Assertions use resolved Chinese (i18n copy policy
 * Rule 3) to verify the full localization pipeline.
 */
describe("resolveFieldError — C2 field violation protocol", () => {
  it("localizes a known code from code + params and ignores the compatibility message (T2/M1 survival property)", () => {
    expect(
      resolveFieldError({
        field: "fields.employeeId",
        code: "REQUIRED",
        params: { label: "身份编号" },
        message: "COMPLETELY DIFFERENT SERVER WORDING",
      }),
    ).toBe("身份编号为必填项");
  });

  it("interpolates structured numeric params into the localized copy (T4)", () => {
    expect(
      resolveFieldError({
        field: "score",
        code: "TOO_SMALL",
        params: { minimum: 3 },
        message: "SERVER WORDING",
      }),
    ).toBe("该字段不能小于 3");
  });

  it("localizes the referenced resource from the resource param (T8)", () => {
    expect(
      resolveFieldError({
        field: "profileId",
        code: "RESOURCE_NOT_FOUND",
        params: { resource: "examProfile" },
        message: "SERVER WORDING",
      }),
    ).toBe("考试策略模板不存在");
    expect(
      resolveFieldError({
        field: "courseId",
        code: "RESOURCE_NOT_FOUND",
        params: { resource: "course" },
        message: "SERVER WORDING",
      }),
    ).toBe("课程不存在");
  });

  it("falls back to the compatibility message for an unknown future code without crashing (T5/M4)", () => {
    expect(
      resolveFieldError({
        field: "x",
        code: "FUTURE_NEW_FIELD_ERROR",
        message: "服务器兼容文案",
      }),
    ).toBe("服务器兼容文案");
  });

  it("uses the generic localized fallback when an unknown code carries no message (T5)", () => {
    expect(
      resolveFieldError({
        field: "x",
        code: "FUTURE_NEW_FIELD_ERROR",
        message: "",
      }),
    ).toBe("该字段填写有误，请检查后重试");
  });

  it("treats a missing code as unknown for legacy payloads", () => {
    expect(resolveFieldError({ field: "x", message: "legacy 文案" })).toBe(
      "legacy 文案",
    );
  });

  it("getApiFieldErrors resolves every field through the machine code, never the server wording (T2)", () => {
    expect(
      getApiFieldErrors({
        details: {
          fields: [
            {
              field: "courseId",
              code: "RESOURCE_NOT_FOUND",
              params: { resource: "course" },
              message: "MUTATED SERVER WORDING",
            },
            {
              field: "future",
              code: "NOT_YET_INVENTED",
              message: "未来错误",
            },
          ],
        },
      }),
    ).toEqual({ courseId: "课程不存在", future: "未来错误" });
  });
});
