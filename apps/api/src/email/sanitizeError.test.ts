import { describe, expect, it } from "vitest";
import { sanitizeEmailError } from "./sanitizeError.js";

describe("sanitizeEmailError", () => {
  it("keeps a nodemailer-style error's name, message, code, command, responseCode", () => {
    const err = Object.assign(
      new Error("Invalid login: 535 5.7.8 Authentication failed"),
      {
        code: "EAUTH",
        command: "AUTH PLAIN",
        response: "535 5.7.8 Authentication failed",
        responseCode: 535,
      },
    );
    const out = sanitizeEmailError(err);
    expect(out).toContain("EAUTH");
    expect(out).toContain("AUTH PLAIN");
    expect(out).toContain("535");
    expect(out).toContain("Authentication failed");
  });

  it("never leaks the SMTP password from message or auth fields", () => {
    const SECRET = "super-secret-password-123";
    const err = Object.assign(new Error(`login failed for pass=${SECRET}`), {
      code: "EAUTH",
      pass: SECRET,
      auth: { user: "u", pass: SECRET },
    });
    // The SMTP caller passes its known password so it is scrubbed even when
    // embedded in free-form message text.
    const out = sanitizeEmailError(err, [SECRET]);
    expect(out).not.toContain(SECRET);
  });

  it("handles a plain Error with no SMTP fields", () => {
    const out = sanitizeEmailError(new Error("boom"));
    expect(out).toContain("boom");
  });

  it("handles a non-Error thrown value (string)", () => {
    const out = sanitizeEmailError("network down");
    expect(typeof out).toBe("string");
    expect(out).toContain("network down");
  });

  it("never stringifies raw transporter config / auth objects", () => {
    const SECRET = "cfg-secret-xyz";
    const err = Object.assign(new Error("send failed"), {
      config: { host: "smtp.x", auth: { pass: SECRET } },
    });
    const out = sanitizeEmailError(err);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain("smtp.x");
  });
});
