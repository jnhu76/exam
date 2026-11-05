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
      url: "[redacted]",
      headers: { authorization: "[redacted]" },
    });
  });

  it("redacts exception-text carrier keys (message/stack/cause/url)", () => {
    // Raw exception text can embed answers, tokens, or URL query strings, so
    // these carriers are denied wherever the substring appears — including
    // intuitive wrappers like `requestUrl` / `errorMessage`.
    const out = sanitizeClientEvent({
      message: "Boom at /x?token=1",
      stack: "Error: Boom\\n at fn",
      cause: "root failure",
      url: "https://host/path?answer=1",
      errorMessage: "wrapped",
      requestUrl: "https://h/p",
    });
    expect(Object.values(out)).toEqual([
      "[redacted]",
      "[redacted]",
      "[redacted]",
      "[redacted]",
      "[redacted]",
      "[redacted]",
    ]);
  });

  it("redacts exact error/err keys but keeps errorCode/errorName stable codes", () => {
    // `{ error: err }` carries raw exception content and is redacted; the
    // `errorCode` / `errorName` machine-code channel must keep passing so
    // failure telemetry stays queryable.
    const out = sanitizeClientEvent({
      error: "raw exception text",
      err: "raw",
      ERROR: "raw",
      errorCode: "SUBMIT_ERROR",
      errorName: "TypeError",
    });
    expect(out).toEqual({
      error: "[redacted]",
      err: "[redacted]",
      ERROR: "[redacted]",
      errorCode: "SUBMIT_ERROR",
      errorName: "TypeError",
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

describe("sanitizeMetadata — structure preservation", () => {
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

describe("sanitizeClientEvent — value-level credential-shape redaction (#875)", () => {
  // A non-denylisted key can still carry a credential-shaped VALUE (a buggy
  // or hostile client stuffing a token under `note`). The key denylist
  // cannot see that; these shapes are high-confidence (structured JWT /
  // Bearer scheme / URL-with-userinfo) and safe to redact without a
  // general sensitive-content detector.
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  it("redacts a JWT value under an innocent key (top level, nested, and in arrays)", () => {
    const out = sanitizeClientEvent({
      note: `attached ${jwt} for debugging`,
      nested: { carrier: jwt },
      list: [jwt, "keep me"],
    });
    expect(out.note).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).carrier).toBe("[redacted]");
    expect((out.list as unknown[])[0]).toBe("[redacted]");
    expect((out.list as unknown[])[1]).toBe("keep me");
  });

  it("redacts a Bearer-scheme value under an innocent key", () => {
    const out = sanitizeClientEvent({
      header_echo: "bearer abc.def.ghi",
      other: "Basic dXNlcjpwYXNz",
    });
    // Any credential scheme prefix (bearer/basic) is high-confidence.
    expect(out.header_echo).toBe("[redacted]");
    expect(out.other).toBe("[redacted]");
  });

  it("redacts a URL carrying userinfo credentials under an innocent key", () => {
    const out = sanitizeClientEvent({
      dsn: "postgresql://exam:s3cret@db.local:5432/exam",
      cache: "redis://:pw@redis.local:6379/0",
    });
    expect(out.dsn).toBe("[redacted]");
    expect(out.cache).toBe("[redacted]");
  });

  it("keeps legitimate look-alikes verbatim (no over-redaction)", () => {
    const safe = {
      path: "/exam/123",
      link: "https://exam.local/login?next=/dashboard",
      uuid: "b5b1c5a3-4ae1-4aa1-9ffc-543872e2017b",
      sentence: "the answer is unbearably long prose about Bearer tokens",
      fragment: "eyJhbGciOiJIUzI1NiJ9",
      count: 42,
    };
    expect(sanitizeClientEvent(safe)).toEqual(safe);
  });
});
