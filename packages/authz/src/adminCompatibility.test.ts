import { describe, it, expect } from "vitest";
import { ROLE_PRESETS } from "./presets.js";
import { Role, Scope } from "./catalog.js";

// Preset-membership coverage for Admin-gated routes is derived from the route
// registry in apps/api/src/authz/adminSuperset.test.ts, and the Admin
// grant/forbid boundaries live in presets-boundaries.test.ts (boundary #1).
// This file keeps only the preset-metadata pins with no other owner.
describe("RBAC-M6 — Admin preset metadata", () => {
  it("Admin default scope is organization (single-tenant boundary)", () => {
    expect(ROLE_PRESETS[Role.Admin].defaultScope).toBe(Scope.Organization);
  });
});

describe("RBAC-M6 — last-admin guard contract (ADR §3.2)", () => {
  it("Admin is assignable + login-capable (so it can satisfy the guard)", () => {
    expect(ROLE_PRESETS[Role.Admin].assignable).toBe(true);
    expect(ROLE_PRESETS[Role.Admin].loginAllowed).toBe(true);
  });

  it("System does NOT count toward the last-admin guard (non-human, non-login)", () => {
    // ADR §3.2 #4: System actor does not count toward the last-admin guard.
    expect(ROLE_PRESETS[Role.System].loginAllowed).toBe(false);
    expect(ROLE_PRESETS[Role.System].assignable).toBe(false);
  });
});
