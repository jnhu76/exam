import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatZodError } from "./helpers.js";

// C1-E (message contract D0.5/D0.13): the handler-level Zod fallback emits
// the canonical registry compatibility message as the top-level message —
// the former English joined-issue override channel is gone. Field-level
// messages remain producer-local Zod text until C2.
describe("formatZodError", () => {
  it("emits the canonical compat message with field details", () => {
    const parsed = z.object({ page: z.number().min(1) }).safeParse({ page: 0 });
    if (parsed.success) throw new Error("expected validation failure");

    const body = formatZodError("req-1", parsed.error);

    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("请求参数无效");
    expect(body.error.requestId).toBe("req-1");
    expect(body.error.details).toMatchObject({
      fields: [{ field: "page", code: "TOO_SMALL" }],
    });
    const fields = (
      body.error.details as { fields: Array<{ message: string }> }
    ).fields;
    expect(typeof fields[0]?.message).toBe("string");
  });
});
