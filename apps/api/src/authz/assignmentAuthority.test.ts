import { describe, expect, it } from "vitest";
import { Permission, Role } from "@exam/authz";
import {
  deriveAssignmentAuthority,
  type AuthorityInputRow,
} from "./assignmentAuthority.js";

/**
 * Pure unit tests for {@link deriveAssignmentAuthority} (RBAC-M10-E Commit 1).
 *
 * No DB. Each fixture is a hand-built row list; assertions target the
 * discriminated {@link AssignmentAuthorityResult} contract. These are the
 * mutation-killing assertions referenced by the E12-B (multiple primary),
 * E13 (zero primary), and E14 (DB error is in loadAssignmentAuthority) tests.
 */

const ORG = "org-1";
const USER = "user-1";

function row(
  overrides: Partial<AuthorityInputRow> & Pick<AuthorityInputRow, "role">,
): AuthorityInputRow {
  return {
    id: `id-${overrides.role}-${Math.random().toString(36).slice(2, 8)}`,
    organizationId: ORG,
    userId: USER,
    isPrimary: false,
    isActive: true,
    ...overrides,
  };
}

describe("deriveAssignmentAuthority — pure kernel", () => {
  describe("happy paths", () => {
    it("derives a single primary Candidate authority with Candidate preset caps", () => {
      const r = deriveAssignmentAuthority(
        [row({ role: Role.Candidate, isPrimary: true })],
        ORG,
        USER,
      );
      expect(r).toEqual({ ok: true, authority: expect.any(Object) });
      if (!r.ok) return;
      expect(r.authority.primaryRole).toBe(Role.Candidate);
      expect(r.authority.activeRoles).toEqual([Role.Candidate]);
      // Candidate preset includes ExamTake + ScoreOwnView (at minimum).
      expect(r.authority.capabilities).toContain(Permission.ExamTake);
      expect(r.authority.capabilities).toContain(Permission.ScoreOwnView);
      expect(r.authority.assignmentIds).toHaveLength(1);
    });

    it("merges a multi-role union: primary Candidate + secondary Teacher", () => {
      const r = deriveAssignmentAuthority(
        [
          row({ role: Role.Candidate, isPrimary: true }),
          row({ role: Role.Teacher, isPrimary: false }),
        ],
        ORG,
        USER,
      );
      if (!r.ok) throw new Error("expected ok");
      // Primary is the Candidate row; both roles contribute capabilities.
      expect(r.authority.primaryRole).toBe(Role.Candidate);
      expect(r.authority.activeRoles).toEqual([Role.Teacher, Role.Candidate]);
      // Candidate-only cap (ExamTake) + Teacher-only cap (CourseCreate) both present.
      expect(r.authority.capabilities).toContain(Permission.ExamTake);
      expect(r.authority.capabilities).toContain(Permission.CourseCreate);
      // Admin-only cap is absent.
      expect(r.authority.capabilities).not.toContain(Permission.UserDelete);
    });

    it("does NOT constrain the union by primary role (primary Candidate keeps Teacher caps)", () => {
      // E6 / task §3.3 / §10: promoting a secondary role to primary MUST NOT
      // change effective capabilities — only the projection changes.
      const before = deriveAssignmentAuthority(
        [
          row({ role: Role.Candidate, isPrimary: true }),
          row({ role: Role.Teacher, isPrimary: false }),
        ],
        ORG,
        USER,
      );
      const after = deriveAssignmentAuthority(
        [
          row({ role: Role.Candidate, isPrimary: false }),
          row({ role: Role.Teacher, isPrimary: true }),
        ],
        ORG,
        USER,
      );
      if (!before.ok || !after.ok) throw new Error("expected both ok");
      expect(before.authority.capabilities).toEqual(
        after.authority.capabilities,
      );
      expect(before.authority.activeRoles).toEqual(after.authority.activeRoles);
      expect(before.authority.primaryRole).toBe(Role.Candidate);
      expect(after.authority.primaryRole).toBe(Role.Teacher);
    });

    it("produces STABLE capability ordering regardless of row order", () => {
      const a = deriveAssignmentAuthority(
        [
          row({ role: Role.Grader, isPrimary: false }),
          row({ role: Role.Candidate, isPrimary: true }),
          row({ role: Role.Teacher, isPrimary: false }),
        ],
        ORG,
        USER,
      );
      const b = deriveAssignmentAuthority(
        [
          row({ role: Role.Teacher, isPrimary: false }),
          row({ role: Role.Candidate, isPrimary: true }),
          row({ role: Role.Grader, isPrimary: false }),
        ],
        ORG,
        USER,
      );
      if (!a.ok || !b.ok) throw new Error("expected both ok");
      expect(a.authority.capabilities).toEqual(b.authority.capabilities);
      expect(a.authority.activeRoles).toEqual(b.authority.activeRoles);
    });

    it("dedupes capabilities shared across roles (no duplicates in union)", () => {
      // Multiple roles may share ExamView; the union must not list it twice.
      const r = deriveAssignmentAuthority(
        [
          row({ role: Role.Admin, isPrimary: true }),
          row({ role: Role.Teacher, isPrimary: false }),
        ],
        ORG,
        USER,
      );
      if (!r.ok) throw new Error("expected ok");
      const examViewCount = r.authority.capabilities.filter(
        (c) => c === Permission.ExamView,
      ).length;
      expect(examViewCount).toBe(1);
    });
  });

  describe("fail-closed integrity errors", () => {
    it("returns no_active_assignments (NOT a throw) when the active set is empty", () => {
      // E10 / task §3.6 / P1-2: empty active set is a normal runtime outcome.
      const fromEmpty = deriveAssignmentAuthority([], ORG, USER);
      expect(fromEmpty).toEqual({ ok: false, reason: "no_active_assignments" });

      const onlyInactive = deriveAssignmentAuthority(
        [row({ role: Role.Candidate, isPrimary: true, isActive: false })],
        ORG,
        USER,
      );
      expect(onlyInactive).toEqual({
        ok: false,
        reason: "no_active_assignments",
      });
    });

    it("ignores inactive assignments entirely (does NOT include inactive Admin)", () => {
      // E7: primary Candidate active + secondary Admin INACTIVE -> Admin caps absent.
      const r = deriveAssignmentAuthority(
        [
          row({ role: Role.Candidate, isPrimary: true }),
          row({ role: Role.Admin, isPrimary: false, isActive: false }),
        ],
        ORG,
        USER,
      );
      if (!r.ok) throw new Error("expected ok");
      expect(r.authority.activeRoles).toEqual([Role.Candidate]);
      expect(r.authority.capabilities).not.toContain(Permission.UserDelete);
    });

    it("fails closed on multiple active primaries (multiple_primary)", () => {
      // E12-B: the runtime MUST detect corruption a .limit(1) primary lookup would hide.
      const r = deriveAssignmentAuthority(
        [
          row({ role: Role.Candidate, isPrimary: true }),
          row({ role: Role.Admin, isPrimary: true }),
        ],
        ORG,
        USER,
      );
      expect(r).toEqual({ ok: false, reason: "multiple_primary" });
    });

    it("fails closed on active rows but zero primary (zero_primary_with_active)", () => {
      // E13.
      const r = deriveAssignmentAuthority(
        [
          row({ role: Role.Candidate, isPrimary: false }),
          row({ role: Role.Teacher, isPrimary: false }),
        ],
        ORG,
        USER,
      );
      expect(r).toEqual({ ok: false, reason: "zero_primary_with_active" });
    });

    it("fails closed on an unknown role string (unknown_role)", () => {
      // A backfill mistake or hand-edited row must never widen access.
      const r = deriveAssignmentAuthority(
        [row({ role: "SuperAdmin", isPrimary: true })],
        ORG,
        USER,
      );
      expect(r).toEqual({ ok: false, reason: "unknown_role" });
    });

    it("fails closed on dual active Admin + Maintainer (dual_admin_maintainer — D14 read-side, F-05)", () => {
      // The write-side seam makes this unreachable through the product; a
      // hand-edited / bypass-written row set must still fail closed in the
      // kernel (the single chokepoint login + authenticate traverse) — the
      // union authority would otherwise grant the full Admin set to a
      // Maintainer account. Primary Admin + secondary active Maintainer.
      const r = deriveAssignmentAuthority(
        [
          row({ role: Role.Admin, isPrimary: true }),
          row({ role: Role.Maintainer, isPrimary: false }),
        ],
        ORG,
        USER,
      );
      expect(r).toEqual({ ok: false, reason: "dual_admin_maintainer" });
    });

    it("fails closed on dual active Admin + Maintainer regardless of which is primary (F-05)", () => {
      // Primary Maintainer + secondary active Admin — same forbidden pair.
      const r = deriveAssignmentAuthority(
        [
          row({ role: Role.Maintainer, isPrimary: true }),
          row({ role: Role.Admin, isPrimary: false }),
        ],
        ORG,
        USER,
      );
      expect(r).toEqual({ ok: false, reason: "dual_admin_maintainer" });
    });

    it("fails closed on dual active Admin + Maintainer when both are secondary (zero_primary_with_active fires first)", () => {
      // Edge: with neither primary, the zero-primary check fires before the
      // D14 check. The pair is still rejected (never ok) — this pins the
      // precedence so a future reorder cannot accidentally admit the pair.
      const r = deriveAssignmentAuthority(
        [
          row({ role: Role.Admin, isPrimary: false }),
          row({ role: Role.Maintainer, isPrimary: false }),
        ],
        ORG,
        USER,
      );
      expect(r).toEqual({ ok: false, reason: "zero_primary_with_active" });
    });

    it("does NOT reject Admin alone or Maintainer alone (F-05 scope)", () => {
      // The D14 check forbids ONLY the {Admin, Maintainer} pair — each role
      // alone must still derive normally.
      const admin = deriveAssignmentAuthority(
        [row({ role: Role.Admin, isPrimary: true })],
        ORG,
        USER,
      );
      expect(admin.ok).toBe(true);
      const maintainer = deriveAssignmentAuthority(
        [row({ role: Role.Maintainer, isPrimary: true })],
        ORG,
        USER,
      );
      expect(maintainer.ok).toBe(true);
    });

    it("does NOT reject Maintainer combined with a non-Admin role (D14 scope — F-05)", () => {
      // Only Admin ∩ Maintainer is forbidden (D14). Maintainer + Teacher is an
      // allowed union (the designed union model) and must derive successfully.
      const r = deriveAssignmentAuthority(
        [
          row({ role: Role.Maintainer, isPrimary: true }),
          row({ role: Role.Teacher, isPrimary: false }),
        ],
        ORG,
        USER,
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // activeRoles is stable-sorted by canonical ROLE_ORDER (Teacher < Maintainer).
      expect(r.authority.activeRoles).toEqual([Role.Teacher, Role.Maintainer]);
    });

    it("fails closed on a cross-org row (subject_mismatch)", () => {
      // E11 / task §3.5: a row for a different org must never contribute.
      const r = deriveAssignmentAuthority(
        [
          row({
            role: Role.Admin,
            isPrimary: true,
            organizationId: "foreign-org",
          }),
        ],
        ORG,
        USER,
      );
      expect(r).toEqual({ ok: false, reason: "subject_mismatch" });
    });

    it("fails closed on a cross-user row (subject_mismatch)", () => {
      const r = deriveAssignmentAuthority(
        [
          row({
            role: Role.Admin,
            isPrimary: true,
            userId: "different-user",
          }),
        ],
        ORG,
        USER,
      );
      expect(r).toEqual({ ok: false, reason: "subject_mismatch" });
    });
  });
});
