import { describe, expect, it } from "vitest";
import {
  buildInviteAcceptLink,
  buildPasswordResetLink,
} from "./identityLinks.js";
import {
  renderPasswordResetEmail,
  renderStaffInvitationEmail,
  STAFF_ROLE_LABELS_ZH,
} from "./identityEmails.js";

const ORIGIN = "https://exam.example.local";

describe("identity links (#297)", () => {
  it("builds token-carrier URLs on fixed site-relative paths", () => {
    const invite = buildInviteAcceptLink("abc_def-123", ORIGIN);
    expect(invite).toBe(`${ORIGIN}/invite/accept?token=abc_def-123`);

    const reset = buildPasswordResetLink("x/y?z", ORIGIN);
    expect(reset).toBe(`${ORIGIN}/reset-password?token=x%2Fy%3Fz`);
  });

  it("refuses a non-absolute or path-bearing origin", () => {
    expect(() => buildInviteAcceptLink("t", "exam.example.local")).toThrow();
    expect(() => buildInviteAcceptLink("t", "https://h/path/")).toThrow();
    expect(() => buildPasswordResetLink("t", "javascript:alert(1)")).toThrow();
  });
});

describe("identity email renderers (#297)", () => {
  it("renders the invitation email with a zh role label and the link", () => {
    const rendered = renderStaffInvitationEmail({
      role: "Teacher",
      acceptUrl: `${ORIGIN}/invite/accept?token=abc`,
      expiresInDays: 7,
    });
    expect(rendered.subject).toContain("邀请");
    expect(rendered.bodyText).toContain(STAFF_ROLE_LABELS_ZH.Teacher);
    expect(rendered.bodyText).toContain(`${ORIGIN}/invite/accept?token=abc`);
  });

  it("HTML-escapes interpolated values in bodyHtml", () => {
    const rendered = renderPasswordResetEmail({
      resetUrl: `${ORIGIN}/reset-password?token=a"b<c>`,
      expiresInMinutes: 60,
    });
    // The quotes/angle brackets of the token must not appear raw in HTML.
    expect(rendered.bodyHtml).not.toContain('a"b<c>');
    expect(rendered.bodyHtml).toContain("60 分钟内有效");
  });

  it("falls back to the raw role string for an unknown role", () => {
    const rendered = renderStaffInvitationEmail({
      role: "FutureRole",
      acceptUrl: `${ORIGIN}/invite/accept?token=abc`,
      expiresInDays: 7,
    });
    expect(rendered.bodyText).toContain("FutureRole");
  });
});
