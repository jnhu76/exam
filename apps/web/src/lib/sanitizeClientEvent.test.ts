import { describe, it, expect } from "vitest";
import { sanitizeClientEvent, sanitizeMetadata } from "./sanitizeClientEvent";

describe("sanitizeClientEvent", () => {
  it("returns empty object for undefined", () => {
    expect(sanitizeClientEvent(undefined)).toEqual({});
  });

  it("passes through safe keys", () => {
    expect(sanitizeClientEvent({ foo: "bar", count: 3, ok: true })).toEqual({
      foo: "bar",
      count: 3,
      ok: true,
    });
  });

  it("redacts denylisted credential keys (case-insensitive)", () => {
    const out = sanitizeClientEvent({
      password: "secret",
      UserToken: "abc",
      authorization: "Bearer x",
      cookie: "session=1",
      authToken: "y",
    });
    expect(out).toEqual({
      password: "[redacted]",
      UserToken: "[redacted]",
      authorization: "[redacted]",
      cookie: "[redacted]",
      authToken: "[redacted]",
    });
  });

  it("redacts denylisted exam-content keys", () => {
    const out = sanitizeClientEvent({
      answer: "A",
      answerText: "some answer",
      content: "question body",
      body: "text",
      questionText: "Q?",
    });
    expect(Object.values(out)).toEqual([
      "[redacted]",
      "[redacted]",
      "[redacted]",
      "[redacted]",
      "[redacted]",
    ]);
  });

  it("redacts nested denylisted keys", () => {
    const out = sanitizeClientEvent({
      request: { url: "/x", headers: { authorization: "Bearer z" } },
    });
    expect(out.request).toEqual({
      url: "/x",
      headers: { authorization: "[redacted]" },
    });
  });

  it("drops non-serializable values (functions/symbols)", () => {
    const out = sanitizeClientEvent({
      cb: () => 1,
      sym: Symbol("s"),
      keep: 1,
    });
    expect(out).toEqual({ keep: 1 });
  });

  it("does not mutate the input", () => {
    const input = { password: "secret", safe: 1 };
    sanitizeClientEvent(input);
    expect(input).toEqual({ password: "secret", safe: 1 });
  });
});

describe("sanitizeMetadata (array handling)", () => {
  it("wraps arrays under __array and redacts within", () => {
    const out = sanitizeMetadata({
      items: [{ token: "x", name: "a" }, { name: "b" }],
    });
    expect(out).toEqual({
      items: {
        __array: [{ token: "[redacted]", name: "a" }, { name: "b" }],
      },
    });
  });
});
