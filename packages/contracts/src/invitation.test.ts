import {
  AcceptInvitationRequestSchema,
  CreateStaffInvitationRequestSchema,
  PasswordResetConsumeRequestSchema,
  PasswordResetRequestSchema,
  StaffInvitationRoleSchema,
  identityTokenField,
} from "./invitation.js";
import { describe, expect, it } from "vitest";

describe("identity lifecycle contracts (#297)", () => {
  it("invitation roles are the assignable set minus Candidate", () => {
    expect(StaffInvitationRoleSchema.options).toEqual([
      "Admin",
      "Teacher",
      "Proctor",
      "Grader",
      "Maintainer",
    ]);
  });

  it("create-invitation requires a valid, non-blank email and a staff role", () => {
    const ok = CreateStaffInvitationRequestSchema.parse({
      email: " teacher@example.com ",
      role: "Teacher",
    });
    expect(ok.email).toBe("teacher@example.com");

    expect(() =>
      CreateStaffInvitationRequestSchema.parse({ email: "  ", role: "Admin" }),
    ).toThrow();

    expect(() =>
      CreateStaffInvitationRequestSchema.parse({
        email: "teacher@example.com",
        role: "Candidate",
      }),
    ).toThrow();
  });

  it("acceptance requires a token, credentials, and a policy-compliant password", () => {
    const ok = AcceptInvitationRequestSchema.parse({
      token: identityTokenField().parse("x".repeat(43)),
      username: "invited",
      name: "受邀人",
      password: "Sup3rSecret!",
    });
    expect(ok.username).toBe("invited");

    expect(() =>
      AcceptInvitationRequestSchema.parse({
        token: "short",
        username: "invited",
        name: "n",
        password: "Sup3rSecret!",
      }),
    ).toThrow();
    expect(() =>
      AcceptInvitationRequestSchema.parse({
        token: identityTokenField().parse("x".repeat(43)),
        username: "ab",
        name: "n",
        password: "Sup3rSecret!",
      }),
    ).toThrow();
    expect(() =>
      AcceptInvitationRequestSchema.parse({
        token: identityTokenField().parse("x".repeat(43)),
        username: "invited",
        name: "n",
        password: "short",
      }),
    ).toThrow();
  });

  it("reset request is username-keyed; consume requires token + password", () => {
    expect(PasswordResetRequestSchema.parse({ username: "someone" })).toEqual({
      username: "someone",
    });

    const consume = PasswordResetConsumeRequestSchema.parse({
      token: identityTokenField().parse("y".repeat(43)),
      password: "NewPassword1!",
    });
    expect(consume.password).toBe("NewPassword1!");

    expect(() =>
      PasswordResetConsumeRequestSchema.parse({ token: "y".repeat(43) }),
    ).toThrow();
  });
});
