import { describe, expect, it } from "vitest";
import { z, ZodError, type ZodIssue } from "zod";
import {
  getValidationErrorDetails,
  normalizeErrorCode,
} from "./errorResponse.js";

describe("normalizeErrorCode", () => {
  it("maps an unrecognized 503 response to AUTHZ_UNAVAILABLE", () => {
    expect(normalizeErrorCode(undefined, 503)).toBe("AUTHZ_UNAVAILABLE");
  });
});

/**
 * Message contract D0.7 (C2): Zod route validation emits the machine
 * contract (field path, code, structured params) plus the required
 * non-authoritative compatibility message. Machine semantics derive ONLY
 * from structured issue properties — never from issue.message text.
 */
describe("getValidationErrorDetails — Zod machine semantics (C2)", () => {
  function detailsFor(issue: ZodIssue) {
    const details = getValidationErrorDetails(new ZodError([issue]));
    expect(details.fields).toHaveLength(1);
    return details.fields[0]!;
  }

  it("carries a stable code, the dot path, and structured params for too_small (T1)", () => {
    const field = detailsFor({
      code: "too_small",
      minimum: 1,
      type: "number",
      inclusive: false,
      path: ["score"],
      message: "Too small",
    });
    expect(field.field).toBe("score");
    expect(field.code).toBe("TOO_SMALL");
    expect(field.params).toEqual({ minimum: 1 });
    // T6: the compatibility message stays present and non-empty.
    expect(field.message.length).toBeGreaterThan(0);
  });

  // T-R1/T-R2 anchors: the real Zod issue shapes behind the Web TOO_SMALL /
  // TOO_BIG regressions. The wire intentionally keeps only `minimum`/`maximum`
  // — `type`/`inclusive`/`exact` never cross the wire, so Web copy must not
  // state a numeric inequality these inputs do not determine.
  it("anchors the exclusive-bound wire fact: positive() → TOO_SMALL + {minimum: 0} (T-R1)", () => {
    const parse = z.number().positive().safeParse(0);
    const field = detailsFor(parse.error!.issues[0]!);
    expect(field.code).toBe("TOO_SMALL");
    expect(field.params).toEqual({ minimum: 0 });
  });

  it("anchors the non-numeric wire fact: string.min(1) → TOO_SMALL + {minimum: 1} (T-R2)", () => {
    const parse = z.string().min(1).safeParse("");
    const field = detailsFor(parse.error!.issues[0]!);
    expect(field.code).toBe("TOO_SMALL");
    expect(field.params).toEqual({ minimum: 1 });
  });

  it("derives invalid_type params from the structured expected/received", () => {
    const field = detailsFor({
      code: "invalid_type",
      expected: "string",
      received: "undefined",
      path: ["title"],
      message: "Required",
    });
    expect(field.code).toBe("INVALID_TYPE");
    expect(field.params).toEqual({ expected: "string", received: "undefined" });
    expect(field.message.length).toBeGreaterThan(0);
  });

  it("carries the named string check for invalid_string", () => {
    const field = detailsFor({
      code: "invalid_string",
      validation: "email",
      path: ["email"],
      message: "Invalid email",
    });
    expect(field.code).toBe("INVALID_STRING");
    expect(field.params).toEqual({ validation: "email" });
  });

  it("keeps invalid_enum_value inside the frozen string|number domain (options array never on the wire)", () => {
    const field = detailsFor({
      code: "invalid_enum_value",
      options: ["single_choice", "true_false"],
      received: "essay",
      path: ["type"],
      message: "Invalid option value",
    });
    expect(field.code).toBe("INVALID_ENUM_VALUE");
    expect(field.params).toEqual({ received: "essay" });
  });

  it("omits params entirely when the issue carries no in-domain structured fact", () => {
    const field = detailsFor({
      code: "custom",
      path: ["tags"],
      message: "Bad tags",
    });
    expect(field.code).toBe("CUSTOM");
    expect(field.params).toBeUndefined();
  });

  it("emits one entry per issue with dot-index paths (current convention, path migration deferred)", () => {
    const details = getValidationErrorDetails(
      new ZodError([
        {
          code: "too_small",
          minimum: 1,
          type: "number",
          inclusive: true,
          path: ["questions", 0, "options", 1, "score"],
          message: "Too small",
        },
        {
          code: "invalid_type",
          expected: "string",
          received: "number",
          path: ["title"],
          message: "Expected string",
        },
      ]),
    );
    expect(details.fields.map((f) => f.field)).toEqual([
      "questions.0.options.1.score",
      "title",
    ]);
    expect(details.fields.every((f) => f.message.length > 0)).toBe(true);
  });
});
