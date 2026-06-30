import { describe, it, expect } from "vitest";
import {
  SYSTEM_ACTOR_IDS,
  SYSTEM_PERMISSIONS,
  createSystemRequestContext,
} from "./systemActor.js";
import { Role, Permission } from "./catalog.js";

describe("SYSTEM-M1 system actor — stable actor ids", () => {
  it("exposes the two scanner actor ids", () => {
    expect(SYSTEM_ACTOR_IDS.DeadlineScanner).toBe("system:deadline-scanner");
    expect(SYSTEM_ACTOR_IDS.Heartbeat).toBe("system:heartbeat");
  });

  it("actor ids are unique", () => {
    const ids = Object.values(SYSTEM_ACTOR_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("SYSTEM-M1 system actor — System role's real grants (dotted)", () => {
  it("SYSTEM_PERMISSIONS is exactly the 3 system-only perms", () => {
    const perms = new Set(SYSTEM_PERMISSIONS);
    expect(perms.size).toBe(3);
    expect(perms.has(Permission.SystemAutoSubmit)).toBe(true);
    expect(perms.has(Permission.SystemHeartbeatScan)).toBe(true);
    expect(perms.has(Permission.SystemLifecycleReconcile)).toBe(true);
  });
});

describe("SYSTEM-M1 system actor — createSystemRequestContext", () => {
  it("returns role=System (NOT Admin) — the core SYSTEM-M1 invariant", () => {
    const ctx = createSystemRequestContext(
      "org-1",
      SYSTEM_ACTOR_IDS.DeadlineScanner,
    );
    expect(ctx.role).toBe(Role.System);
    expect(ctx.role).not.toBe("Admin");
  });

  it("anchors organizationId + sets actorId + sessionId = actorId", () => {
    const ctx = createSystemRequestContext(
      "org-7",
      SYSTEM_ACTOR_IDS.DeadlineScanner,
    );
    expect(ctx.organizationId).toBe("org-7");
    expect(ctx.actorId).toBe("system:deadline-scanner");
    expect(ctx.sessionId).toBe("system:deadline-scanner");
    expect(ctx.targetOrganizationId).toBe("org-7");
  });

  it("keeps legacy ctx.permissions empty (type-correct; system perms are dotted in the preset)", () => {
    const ctx = createSystemRequestContext("org-1", SYSTEM_ACTOR_IDS.Heartbeat);
    expect(ctx.permissions).toEqual([]);
  });

  it("rejects an arbitrary actor id at runtime (audit traceability, ADR sec.3.9 fail-loud)", () => {
    // The compile-time type narrows to SystemActorId, but a stray `as`-cast or
    // untyped input must still fail loud rather than produce an untracked actor.
    expect(() =>
      createSystemRequestContext(
        "org-1",
        "system:evil-scanner" as unknown as never,
      ),
    ).toThrow(/Unknown system actor id/);
  });
});
