import { describe, it, expect } from "vitest";
import {
  sanitizeClientEvent,
  sanitizeMetadata,
} from "../sanitizeClientEvent.js";

describe("sanitizeClientEvent", () => {
  it("returns empty object for undefined / null / non-object", () => {
    expect(sanitizeClientEvent(undefined)).toEqual({});
    expect(sanitizeClientEvent(null as unknown as undefined)).toEqual({});
    expect(sanitizeClientEvent(5 as unknown as undefined)).toEqual({});
    expect(sanitizeClientEvent("hi" as unknown as undefined)).toEqual({});
  });

  it("passes through safe keys", () => {
    expect(sanitizeClientEvent({ foo: "bar", count: 3, ok: true })).toEqual({
      foo: "bar",
      count: 3,
      ok: true,
    });
  });

  it("redacts denylisted credential keys (case-insensitive substring)", () => {
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

describe("sanitizeMetadata — structure preservation (H3, M9, M10)", () => {
  it("carries arrays through verbatim (no __array wrapper)", () => {
    const out = sanitizeMetadata({
      items: [{ token: "x", name: "a" }, { name: "b" }],
      tags: ["x", "y"],
    });
    // Arrays must remain arrays at their original path.
    expect(Array.isArray(out.items)).toBe(true);
    expect(out.items).toEqual([
      { token: "[redacted]", name: "a" },
      { name: "b" },
    ]);
    expect(Array.isArray(out.tags)).toBe(true);
    expect(out.tags).toEqual(["x", "y"]);
  });

  it("preserves primitive values at max depth instead of dropping them", () => {
    // { a: { b: { c: { d: { e: 42 } } } } } — e sits at depth 5.
    const out = sanitizeMetadata({ a: { b: { c: { d: { e: 42 } } } } });
    expect(out.a.b.c.d.e).toBe(42);
  });

  it("returns primitive values as-is when called at depth on a primitive", () => {
    // The recursive walk may invoke sanitizeMetadata on a primitive child.
    // It must return the primitive, not {}.
    expect(sanitizeMetadata("hello")).toBe("hello");
    expect(sanitizeMetadata(7)).toBe(7);
    expect(sanitizeMetadata(true)).toBe(true);
    expect(sanitizeMetadata(null)).toBe(null);
  });
});
