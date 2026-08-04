import { describe, expect, it } from "vitest";
import { permissionsForRole } from "@exam/authz";
import type { MeResponse } from "@exam/contracts";
import {
  ADMIN_ROUTE_CAPABILITIES,
  adminRelativePath,
  canAccessAdminRoute,
  matchAdminRoute,
  routeCapabilityForPath,
} from "@/lib/adminRouteCapabilities";

const baseUser = (overrides: Partial<MeResponse> = {}): MeResponse => ({
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000010",
  username: "x",
  name: "x",
  role: "Admin",
  capabilities: [...permissionsForRole("Admin")],
  ...overrides,
});

const admin = baseUser();
const teacher = baseUser({
  role: "Teacher",
  capabilities: [...permissionsForRole("Teacher")],
});
const candidate = baseUser({
  role: "Candidate",
  capabilities: [...permissionsForRole("Candidate")],
});
const grader = baseUser({
  role: "Grader",
  capabilities: [...permissionsForRole("Grader")],
});
const proctor = baseUser({
  role: "Proctor",
  capabilities: [...permissionsForRole("Proctor")],
});

// Multi-role: primary Candidate + secondary Teacher (capability union).
const candidatePlusTeacher = baseUser({
  role: "Candidate",
  capabilities: [
    ...permissionsForRole("Candidate"),
    ...permissionsForRole("Teacher"),
  ],
});

describe("adminRelativePath", () => {
  it("returns '' for the bare /admin index", () => {
    expect(adminRelativePath("/admin")).toBe("");
  });

  it("strips the /admin/ prefix", () => {
    expect(adminRelativePath("/admin/users")).toBe("users");
    expect(adminRelativePath("/admin/exams/123/edit")).toBe("exams/123/edit");
  });

  it("trims trailing slashes", () => {
    expect(adminRelativePath("/admin/exams/")).toBe("exams");
  });

  it("returns null for paths outside /admin", () => {
    expect(adminRelativePath("/exam/list")).toBeNull();
    expect(adminRelativePath("/login")).toBeNull();
  });
});

describe("matchAdminRoute — specificity (non-fragile matcher)", () => {
  it("matches a static route exactly", () => {
    expect(matchAdminRoute("users").matched?.label).toBe("users");
  });

  it("prefers the static 'exams/new' over parameterized 'exams/:id'", () => {
    // "exams/new" matches BOTH "exams/:id" (1 static + 1 param) and
    // "exams/new" (2 static). The 2-static entry must win.
    expect(matchAdminRoute("exams/new").matched?.label).toBe("exam-create");
  });

  it("prefers 'questions/import' over 'questions/:id/edit' cannot match", () => {
    // "questions/import" matches "questions/import" exactly; it does NOT match
    // "questions/:id/edit" (segment count differs). Verify the static match.
    expect(matchAdminRoute("questions/import").matched?.label).toBe(
      "question-import",
    );
  });

  it("matches 'exams/123' to exam-detail (parameterized)", () => {
    expect(matchAdminRoute("exams/123").matched?.label).toBe("exam-detail");
  });

  it("matches 'exams/123/edit' to exam-edit", () => {
    expect(matchAdminRoute("exams/123/edit").matched?.label).toBe("exam-edit");
  });

  it("matches 'grading-queue/abc' to grading-detail", () => {
    expect(matchAdminRoute("grading-queue/abc").matched?.label).toBe(
      "grading-detail",
    );
  });

  it("returns matched=null for an unmapped admin route (deny-by-default)", () => {
    expect(matchAdminRoute("totally-unknown-route").matched).toBeNull();
    expect(matchAdminRoute("totally-unknown-route").candidates).toEqual([]);
  });
});

describe("routeCapabilityForPath", () => {
  it("returns the required capability for a mapped route", () => {
    expect(routeCapabilityForPath("users")).toBe("user.view");
    expect(routeCapabilityForPath("grading-queue")).toBe("grading.queue.view");
    expect(routeCapabilityForPath("proctor")).toBe("exam_room.view");
  });

  it("returns null for the intentional index route", () => {
    expect(routeCapabilityForPath("")).toBeNull();
  });

  it("returns null for an unmapped route (deny-by-default signal)", () => {
    expect(routeCapabilityForPath("no-such-page")).toBeNull();
  });
});

describe("canAccessAdminRoute — index / unmapped", () => {
  it("allows the index route for any admitted console user (redirect target)", () => {
    expect(canAccessAdminRoute(teacher, "")).toBe(true);
    expect(canAccessAdminRoute(candidate, "")).toBe(true);
  });

  it("denies unmapped admin routes by default (forces registration)", () => {
    expect(canAccessAdminRoute(admin, "no-such-page")).toBe(false);
  });
});

describe("canAccessAdminRoute — Teacher ALLOW (frozen P4 matrix)", () => {
  const allow = [
    "courses",
    "questions",
    "questions/new",
    "questions/import",
    "questions/abc/edit",
    "exams",
    "exams/new",
    "exams/abc",
    "exams/abc/edit",
    "results",
    "exams/abc/scores",
    // P4-R0 §7.7: Teacher holds read-only CandidateView, so the candidates
    // list page is ALLOW (writes are denied by the backend; the page itself
    // is the permitted read surface).
    "candidates",
  ];
  it.each(allow)("Teacher ALLOW: %s", (path) => {
    expect(canAccessAdminRoute(teacher, path)).toBe(true);
  });
});

describe("canAccessAdminRoute — Teacher DENY (frozen P4 matrix)", () => {
  const deny = [
    "dashboard",
    "system",
    "users",
    "candidate-fields",
    "settings",
    "audit-logs",
    "import-logs",
    "grading-queue",
    "grading-queue/abc",
    "proctor",
    "exams/abc/proctor",
    "attempts/abc",
  ];
  it.each(deny)("Teacher DENY: %s", (path) => {
    expect(canAccessAdminRoute(teacher, path)).toBe(false);
  });
});

describe("canAccessAdminRoute — Candidate has no admin route", () => {
  // Candidate is own-scope only; no admin-console page capability.
  it("Candidate cannot access any mapped admin route", () => {
    const sampleRoutes = [
      "dashboard",
      "courses",
      "questions",
      "exams",
      "results",
      "users",
    ];
    for (const path of sampleRoutes) {
      expect(canAccessAdminRoute(candidate, path)).toBe(false);
    }
  });
});

describe("canAccessAdminRoute — Grader / Proctor scoped surfaces", () => {
  it("Grader can access grading queue/detail only", () => {
    expect(canAccessAdminRoute(grader, "grading-queue")).toBe(true);
    expect(canAccessAdminRoute(grader, "grading-queue/abc")).toBe(true);
    // Grader has no course/question/exam-view capability.
    expect(canAccessAdminRoute(grader, "courses")).toBe(false);
    expect(canAccessAdminRoute(grader, "exams")).toBe(false);
    expect(canAccessAdminRoute(grader, "users")).toBe(false);
  });

  it("Proctor can access the proctor workspace only", () => {
    expect(canAccessAdminRoute(proctor, "proctor")).toBe(true);
    expect(canAccessAdminRoute(proctor, "exams/abc/proctor")).toBe(true);
    expect(canAccessAdminRoute(proctor, "exams")).toBe(false);
    expect(canAccessAdminRoute(proctor, "grading-queue")).toBe(false);
  });
});

describe("canAccessAdminRoute — multi-role capability union", () => {
  it("primary Candidate + secondary Teacher can access Teacher pages (union, not primary role)", () => {
    // This is the P4-G-02 multi-role case: the guard must read the capability
    // UNION, not the primary role. The user's primary role is Candidate, but
    // their Teacher assignment grants course/question/exam capabilities.
    expect(canAccessAdminRoute(candidatePlusTeacher, "courses")).toBe(true);
    expect(canAccessAdminRoute(candidatePlusTeacher, "questions")).toBe(true);
    expect(canAccessAdminRoute(candidatePlusTeacher, "exams")).toBe(true);
    expect(canAccessAdminRoute(candidatePlusTeacher, "results")).toBe(true);
    // ...and still denied the Teacher-denied surfaces.
    expect(canAccessAdminRoute(candidatePlusTeacher, "users")).toBe(false);
    expect(canAccessAdminRoute(candidatePlusTeacher, "grading-queue")).toBe(
      false,
    );
  });
});

describe("ADMIN_ROUTE_CAPABILITIES — coverage integrity", () => {
  it("every non-index entry has a non-null capability", () => {
    for (const entry of ADMIN_ROUTE_CAPABILITIES) {
      if (entry.pattern === "") continue;
      expect(
        entry.capability,
        `${entry.label} (${entry.pattern}) must declare a capability`,
      ).not.toBeNull();
    }
  });

  it("no two entries share the same pattern", () => {
    const patterns = ADMIN_ROUTE_CAPABILITIES.map((e) => e.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("every mapped App.tsx /admin/* child route is registered here", () => {
    // The canonical route list from App.tsx (relative to /admin). This guards
    // against a new route being added to App.tsx without a capability entry,
    // which would otherwise be denied-by-default silently.
    const appRoutes = [
      "",
      "dashboard",
      "system",
      "diagnostics",
      "settings",
      "candidate-fields",
      "users",
      "candidates",
      "courses",
      "questions",
      "questions/new",
      "questions/:id/edit",
      "questions/import",
      "exams",
      "exams/new",
      "exams/:id",
      "exams/:id/edit",
      "exams/:id/scores",
      "exams/:id/proctor",
      "proctor",
      "exams/:id/proctor/monitor",
      "results",
      "grading-queue",
      "grading-queue/:id",
      "audit-logs",
      "import-logs",
      "attempts/:id",
      "recovery",
    ];
    const registered = new Set(ADMIN_ROUTE_CAPABILITIES.map((e) => e.pattern));
    for (const r of appRoutes) {
      expect(
        registered.has(r),
        `App.tsx route "${r}" not in capability map`,
      ).toBe(true);
    }
  });
});
