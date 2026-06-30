import { describe, it, expect } from "vitest";
import {
  resolveSystemScope,
  resolveOrganizationScope,
  isScopeDenied,
  DENY_REASONS,
  type ResolverContext,
} from "./resolver.js";
import { Scope } from "./catalog.js";

const ctx = (over: Partial<ResolverContext> = {}): ResolverContext => ({
  actorId: "user-1",
  organizationId: "org-1",
  ...over,
});

describe("RBAC-M3 resolver — system scope (pure, no DB)", () => {
  it("resolves to system scope with no resource id", () => {
    const r = resolveSystemScope(ctx());
    expect(r.scope).toBe(Scope.System);
    expect(r.organizationId).toBeUndefined();
    expect(isScopeDenied(r)).toBe(false);
  });
});

describe("RBAC-M3 resolver — organization scope (pure, anchored to ctx)", () => {
  it("resolves to the actor's organization, anchored", () => {
    const r = resolveOrganizationScope(ctx({ organizationId: "org-9" }));
    expect(r.scope).toBe(Scope.Organization);
    expect(r.organizationId).toBe("org-9");
    expect(isScopeDenied(r)).toBe(false);
  });
});

describe("RBAC-M3 integrity contract — deny-on-inconsistent-chain", () => {
  it("isScopeDenied identifies a denied resolution", () => {
    const denied = {
      denied: true,
      reason: "organization_mismatch",
      detail: "attempt.org !== ctx.org",
    };
    expect(isScopeDenied(denied)).toBe(true);
  });

  it("a successful resolution is not denied", () => {
    expect(isScopeDenied({ scope: Scope.Exam, organizationId: "org-1" })).toBe(
      false,
    );
  });

  it("exposes the ADR sec.22.1/3.4 deny-reason vocabulary", () => {
    // Every reason a sensitive resolver may deny on; this is the contract
    // surface implementation jobs (RBAC-M10 etc.) build against.
    expect(DENY_REASONS).toEqual(
      expect.arrayContaining([
        "organization_mismatch",
        "broken_parent_chain",
        "resource_not_found",
        "ownership_mismatch",
        "resolver_error",
      ]),
    );
  });
});
