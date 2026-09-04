import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { ApiError } from "./api";
import {
  getApiErrorMessage,
  getApiFieldErrors,
  resolveFieldError,
} from "./apiErrors";

/**
 * C3 browser message authority tests (message contract D0.10/D0.11 Zone A).
 *
 * Resolution contract under test:
 *   known (code, reason)   → errors.reasons.*
 *   known code             → errors.codes.*
 *   unknown code           → server compat message
 *   nothing usable         → localized generic fallback
 * and known machine semantics must never depend on the server message text.
 */

/** Hand-rolled translator that records resolved keys instead of localizing. */
function makeRecordingT() {
  const calls: Array<{ key: string; options?: unknown }> = [];
  const t = ((key: never, options?: never) => {
    calls.push({ key: key as string, options });
    return `T(${key})`;
  }) as unknown as typeof i18n.t;
  return { t, calls };
}

describe("getApiErrorMessage (Web i18n authority)", () => {
  const t = i18n.t;

  it("T1: known ErrorCode resolves through Web i18n, independent of server wording", () => {
    const error = new ApiError(
      409,
      "服务器措辞被任意改写",
      "RESOURCE_CONFLICT",
      undefined,
      "req-t1",
      "服务器措辞被任意改写",
    );
    expect(getApiErrorMessage(error, t)).toBe(
      i18n.t("errors.codes.resourceConflict"),
    );
    expect(getApiErrorMessage(error, t)).not.toBe("服务器措辞被任意改写");
  });

  it("T1: known code uses the Web-owned catalog copy, not the registry text", () => {
    // The Web catalog deliberately does not echo the contracts registry
    // wording for VALIDATION_ERROR; asserting the exact Web copy pins Zone A
    // authority at the copy level, not just the key level.
    const error = new ApiError(400, "请求参数无效", "VALIDATION_ERROR");
    expect(getApiErrorMessage(error, t)).toBe("输入内容有误，请检查后重试");
  });

  it("T2: known reason resolves to specific Web copy with wire params", () => {
    const error = new ApiError(409, "资源状态冲突", "RESOURCE_CONFLICT", {
      reason: "COURSE_HAS_QUESTIONS",
      params: { questionCount: 3 },
    });
    expect(getApiErrorMessage(error, t)).toBe(
      "该课程下仍有 3 道题目，无法删除",
    );
  });

  it("T2: COURSE_CODE_EXISTS yields the specific course-code copy", () => {
    const error = new ApiError(409, "资源状态冲突", "RESOURCE_CONFLICT", {
      reason: "COURSE_CODE_EXISTS",
      params: { courseCode: "CS101" },
    });
    expect(getApiErrorMessage(error, t)).toBe("课程代码已存在");
  });

  it("T2/T7: C1 user-management reasons resolve to specific copy instead of 请求参数无效", () => {
    const cases: Array<[string, string]> = [
      ["CANNOT_DISABLE_SELF", "不能停用自己的账号"],
      ["TARGET_USER_INACTIVE", "目标用户已被停用"],
      ["TARGET_NOT_TEACHER", "目标用户不具有教师角色"],
      ["TARGET_NOT_GRADER", "目标用户不具有阅卷员角色"],
      ["ADMIN_MAINTAINER_EXCLUSION", "同一账号不能同时拥有管理员与运维身份"],
    ];
    for (const [reason, expected] of cases) {
      const error = new ApiError(400, "请求参数无效", "VALIDATION_ERROR", {
        reason,
      });
      expect(getApiErrorMessage(error, t)).toBe(expected);
    }
  });

  it("T2/T8: score-path reasons resolve to specific copy instead of 资源状态冲突", () => {
    expect(
      getApiErrorMessage(
        new ApiError(409, "资源状态冲突", "RESOURCE_CONFLICT", {
          reason: "EXAM_NOT_FINISHED",
        }),
        t,
      ),
    ).toBe("考试尚未结束");
    // Real brownfield wire shape (scores/export routes): the dynamic fact is
    // flat on details, NOT inside details.params.
    expect(
      getApiErrorMessage(
        new ApiError(409, "资源状态冲突", "RESOURCE_CONFLICT", {
          reason: "UNRESOLVED_ATTEMPTS_EXIST",
          activeAttemptCount: 2,
        }),
        t,
      ),
    ).toBe("考试仍有 2 场未结束的作答");
  });

  it("T3: known code + unknown reason falls back to code-level Web copy", () => {
    const { t: recordingT, calls } = makeRecordingT();
    const error = new ApiError(409, "资源状态冲突", "RESOURCE_CONFLICT", {
      reason: "FUTURE_CONFLICT_REASON",
    });
    expect(getApiErrorMessage(error, recordingT)).toBe(
      "T(errors.codes.resourceConflict)",
    );
    expect(calls).toEqual([
      { key: "errors.codes.resourceConflict", options: undefined },
    ]);
  });

  it("T4: unknown ErrorCode uses the server compatibility message", () => {
    const error = new ApiError(
      418,
      "上游服务返回的特殊文案",
      "TOTALLY_NEW_CODE_NOT_IN_REGISTRY",
      undefined,
      "req-t4",
      "上游服务返回的特殊文案",
    );
    expect(getApiErrorMessage(error, t)).toBe("上游服务返回的特殊文案");
  });

  it("T5: unknown ErrorCode without a usable server message falls back to the localized generic", () => {
    const error = new ApiError(418, "418 Request failed", "FUTURE_CODE");
    expect(getApiErrorMessage(error, t)).toBe(i18n.t("errors.unknown"));
  });

  it("falls back to the caller fallback when provided", () => {
    const error = new ApiError(418, "418 Request failed", "FUTURE_CODE");
    expect(getApiErrorMessage(error, t, "页面级兜底")).toBe("页面级兜底");
  });

  it("non-ApiError values never surface raw diagnostic prose", () => {
    expect(getApiErrorMessage(new Error("SQLITE_STACK_LEAK"), t)).toBe(
      i18n.t("errors.unknown"),
    );
    expect(getApiErrorMessage(undefined, t)).toBe(i18n.t("errors.unknown"));
  });

  it("every mapped reason emits its errors.reasons.* key with wire params", () => {
    const { t: recordingT, calls } = makeRecordingT();
    // Real brownfield wire shape: flat activeAttemptCount. The exact-options
    // assertion also proves the resolver never wholesale-spreads heterogeneous
    // details (a spread would leak `reason` into the params).
    const error = new ApiError(409, "x", "RESOURCE_CONFLICT", {
      reason: "UNRESOLVED_ATTEMPTS_EXIST",
      activeAttemptCount: 2,
    });
    getApiErrorMessage(error, recordingT);
    expect(calls).toEqual([
      {
        key: "errors.reasons.unresolvedAttemptsExist",
        options: { activeAttemptCount: 2 },
      },
    ]);
  });

  it("close/cancel producers of UNRESOLVED_ATTEMPTS_EXIST stay at code-level copy (deliberate unmapped disposition)", () => {
    // The same flat brownfield shape is emitted by the close/cancel routes
    // under their own codes, but those (code, reason) pairs are deliberately
    // unmapped: the code-level copy is the sufficient presentation there.
    expect(
      getApiErrorMessage(
        new ApiError(409, "x", "EXAM_CLOSE_NOT_ALLOWED", {
          reason: "UNRESOLVED_ATTEMPTS_EXIST",
          activeAttemptCount: 5,
        }),
        t,
      ),
    ).toBe("考试当前状态不允许关闭");
    expect(
      getApiErrorMessage(
        new ApiError(409, "x", "EXAM_CANCEL_NOT_ALLOWED", {
          reason: "UNRESOLVED_ATTEMPTS_EXIST",
          activeAttemptCount: 5,
        }),
        t,
      ),
    ).toBe("考试当前状态不能取消");
  });

  it("T11/M5 guard: known semantics flow through the injected translator, never contracts copy", () => {
    // If the implementation ever reverts to registry-first resolution
    // (server compatibility catalog text), no Web key would be
    // recorded and this assertion fails (mutation M5).
    const { t: recordingT, calls } = makeRecordingT();
    const error = new ApiError(401, "请先登录", "AUTH_REQUIRED");
    expect(getApiErrorMessage(error, recordingT)).toBe(
      "T(errors.codes.authRequired)",
    );
    expect(calls).toEqual([
      { key: "errors.codes.authRequired", options: undefined },
    ]);
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

  // T-R1/T-R2: TOO_SMALL/TOO_BIG copy must stay semantically safe. The wire
  // params carry only `minimum`/`maximum` — the Zod constraint dimensions
  // (type / inclusive / exact) never cross the wire — so any numeric
  // inequality wording would fabricate a constraint the resolver inputs do
  // not determine (e.g. positive() emits minimum 0 with inclusive=false).
  it("renders an exclusive lower bound (positive()) without claiming >= minimum semantics (T-R1)", () => {
    expect(
      resolveFieldError({
        field: "totalScore",
        code: "TOO_SMALL",
        params: { minimum: 0 },
        message: "SERVER WORDING",
      }),
    ).toBe("该字段未满足最小限制");
    expect(
      resolveFieldError({
        field: "durationMinutes",
        code: "TOO_BIG",
        params: { maximum: 1440 },
        message: "SERVER WORDING",
      }),
    ).toBe("该字段未满足最大限制");
  });

  it("renders a non-numeric TOO_SMALL (string min) without numeric inequality wording (T-R2)", () => {
    expect(
      resolveFieldError({
        field: "name",
        code: "TOO_SMALL",
        params: { minimum: 1 },
        message: "SERVER WORDING",
      }),
    ).toBe("该字段未满足最小限制");
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

  it("drops detail entries without a message (legacy shape filter)", () => {
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
