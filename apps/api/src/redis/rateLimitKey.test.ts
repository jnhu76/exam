import { describe, expect, it } from "vitest";
import { createIpDigest, createRateLimitKey } from "./rateLimitKey.js";

describe("rate limit key digest (P7 §13)", () => {
  it("is deterministic for the same IP and secret", () => {
    expect(createIpDigest("10.0.0.7", "secret-a")).toBe(
      createIpDigest("10.0.0.7", "secret-a"),
    );
  });

  it("differs across IPs", () => {
    expect(createIpDigest("10.0.0.7", "secret-a")).not.toBe(
      createIpDigest("10.0.0.8", "secret-a"),
    );
  });

  it("differs across secrets (deployment isolation)", () => {
    expect(createIpDigest("10.0.0.7", "secret-a")).not.toBe(
      createIpDigest("10.0.0.7", "secret-b"),
    );
  });

  it("is stable across instances sharing the deployment secret", () => {
    // Two API processes with the same JWT secret must agree on the key, or
    // the shared limiter would count two independent totals. This is the
    // property the two-instance experiment depends on.
    const a = createIpDigest("10.0.0.7", "shared-secret");
    const b = createIpDigest("10.0.0.7", "shared-secret");
    expect(a).toBe(b);
  });

  it("never contains the raw IP (opaque digest, hex only)", () => {
    const digest = createIpDigest("10.0.0.7", "secret-a");
    expect(digest).not.toContain("10.0.0.7");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles IPv6 literals the same way", () => {
    const digest = createIpDigest("2001:db8::1", "secret-a");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain("2001");
    expect(createIpDigest("2001:db8::1", "secret-a")).toBe(
      createIpDigest("2001:db8::1", "secret-a"),
    );
  });

  it("createRateLimitKey derives the digest from request.ip", () => {
    const request = { ip: "192.168.1.20" } as never;
    expect(createRateLimitKey(request, "secret-a")).toBe(
      createIpDigest("192.168.1.20", "secret-a"),
    );
  });
});
