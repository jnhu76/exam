import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_PENDING_MESSAGE,
  classifyEmailError,
  formatEmailErrorClassification,
  projectStoredEmailError,
  sanitizeEmailError,
  UNDISCLOSED_EMAIL_ERROR,
} from "./sanitizeError.js";

/**
 * #1012 closed-field contract: the output is ALWAYS the canonical
 * `email_error:<category>[ code=<allowlisted>][ rc=<400-599>]` string — raw
 * message/name/stack/response text never survives, no matter what the thrown
 * value carries.
 */
const CANONICAL =
  /^email_error:(smtp_auth_failed|smtp_connection_failed|smtp_recipient_rejected|smtp_send_failed|db_connection_failed|db_error|internal_error)( code=[A-Z0-9_]{2,16})?( rc=\d{3})?$/;

describe("sanitizeEmailError", () => {
  it("classifies an SMTP auth failure and retains only the allowlisted code + response code", () => {
    const out = sanitizeEmailError(
      Object.assign(
        new Error("Invalid login: 535 5.7.8 Authentication failed"),
        {
          code: "EAUTH",
          command: "AUTH PLAIN",
          response: "535 5.7.8 Authentication failed",
          responseCode: 535,
        },
      ),
    );
    expect(out).toBe("email_error:smtp_auth_failed code=EAUTH rc=535");
  });

  it("drops the caller-known SMTP password along with the rest of the free text", () => {
    const SECRET = "super-secret-password-123";
    const err = Object.assign(new Error(`login failed for pass=${SECRET}`), {
      code: "EAUTH",
      pass: SECRET,
      auth: { user: "u", pass: SECRET },
    });
    const out = sanitizeEmailError(err);
    expect(out).not.toContain(SECRET);
    // Free text is not partially kept: only the closed classification.
    expect(out).toBe("email_error:smtp_auth_failed code=EAUTH");
  });

  it("classifies a plain Error with no SMTP fields as a fixed internal category", () => {
    const out = sanitizeEmailError(new Error("boom"));
    expect(out).toBe("email_error:internal_error");
  });

  it("classifies a non-Error thrown value (string) without echoing it", () => {
    const out = sanitizeEmailError("network down");
    expect(out).toBe("email_error:internal_error");
  });

  it("never stringifies raw transporter config / auth objects", () => {
    const SECRET = "cfg-secret-xyz";
    const err = Object.assign(new Error("send failed"), {
      config: { host: "smtp.x", auth: { pass: SECRET } },
    });
    const out = sanitizeEmailError(err);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain("smtp.x");
    expect(out).toBe("email_error:internal_error");
  });

  it("rejects unknown SMTP-shaped codes: a correct shape is not membership", () => {
    const out = sanitizeEmailError(
      Object.assign(new Error("auth failed"), {
        code: "XEAUTH", // shape-compatible, not allowlisted
        responseCode: 535,
      }),
    );
    expect(out).toBe("email_error:smtp_send_failed rc=535");
  });

  it("rejects a string responseCode (nodemailer uses a number)", () => {
    const out = sanitizeEmailError(
      Object.assign(new Error("rejected"), { responseCode: "550" }),
    );
    expect(out).toBe("email_error:internal_error");
  });

  it("rejects response codes outside the 400-599 persistent-failure range", () => {
    expect(
      sanitizeEmailError(Object.assign(new Error("x"), { responseCode: 235 })),
    ).toBe("email_error:internal_error");
    expect(
      sanitizeEmailError(Object.assign(new Error("x"), { responseCode: 5999 })),
    ).toBe("email_error:internal_error");
  });

  it("keeps a non-standard error name out of the output", () => {
    const err = new Error("boom RED1012-SELECT");
    err.name = "PgError";
    expect(sanitizeEmailError(err)).toBe("email_error:internal_error");
  });

  it("does not throw on a hostile `message` getter", () => {
    const hostile = new Error("placeholder");
    Object.defineProperty(hostile, "message", {
      get() {
        throw new Error("getter exploded");
      },
    });
    expect(() => sanitizeEmailError(hostile)).not.toThrow();
    expect(sanitizeEmailError(hostile)).toBe("email_error:internal_error");
  });

  it("classifies allowlisted PostgreSQL SQLSTATEs for operability", () => {
    const out = sanitizeEmailError(
      Object.assign(new Error("connection terminated unexpectedly"), {
        code: "08006",
      }),
    );
    expect(out).toBe("email_error:db_connection_failed code=08006");
  });

  it("always yields the canonical closed form, whatever the thrown shape", () => {
    const shapes: unknown[] = [
      new Error("boom"),
      "string rejection",
      { toString: () => "hostile" },
      { toJSON: () => ({ secret: "x" }) },
      null,
      undefined,
      42,
      Object.assign(new Error("circular"), { cause: null }),
    ];
    const circular = Object.assign(new Error("circular"), {});
    (circular as { cause?: unknown }).cause = circular;
    shapes.push(circular);
    for (const shape of shapes) {
      expect(sanitizeEmailError(shape)).toMatch(CANONICAL);
    }
  });
});

describe("classifyEmailError / formatEmailErrorClassification", () => {
  it("round-trips through the closed classification", () => {
    const classification = classifyEmailError(
      Object.assign(new Error("x"), { code: "ECONNREFUSED" }),
    );
    expect(classification).toEqual({
      category: "smtp_connection_failed",
      code: "ECONNREFUSED",
      smtpResponseCode: null,
    });
    expect(formatEmailErrorClassification(classification)).toBe(
      "email_error:smtp_connection_failed code=ECONNREFUSED",
    );
  });
});

describe("classifyEmailError — bounded cause inspection (#1016)", () => {
  it("classifies a wrapper whose cause carries the SQLSTATE: 08006", () => {
    const outer = new Error("drizzle wrapper", {
      cause: Object.assign(new Error("connection terminated"), {
        code: "08006",
      }),
    });
    expect(sanitizeEmailError(outer)).toBe(
      "email_error:db_connection_failed code=08006",
    );
  });

  it("classifies retryable SQLSTATEs from a cause: 40001 / 40P01", () => {
    for (const code of ["40001", "40P01"] as const) {
      const outer = new Error("failed: retryable condition");
      (outer as { cause?: unknown }).cause = Object.assign(
        new Error("serialization failure"),
        { code },
      );
      expect(sanitizeEmailError(outer)).toBe(
        `email_error:db_error code=${code}`,
      );
    }
  });

  it("keeps the top-level classification when the outer error already carries a code", () => {
    // GUARD: the cause chain is consulted only when the top level yields
    // nothing — existing single-level semantics are unchanged.
    const outer = Object.assign(new Error("smtp"), { code: "EAUTH" });
    (outer as { cause?: unknown }).cause = Object.assign(new Error("db"), {
      code: "08006",
    });
    expect(sanitizeEmailError(outer)).toBe(
      "email_error:smtp_auth_failed code=EAUTH",
    );
  });

  it("degrades to internal_error when the recognizable code sits beyond the cause depth cap", () => {
    // GUARD: the traversal window is fixed (outer + 2 cause levels); a code
    // only reachable deeper than that must not escape or hang the traversal.
    const deep = Object.assign(new Error("deep"), { code: "08006" });
    const l2 = new Error("l2", { cause: deep });
    const l1 = new Error("l1", { cause: l2 });
    const outer = new Error("outer", { cause: l1 });
    expect(sanitizeEmailError(outer)).toBe("email_error:internal_error");
  });

  it("does not throw on a circular cause chain and falls back safely", () => {
    const err = new Error("circular");
    (err as { cause?: unknown }).cause = err;
    expect(() => sanitizeEmailError(err)).not.toThrow();
    expect(sanitizeEmailError(err)).toBe("email_error:internal_error");
  });

  it("falls back safely when the `cause` getter throws", () => {
    const hostile = new Error("wrapper");
    Object.defineProperty(hostile, "cause", {
      get() {
        throw new Error("cause getter exploded");
      },
    });
    expect(() => sanitizeEmailError(hostile)).not.toThrow();
    expect(sanitizeEmailError(hostile)).toBe("email_error:internal_error");
  });

  it("falls back safely when a nested `code` getter throws", () => {
    const hostileCause = new Error("inner");
    Object.defineProperty(hostileCause, "code", {
      get() {
        throw new Error("code getter exploded");
      },
    });
    const outer = new Error("outer");
    (outer as { cause?: unknown }).cause = hostileCause;
    expect(() => sanitizeEmailError(outer)).not.toThrow();
    expect(sanitizeEmailError(outer)).toBe("email_error:internal_error");
  });
});

describe("projectStoredEmailError (read-side projection)", () => {
  it("keeps null as null (no-current-error contract)", () => {
    expect(projectStoredEmailError(null)).toBeNull();
  });

  it("passes the fixed bootstrap_pending state through unchanged", () => {
    expect(projectStoredEmailError(BOOTSTRAP_PENDING_MESSAGE)).toBe(
      BOOTSTRAP_PENDING_MESSAGE,
    );
  });

  it("passes canonical safe strings through unchanged", () => {
    expect(
      projectStoredEmailError("email_error:smtp_auth_failed code=EAUTH rc=535"),
    ).toBe("email_error:smtp_auth_failed code=EAUTH rc=535");
    expect(projectStoredEmailError("email_error:internal_error")).toBe(
      "email_error:internal_error",
    );
  });

  it("maps free text, empty strings, and overlong values to the fixed undisclosed label", () => {
    expect(
      projectStoredEmailError("legacy worker failure: sql=SELECT ..."),
    ).toBe(UNDISCLOSED_EMAIL_ERROR);
    expect(projectStoredEmailError("")).toBe(UNDISCLOSED_EMAIL_ERROR);
    expect(
      projectStoredEmailError(`${UNDISCLOSED_EMAIL_ERROR} trailing junk`),
    ).toBe(UNDISCLOSED_EMAIL_ERROR);
    expect(projectStoredEmailError("email_error:".padEnd(10_000, "x"))).toBe(
      UNDISCLOSED_EMAIL_ERROR,
    );
  });

  it("rejects prefix-plausible but non-canonical values", () => {
    // Unknown category.
    expect(projectStoredEmailError("email_error:evil_category")).toBe(
      UNDISCLOSED_EMAIL_ERROR,
    );
    // Unknown code (shape-compatible but not allowlisted).
    expect(
      projectStoredEmailError("email_error:smtp_send_failed code=XEAUTH"),
    ).toBe(UNDISCLOSED_EMAIL_ERROR);
    // Response code outside the validated range.
    expect(projectStoredEmailError("email_error:smtp_send_failed rc=235")).toBe(
      UNDISCLOSED_EMAIL_ERROR,
    );
    // SQLSTATE-shaped code on an SMTP category (never produced by the writer).
    expect(
      projectStoredEmailError("email_error:smtp_auth_failed code=08006"),
    ).toBe(UNDISCLOSED_EMAIL_ERROR);
    // Wrong pairing among allowlisted SMTP codes.
    expect(
      projectStoredEmailError("email_error:smtp_auth_failed code=ECONNECTION"),
    ).toBe(UNDISCLOSED_EMAIL_ERROR);
    // Code-mapped category without its code.
    expect(projectStoredEmailError("email_error:smtp_auth_failed")).toBe(
      UNDISCLOSED_EMAIL_ERROR,
    );
    // internal_error / smtp_recipient_rejected never carry code or rc.
    expect(projectStoredEmailError("email_error:internal_error rc=535")).toBe(
      UNDISCLOSED_EMAIL_ERROR,
    );
    expect(
      projectStoredEmailError("email_error:smtp_recipient_rejected rc=550"),
    ).toBe(UNDISCLOSED_EMAIL_ERROR);
    // smtp_send_failed without a code must carry an rc.
    expect(projectStoredEmailError("email_error:smtp_send_failed")).toBe(
      UNDISCLOSED_EMAIL_ERROR,
    );
    // Duplicated fields / trailing whitespace break canonical re-render.
    expect(
      projectStoredEmailError(
        "email_error:internal_error code=EAUTH code=EAUTH",
      ),
    ).toBe(UNDISCLOSED_EMAIL_ERROR);
    expect(projectStoredEmailError("email_error:internal_error ")).toBe(
      UNDISCLOSED_EMAIL_ERROR,
    );
  });
});
